# Integrations and evidence states

## Verified external retrieval

Wikimedia Analytics API is IMPLEMENTED and was actually queried for Air_fryer on en.wikipedia.org. The separate live workspace persists 28 raw daily human pageview observations and 8 derived attention-acceleration signals. See verification reports in this directory's verification folder. Reports are historical checks, not demo fixtures or a deployed live service.

The API is keyless. Settings accepts an exact article, language project, category and completed UTC date range (maximum 91 days). The ingestion job validates API metadata, deduplicates external observations, preserves raw payloads separately, matches conservative identities, derives attention signals, recalculates the existing score version and appends audit evidence. Conflicting revisions fail explicitly; retries retain errors and counts. Pageviews do not establish purchasing intent, supplier quality, margins or product demand. The score stays withheld without required evidence.

Official references: [Wikimedia pageviews](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html), [access policy](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html).

## Shopify: NOT CONFIGURED without credentials

No credentialed Shopify connection has been verified. Unit tests use labeled mocks. Configure server-only SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN and SHOPIFY_API_VERSION=2026-07. The verified target must be an INR partner development store. Required scopes depend on operations: read/write_products, read/write_inventory, read_locations and read_orders; older orders may require additional approved access.

Settings exposes actual connection verification, product import and order sync with persistent job history, error and retry state. Listings support create/update, variant price and inventory sync with remote readback. Inventory uses compare-and-set plus idempotency keys. Changed credential/store fingerprints invalidate queued work and prior sync attribution. Ambiguous creation requires reconciliation before retry. Imported products reject truncated variants/location pages rather than claim completeness. Publishing controls remain PLANNED.

Orders are paginated and upserted by external ID; malformed or repeated cursors fail. INR net revenue uses current totals minus tax; refunds are not deducted twice. Missing variable costs remain unknown, so contribution profit is withheld. Line-item cost reconciliation remains PLANNED.

Official references: [Admin GraphQL](https://shopify.dev/docs/api/admin-graphql/latest), [ShopPlan](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopPlan), [inventorySetQuantities](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities).

## States

- DEMO: isolated synthetic workspace; external jobs blocked.
- LIVE: successfully fetched source evidence exists and is fresh; application mode alone is never proof.
- MANUAL: operator-entered evidence or supplier offer, not automatic provider retrieval.
- UNVERIFIED: credentials exist but no confirmed connection.
- CONNECTED: successful Shopify connection verification for current configuration.
- SYNCING / SYNCED: queued/running operation or confirmed completed synchronization.
- NOT CONFIGURED: missing credentials, implementation, or initial source ingestion.
- STALE: evidence older than its freshness window.
- ERROR: failed operation; visible job error and retry history.

YouTube's existing official API adapter requires YOUTUBE_API_KEY and remains NOT CONFIGURED without it; no credentialed retrieval was verified. Other demand providers, supplier feeds, ads launch and content publication remain PLANNED. Manual supplier entries retain source, URL, SKU, costs, availability and last checked; economics explicitly links the selected quote and visible operator assumptions.
