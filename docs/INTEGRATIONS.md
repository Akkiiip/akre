# Integration implementation status

| Capability                                                                         | Implementation                                                                    | Current external state                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Manual observations + supplier offers                                              | IMPLEMENTED, validated source URLs, raw evidence, explicit normalization API      | Operator supplied; inherits workspace mode                       |
| YouTube Data API                                                                   | IMPLEMENTED adapter and ingestion job, raw search observations                    | NOT CONFIGURED without `YOUTUBE_API_KEY`; no live test performed |
| Shopify Admin GraphQL                                                              | IMPLEMENTED adapter; draft content create/update job and paginated order read job | NOT CONFIGURED without credentials; no live test performed       |
| Shopify publish/unpublish, price, inventory                                        | IMPLEMENTED provider methods; remote ID mapping and UI controls PLANNED           | Not exposed as a completed operating workflow                    |
| Google Trends, Meta/Instagram, TikTok, Reddit, search, marketplace, supplier feeds | PLANNED provider implementations                                                  | NOT CONFIGURED                                                   |
| Content generation, ads launch, content publication                                | PLANNED provider implementations                                                  | NOT CONFIGURED                                                   |

`TrendProvider`, `ProductDiscoveryProvider`, `SupplierProvider`, `StoreProvider`, and `AnalyticsProvider` define boundaries in `server/providers.ts`. Add adapters on the server; never scrape restricted sources or claim unsupported official APIs. Raw observations are stored separately from normalized signals. The manual normalization API requires factor, raw value, lower/upper bounds and unit; all are audited. YouTube search results do **not** establish purchase demand or trend acceleration. No conversion from video counts to demand is invented.

## States

- **DEMO:** seeded/synthetic or operator-entered demonstration data; external jobs are blocked.
- **LIVE:** non-demo record origin. This does not certify evidence quality.
- **CONNECTED:** server credentials exist; successful data retrieval is not implied. The last successful job timestamp is separate.
- **NOT CONFIGURED:** credentials or provider implementation missing.
- **ERROR:** attempted job failed; error information is retained without tokens.

No external service is genuinely connected or verified by this repository change. Configure credentials only in a LIVE deployment. Tests mock provider responses and verify failure handling; mocks are not proof of actual connectivity.

## Shopify

Set `SHOPIFY_SHOP` to the exact `*.myshopify.com` domain, `SHOPIFY_ADMIN_TOKEN` to an app Admin API token, and `SHOPIFY_API_VERSION=2026-07`. Required scopes depend on enabled operations: products, orders, publications and inventory. Access to older orders may need additional approved scopes. The app validates the hostname and sends tokens only to that HTTPS shop endpoint.

Draft synchronization creates or updates title and description. It persists an actual returned product ID and sets SYNCED only on successful content operations. Planned selling price is **not** advertised as synced. Publishing, variant pricing and inventory require explicit Shopify IDs and separate operator approval flows in the next milestone. A remote timeout may be ambiguous: reconcile the remote state before retrying a create. There are no automatic publication, ad spend or order creation operations.

Order synchronization paginates by updated date, upserts by Shopify order ID and accepts INR only. Imported revenue uses current order totals minus current tax; detailed tax reconciliation, line items, order-specific variable costs and acquisition costs require reconciliation before profit is available. Unknown costs remain null. Order-level refunds are not subtracted a second time from an already-current Shopify total. Multi-currency orders fail the job rather than mixing amounts.

Official references: [productCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate), [Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql/latest), [access scopes](https://shopify.dev/docs/api/usage/access-scopes).

## YouTube

Enable the YouTube Data API v3 in a Google Cloud project, provide `YOUTUBE_API_KEY` server-side and respect quota/terms. The adapter searches up to 25 recent video results per operator query and stores source links and snippets. Query-based product grouping is a conservative operator-defined candidate identity; results can be irrelevant and need review. It does not treat a search match as a verified product or a measured trend.

Official reference: [search.list](https://developers.google.com/youtube/v3/docs/search/list).

Next: validate these adapters against a development store and a quota-enabled YouTube project, record real sync evidence, add incremental cursors and webhook verification, then implement an approved demand provider and an actual supplier feed.
