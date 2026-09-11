# Setup and verification

## Requirements

Node.js 24+ (Node SQLite), npm, persistent disk. The user does not need to maintain a local project: this repository is the deployable source. The commands below are for a developer or deployment runner.

```
npm ci
npm run build
npm start
```

The production server serves the Vite build and API at `http://127.0.0.1:3001`. `npm run dev` starts the API and Vite with `/api` proxying. No credentials are needed for the isolated DEMO workspace. SQLite is created at `data/akre.sqlite`; restarting preserves changes. Never run multiple API instances against this worker configuration.

Copy `.env.example` to `.env` on the server, or inject environment variables through the host secret manager. Never commit `.env`. For LIVE, set `AKRE_MODE=LIVE`, choose a **new** `DATABASE_PATH`, configure `AKRE_ADMIN_PASSWORD` (16+ characters), `AKRE_SESSION_SECRET` (32+ characters), and `PUBLIC_ORIGIN`. Set `HOST=0.0.0.0` only behind an HTTPS reverse proxy. The server refuses an unsafe LIVE/non-loopback configuration. Database mode mismatch is a startup error, never a silent reset.

`PUBLIC_ORIGIN` must exactly match the browser origin, including port. In Vite development with password protection use the Vite origin. In production use the external HTTPS origin. Secrets remain in server environment variables. There is no credential-entry form in the client.

## Verify

```
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

If Chromium download is unavailable and Chrome is already installed, set `PLAYWRIGHT_CHANNEL=chrome` when running E2E tests. Browser tests launch a separate server on port 3101 with an in-memory DEMO database; they do not modify production data or call external providers. They cover all eight routes, direct reloads, browser history, mobile widths, detail tabs, filtering, approvals, economic edits, content, experiment creation, metric entry, chart rendering and job audit.

## First workflow

1. Radar: inspect a demo product and its evidence. Shortlist, then approve.
2. Economics detail: review every assumption and save.
3. Content: save a hook/creative for the product.
4. Experiments: choose the approved product and creative, set criteria and dates, then save.
5. Record daily metrics with an evidence reference; inspect the resulting decision and saved snapshot.
6. Store: prepare a listing draft. It remains unpublished. Settings shows provider status and job history.

LIVE manual intake is available under Radar/Products. Record a source URL and note; missing normalized evidence keeps the score unavailable. The `/api/observations` endpoint additionally accepts explicit measured values with normalization bounds. Supplier offers and variants can be recorded independently. New products can save cost assumptions in the Economics tab.

## Operations

Keep the SQLite database on durable storage. Back up using SQLite's online backup mechanism or stop the single process before copying the database and associated WAL files. Do not copy only a live main database file. Test restoration on an isolated host with the same mode. A managed process supervisor should restart the server on failures. Queue errors and provider error codes appear in Settings; do not blindly retry an interrupted Shopify create. There is no public deployment provisioned in this change.

## Live-workflow hardening

For actual keyless Wikimedia ingestion use Settings in the separate LIVE workspace, or run npx tsx scripts/ingest-live.ts --report. The CLI defaults to data/live.sqlite and an Air_fryer query. Never point it at the demo database. Verify existing persisted data with npx tsx scripts/verify-live-data.ts; after building, run npx tsx scripts/verify-live-browser.ts with PLAYWRIGHT_CHANNEL=chrome when using installed Chrome. These verification scripts do not fabricate observations. Shopify requires an INR partner development store and server-only credentials; without them Settings remains NOT CONFIGURED. No public deployment is provisioned.
