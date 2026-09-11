# Typed data model

All domain types are defined in `shared/domain.ts`. Operational records include `id`, `workspaceId`, `createdAt`, `updatedAt`, and `mode`. IDs are UUIDs for new records; provider external IDs are preserved for repeatable sync. Dates are ISO timestamps or UTC calendar dates. Money is INR in this milestone; engines use unrounded numbers and UI rounds only for display. Production accounting should move monetary persistence to decimal/minor-unit types.

| Entity                      | Relationships / purpose                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| User, Workspace             | Owner identity and tenancy contracts; full multi-user persistence/auth PLANNED                                            |
| Product                     | Stable normalized identity, category, supplier IDs, lifecycle                                                             |
| ProductOpportunity          | Product, source/signal IDs, independent component scores, score version and missing evidence                              |
| TrendSource                 | Provider/source name, reference, data connection state                                                                    |
| SourceObservation           | Original external source ID, payload, source URL and observation timestamp                                                |
| TrendSignal                 | Observation + product + source; raw/normalized values, units and normalization version                                    |
| Supplier, SupplierOffer     | Multiple independent offers per product/variant; MOQ, costs, delivery, region, stock, confidence, reference, checked time |
| ProductVariant              | Product, globally unique workspace SKU, attributes                                                                        |
| ProductCost                 | Product + optional offer; currency and complete explicit economic assumptions                                             |
| Store, StoreProduct         | Provider store, local product, external ID, planned listing, draft/sync/publication states                                |
| ContentAsset                | Product, concept/copy type, draft content, external publication ID (null unless actually confirmed)                       |
| Experiment                  | Product + creative, channel, budget/dates, saved success/kill criteria, frozen cost assumptions                           |
| ExperimentMetric            | Experiment + UTC date, spend, funnel counts, revenue, reference; daily replace semantics                                  |
| Order, OrderItem            | Store external order ID, product/variant line relationships, amounts and actual cost snapshots                            |
| RevenueMetric, ProfitMetric | Typed aggregation contracts; derived calculations, not fabricated seeded records                                          |
| Decision                    | Product/experiment, SCALE/WATCH/KILL/INSUFFICIENT DATA, reasons and evaluation snapshot                                   |
| Integration                 | Typed configuration/status contract; API derives safe status from server configuration and jobs                           |
| SyncJob                     | Type, source, payload, actor, state, retry/error/timing history                                                           |
| AuditEvent                  | Actor, action, entity and evidence snapshots                                                                              |

## Storage

`server/database.ts` owns schema version 1: workspaces, indexed typed-JSON records and schema_migrations. Workspace membership is enforced in the repository and service checks referenced products, variants, creatives and experiments. The JSON envelope preserves rich evidence snapshots. Entity-level SQL foreign keys and a normalized PostgreSQL schema are PLANNED; this is not represented as completed enterprise relational modeling. The current system supports one owner workspace. Application access has no audit-delete endpoint.

## Lifecycle

DISCOVERED → SHORTLISTED → APPROVED → TESTING → WINNER → SCALING.

Allowed kill/archive exits are declared explicitly in `shared/lifecycle.ts`. Archived products are terminal. Testing requires an experiment. WINNER/SCALING require a SCALE evaluation; the engine never automatically changes lifecycle. KILL is an explainable recommendation, while KILLED is an explicit operator state. Approval is persisted and audited.

## Provenance and identity

Source observations are keyed by source and external observation ID. Product names are conservatively normalized for Unicode/case/punctuation/whitespace; different sizes remain distinct. This is deterministic grouping, not completed semantic entity resolution. Signals link back to raw observations; latest source/factor values prevent repeated polling from overweighting a source. Normalized source values aggregate by arithmetic mean for this version. Every result stores the method version. Missing values use null, never invented zeroes.

Demo fixtures preserve the six original MVP products, supplier names and per-order cost examples. Additional factor inputs are explicitly synthetic examples, never live findings. No demo orders, spend history or experiments are seeded. LIVE databases initialize empty. Changing mode on an existing database is refused.
