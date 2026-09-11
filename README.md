# AKRE — Commerce Intelligence

A working production foundation built on the original AKRE React/Vite MVP.

**DISCOVER → SCORE → APPROVE → TEST → MEASURE → SCALE / KILL**

## Implemented

- Preserved sidebar, typography, operational layout and product intelligence panel; all eight modules now load working surfaces.
- Typed domain models; persistent SQLite-backed API with server validation and owner access gate.
- Radar and product catalogue with search, category/lifecycle filters, sorting, explicit missing evidence and source provenance.
- Deterministic versioned scoring, component explanations and coverage confidence.
- Contribution economics with editable assumptions, break-even price and maximum allowable acquisition cost.
- Source observation intake, conservative identity grouping, supplier offers, variants and creative drafts.
- Experiment plans, frozen costs, daily metrics, deterministic SCALE/WATCH/KILL/INSUFFICIENT DATA and inspectable audit snapshots.
- Actual Recharts components fed only by recorded data; date filters and honest empty states.
- Durable job queue, worker, errors, bounded retries and audit history.
- Server-side Shopify and YouTube adapters, automated engine/API tests, browser tests and GitHub Actions verification.

## What is live?

**Wikimedia public pageviews were retrieved and persisted: 28 Air fryer daily observations and 8 derived attention-acceleration signals. No public deployment is provisioned.** The application is executable and backed by real persistence, but defaults to an explicitly marked DEMO workspace. Its six sample products preserve the original MVP. There are no seeded sales, orders, experiments or historical chart values.

A separate LIVE database starts empty. Manual sourced observations/offers can be recorded; Wikimedia uses its official keyless public API. Shopify and YouTube require server credentials. CONNECTED requires a successful Shopify test; credentials alone mean UNVERIFIED. Missing providers display NOT CONFIGURED. External operations are blocked in DEMO.

## Run and verify

Node.js 24+ is required. A deployment runner can use:

```
npm ci
npm test
npm run build
npm start
```

The single-process server serves the application and API on port 3001. `npm run dev` runs Vite plus the API. `npm run test:e2e` runs browser tests after installing Playwright Chromium; an installed Chrome can be selected with `PLAYWRIGHT_CHANNEL=chrome`.

For a hosted/LIVE environment, see [.env.example](.env.example) and [Setup](docs/SETUP.md). Never commit credentials or the database. The repository is the source of truth; the user does not need to maintain a local project.

## Implementation boundaries

This is a single-owner, single-workspace foundation. Multi-user OIDC/RBAC, PostgreSQL normalization, separated workers, calibrated demand providers, supplier feeds, Shopify publication workflows, order item costs, tax reconciliation, spend attribution and content publishing remain PLANNED. Shopify draft content and order jobs have real adapters but need credentialed acceptance testing. A successful content sync does not claim price, inventory or publication sync.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Setup and verification](docs/SETUP.md)
- [Integrations and credentials](docs/INTEGRATIONS.md)
- [Data model](docs/DATA_MODEL.md)
- [Scoring, economics and experiment rules](docs/SCORING.md)

Next milestone: credentialed acceptance testing on an INR Shopify development store. Wikimedia attention is not purchasing demand; the live AKRE score remains withheld. Reconcile actual order costs and advertising spend before live profit recommendations.
