# AKRE architecture

## IMPLEMENTED — first production foundation

The existing React/Vite UI is retained: dark navigation, compact information hierarchy, opportunity table and intelligence detail panel, original typography and palette. TypeScript replaces the single JSX prototype. `src/main.tsx` composes the eight operating modules; `src/CatalogueTools.tsx` implements evidence/offer intake; lazy `src/Charts.tsx` supplies real Recharts SVG charts. No generated chart values, fake source connections, or fake queued-operation notifications.

```
React / Vite → same-origin Express API → Service → repository contract → SQLite (local/DEMO) | PostgreSQL (Vercel LIVE)
                                    ↘ shared deterministic engines
                                    ↘ persisted job queue → official provider APIs
                                    ↘ audit events + immutable decision snapshots
```

`shared/` is independent of React, HTTP, credentials and persistence. It contains the typed domain, scoring, economics, normalization, identity grouping, lifecycle transitions, experiment evaluation and analytics. `server/` owns validation, identity checks, provider credentials, jobs, persistence and audit. No provider credentials enter browser bundles.

The backend is Node 24 + Express with a compact repository contract. Local development and DEMO use Node SQLite; Vercel LIVE uses PostgreSQL through the official Neon serverless driver. Both preserve typed JSON records, workspace isolation, transactions, indexed record kinds and a migration ledger. PostgreSQL uses JSONB payloads, an advisory workspace lock during a request transaction, and database triggers that preserve immutable audit and score-history records. It remains a **single-owner, single-workspace deployment foundation**, not completed multi-tenant SaaS. Domain references are validated at service boundaries. The current API returns the full workspace; pagination is a required next step before large ingestion volumes.

## Durable state and failure behavior

The database initializes once. DEMO and LIVE are separate databases and cannot be mixed. LIVE has no seed products, signals, sales or chart data. Browser state is limited to navigation, filters and unfinished forms. A page reload reads persisted records from the API.

Lifecycle/cost/creative/offer/experiment mutations and audit events use repository transactions: direct SQLite transactions locally and a PostgreSQL request transaction in Vercel LIVE. Daily experiment snapshots upsert by experiment and UTC date; replacing a day preserves its previous value in audit. Decisions capture the experiment, metric rows, evaluation result, opportunity and cost assumptions at evaluation time. Later economic edits do not rewrite an experiment’s cost snapshot.

Jobs persist QUEUED → RUNNING → COMPLETED / ERROR with timestamps, source, actor, retry count and audit. An in-process worker polls each second, claims a job in a write transaction and prevents overlapping executions. Internal jobs actually recalculate or evaluate records. External jobs await provider responses. On restart, interrupted jobs become ERROR and require reconciliation. Failed safe jobs allow three explicit retries; ambiguous Shopify create operations cannot be blindly retried. Supplier refresh is NOT CONFIGURED until a supplier adapter exists.

## Security boundary

Loopback DEMO can run without a password. LIVE or non-loopback startup requires a long admin password, session secret and configured origin. Login uses timing-safe verification, rate limits and an expiring HMAC-signed HttpOnly SameSite cookie. Origin and JSON content-type checks protect mutations; inputs use Zod; SQLite uses prepared statements. Responses set content security, frame and MIME protection headers. Environment files and SQLite data are gitignored.

This is an owner access gate, not a full identity service. Before public multi-user use: deploy behind HTTPS, add OIDC/OAuth, workspace membership authorization, managed secrets, centralized rate limits, structured error logging, backups/restore drills, database migration tooling and a separate worker with leases. The audit log is application-controlled, not a tamper-evident compliance ledger.

## PLANNED — next production layers

PostgreSQL relational tables/foreign keys and paginated queries; OIDC and RBAC; scheduler/worker isolation; approved statistical normalization for additional sources; provider token lifecycle and webhooks; Shopify variant/publication mapping and operator controls; full order items/cost reconciliation; tax and multi-currency accounting; marketing attribution and spend coverage; content generation/publishing providers. No deployment or external connectivity is claimed by this milestone.

## Live-workflow hardening

Live ingestion uses server/wikimedia.ts for official API validation, server/intelligence.ts for transactional normalization/identity/scoring, and persistent jobs for errors/retries/audit. server/shopify-workflow.ts requires verified development-store identity and remote readback. SQLite migration 2 adds canonical identities and append-only score/audit triggers. Existing React/Vite modules and API remain the foundation.
