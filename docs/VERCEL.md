# Vercel deployment and incident verification

## Root cause reproduced from fbba674

The root package declares `type: module`. The original `api/[...path].ts` and its backend dependency tree used extensionless relative imports, while TypeScript used `module: ESNext` and `moduleResolution: Bundler`. The Vite build did not compile the API, and the TypeScript include list did not check it.

Running the official `@vercel/node` 13.0.0 builder against that entrypoint produced a Node **nodejs24.x** Lambda with **446 files**, including `server/database.js`. Its generated handler still imported `../server/database`. Loading that actual emitted handler in native Node 24.19.0 failed with **ERR_MODULE_NOT_FOUND**, before the handler's try/catch could run. A separate plain TypeScript-to-ESM reproduction failed at the identical import. Changing dynamic imports to static imports did not add the file extension or bundle the dependency.

This is a module-linking failure, not an Express authentication error, missing provider credential, missing database file, or demonstrated SQLite incompatibility. Native Node 24 successfully initializes the same SQLite schema and DEMO seed in the corrected artifact. The actual remote project runtime/logs could not be inspected with the available invalid Vercel login token; the official builder reproduction and the earlier deployment diagnostic agree. The default builder also printed TypeScript 7 type-resolution diagnostics during its standalone transpilation. The corrected build uses the project's own full TypeScript check and esbuild instead of that per-file transpilation path.

## Deterministic build

`vercel.json` selects the custom Build Output API workflow rather than implicit Vite/API detection. `npm run build:vercel` runs the ordinary TypeScript + Vite production build, then `scripts/build-vercel.mjs`:

1. Bundles the literal API entrypoint and all backend/npm dependencies into `.vercel/output/functions/api.func/index.cjs`.
2. Fails if any statically resolved external dependency is not a Node built-in.
3. Writes `.vc-config.json` with `runtime: nodejs24.x`, `handler: index.cjs`, and the standard Node request/response launcher. No Vercel request helpers are needed by Express.
4. Copies Vite assets into `.vercel/output/static`.
5. Routes `/api` and `/api/*` to the function before static handling, then applies SPA fallbacks only to the eight known application pages. Missing API endpoints return JSON 404, never index.html.

The package pins `engines.node` to `24.x`; the emitted runtime manifest also pins Node 24. No tsx loader or repository-relative runtime imports are needed by the deployed artifact. The original `npm start`/`npm run dev` paths remain available for the local/durable backend.

## Initialization, security and storage

The lightweight handler lazily loads the bundled runtime and caches one initialization promise per process. Concurrent first requests share that promise. Failed initialization clears it so a later request can retry; failures return sanitized JSON 503 with a diagnostic code, never a false healthy response. Server logs include the stage/code and Node version without credentials or full request bodies. Runtime database resources close on failed initialization. SQLite seeding and migration version checks run under write transactions; migrations and append-only triggers commit together.

Vercel DEMO uses `/tmp/akre.sqlite`, which is real SQLite but ephemeral and instance-local. Warm requests can retain changes, but instances do not share durable data and cold starts or redeployments can reset it. `/api/state`, the UI, and health all identify DEMO as ephemeral with `durable: false`.

Vercel LIVE requires `DATABASE_URL` and uses PostgreSQL only. It never falls back to SQLite or `/tmp`; missing configuration returns a sanitized `DATABASE_URL_REQUIRED` error. LIVE begins empty and has no synthetic seed. Bounded job execution happens within an explicit API request; persistent workers and timers are not assumed in the serverless runtime.

## Environment audit

| Variable                                                 | Vercel DEMO behavior                                                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AKRE_MODE                                                | Unset or DEMO for temporary hosted DEMO. LIVE requires the production configuration below.                                                               |
| DATABASE_PATH                                            | DEMO only: unset defaults to OS temporary directory/akre.sqlite. LIVE ignores it and never uses SQLite.                                                  |
| AKRE_ADMIN_PASSWORD                                      | Optional for the existing public DEMO; if supplied, at least 16 characters. Authentication is enforced when configured.                                  |
| AKRE_SESSION_SECRET                                      | Required at 32+ characters when password protection is enabled; keeps sessions valid across instances.                                                   |
| PUBLIC_ORIGIN                                            | Optional; if supplied, exact HTTPS origin without trailing slash. Otherwise requests must match the current HTTPS host. Cookies remain Secure in Vercel. |
| DATABASE_URL                                            | Not needed in DEMO. Required in LIVE; a server-side PostgreSQL/Neon connection string.                                                                   |
| SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN / SHOPIFY_API_VERSION | Not required in DEMO. Optional in LIVE; missing values leave Shopify NOT CONFIGURED.                                                                      |
| YOUTUBE_API_KEY                                          | Not required in DEMO. Optional in LIVE; missing value leaves YouTube NOT CONFIGURED.                                                                     |

Do not copy the local `.env.example` DATABASE_PATH or localhost PUBLIC_ORIGIN into Vercel. No credentials belong in VITE_* variables or committed files. Hosted password protection is not silently bypassed; incomplete authentication configuration returns JSON 503.

## Validation commands

```
npm ci
npm run build:vercel
npm test
npm run test:vercel
npm run test:e2e
```

Set `AKRE_TEST_VERCEL=1` for a second browser run against the generated function and static artifacts. Set `PLAYWRIGHT_CHANNEL=chrome` when using installed Chrome. The loopback artifact test host simulates HTTPS termination only for same-origin browser requests; hostile Origin tests remain rejected.

Native function tests copy the generated CJS file into an isolated temporary directory without node_modules or TypeScript loaders. They verify actual health/state JSON, six existing DEMO products, unknown API 404s, page reloads, writes, synchronous DEMO jobs, auth/origin checks, sanitized failures, retry after database repair, and concurrent independent SQLite initializers. CI runs the artifact checks as well as ordinary tests and both browser modes.

`vercel build --yes` was attempted but stopped because the available login token was invalid. The installed official @vercel/static-build builder separately executed npm run build:vercel and accepted the result with buildOutputVersion: 3. Its isolated Windows invocation required PATH casing normalization; no application workaround was needed. The CLI login failure is an account-access limitation, not a successful cloud-build claim. Git-linked deployment is the remaining platform check; do not interpret local tests as proof of a remote rollout.

## Existing Vercel project

Deploy the new main commit on the **existing** project. Repository configuration supplies the build command and output; no new project/domain is needed. For hosted DEMO use Node 24, AKRE_MODE=DEMO, and unset DATABASE_PATH (or use /tmp/akre.sqlite). For LIVE use the PostgreSQL configuration below and do not set DATABASE_PATH. Remove a localhost PUBLIC_ORIGIN or set the actual HTTPS production origin. Verify `/api/health` returns JSON 200 with the expected mode and durable flag, `/api/state` returns JSON 200 (or expected 401 before login), and `/radar` reloads directly.

References: [Vercel Build Output API](https://vercel.com/docs/build-output-api), [function primitives](https://vercel.com/docs/build-output-api/primitives), [supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## Durable LIVE readiness

AKRE now includes a PostgreSQL repository using the official Neon serverless driver. It preserves the existing compact `workspaces` and JSONB `records` model, so local SQLite and the typed service contract remain intact. PostgreSQL bootstrap is idempotent: migration 1 creates the durable schema and index; migration 2 adds append-only database triggers for audit events and score snapshots.

Vercel DEMO remains temporary SQLite and synthetic. Vercel LIVE requires `DATABASE_URL`; it uses PostgreSQL only, begins a real transaction, serializes the default workspace with an advisory lock, and commits changes before the API response completes. LIVE starts with an empty workspace and never falls back to SQLite or `/tmp`.

LIVE configuration required in the existing Vercel project:

```
AKRE_MODE=LIVE
DATABASE_URL=postgresql://...  # Vercel server-side secret
AKRE_ADMIN_PASSWORD=<16+ character secret>
AKRE_SESSION_SECRET=<32+ character secret>
PUBLIC_ORIGIN=https://<existing-akre-domain>
```

`GET /api/health` reports `mode: LIVE`, `storage: postgres`, and `durable: true` only after database initialization succeeds. It never returns a connection URL or secret. Do not set `DATABASE_PATH` for LIVE.

In Vercel, jobs are explicit API-triggered bounded operations and are awaited in that request. There is no interval, background process, or filesystem persistence assumption. Long-running scheduled work needs a dedicated cron/worker after credentials and execution limits are verified.

Configured Shopify and YouTube providers initialize only on the server; absent credentials remain `NOT CONFIGURED`. Wikimedia remains topic attention evidence and never supplies purchase demand, supplier cost, or profitability. Supplier quotes stay operator-entered until a real connector exists. No durable database has been connected or verified by this repository change.
