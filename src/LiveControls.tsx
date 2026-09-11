import { lazy, Suspense, useState } from "react";
import type { Dataset, Product, StoreProduct } from "../shared/domain";
import type { AppState } from "./api";
import { evidenceState } from "../shared/evidence";
const AttentionChart = lazy(() =>
  import("./Charts").then((m) => ({ default: m.AttentionChart })),
);
type Mutate = (
  path: string,
  method: string,
  body: unknown,
  message: string,
) => Promise<boolean>;
const day = (offset: number) =>
  new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
export function SourceIngestion({
  state,
  mutate,
}: {
  state: AppState;
  mutate: Mutate;
}) {
  const source = state.integrations.find((s) => s.provider === "Wikimedia");
  return (
    <section className="panel">
      <div className="panelTitle">
        <h2>Wikimedia topic-interest source</h2>
        <span className="badge">{source?.status ?? "NOT CONFIGURED"}</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void mutate(
            "/jobs",
            "POST",
            {
              type: "TREND_INGESTION",
              source: "wikimedia",
              payload: {
                article: f.get("article"),
                category: f.get("category"),
                project: f.get("project"),
                start: f.get("start"),
                end: f.get("end"),
              },
            },
            "Real source ingestion queued. Parsing, deduplication, opportunity scoring and audit run in one job.",
          );
        }}
      >
        <p className="help">
          Official public API; no key required. Human pageviews are a global
          topic-interest proxy, not purchases or India-specific demand. Exact
          Wikipedia article titles avoid unrelated keyword matches.
        </p>
        <div className="formGrid">
          <label className="field">
            <span>Wikipedia article</span>
            <input name="article" defaultValue="Air_fryer" required />
          </label>
          <label className="field">
            <span>Topic category</span>
            <input name="category" defaultValue="Kitchen" required />
          </label>
          <label className="field">
            <span>Language project</span>
            <select name="project">
              <option>en.wikipedia.org</option>
              <option>hi.wikipedia.org</option>
            </select>
          </label>
          <label className="field">
            <span>From UTC date</span>
            <input type="date" name="start" defaultValue={day(29)} required />
          </label>
          <label className="field">
            <span>To UTC date</span>
            <input
              type="date"
              name="end"
              defaultValue={day(2)}
              max={day(1)}
              required
            />
          </label>
        </div>
        <button disabled={state.mode === "DEMO"}>
          Ingest real topic observations
        </button>
        {state.mode === "DEMO" && (
          <p className="help">
            External ingestion is disabled in DEMO. Open the configured LIVE
            workspace to ingest real data.
          </p>
        )}
        <p className="help">
          Last successful ingestion: {source?.lastSyncedAt ?? "Never"}. Job
          errors and retries appear below.
        </p>
      </form>
    </section>
  );
}
export function ShopifySettings({
  state,
  mutate,
}: {
  state: AppState;
  mutate: Mutate;
}) {
  const source = state.integrations.find((s) => s.provider === "Shopify"),
    configured = source?.configured && state.mode === "LIVE";
  return (
    <section className="panel" id="shopify">
      <div className="panelTitle">
        <h2>Shopify integration</h2>
        <span className="badge">{source?.status ?? "NOT CONFIGURED"}</span>
      </div>
      <div className="detailBody">
        <p>
          Server configuration: SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN and
          SHOPIFY_API_VERSION. Credentials are never returned to this page.
        </p>
        <p>
          Connection verified: {source?.verifiedAt ?? "Never"} · Last successful
          sync: {source?.lastSyncedAt ?? "Never"}
        </p>
        {source?.error && (
          <p role="alert" className="negative">
            {source.error}
          </p>
        )}
        <div className="actions">
          <button
            disabled={!configured}
            onClick={() =>
              void mutate(
                "/jobs",
                "POST",
                { type: "SHOPIFY_CONNECT", source: "shopify", payload: {} },
                "Shopify connection test queued. CONNECTED requires a successful shop response.",
              )
            }
          >
            Test Shopify connection
          </button>
          <button
            disabled={!configured}
            onClick={() =>
              void mutate(
                "/jobs",
                "POST",
                {
                  type: "SHOPIFY_PRODUCT_IMPORT",
                  source: "shopify",
                  payload: {},
                },
                "Shopify product import queued.",
              )
            }
          >
            Import Shopify products
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void mutate(
              "/jobs",
              "POST",
              {
                type: "ORDER_SYNC",
                source: "shopify",
                payload: { since: f.get("since") },
              },
              "Shopify order import queued.",
            );
          }}
        >
          <label className="field">
            <span>Orders updated since</span>
            <input name="since" type="date" defaultValue={day(30)} required />
          </label>
          <button disabled={!configured}>Import Shopify orders</button>
        </form>
        <p className="help">
          UNVERIFIED means credentials are present but no connection has
          succeeded. Each operation verifies the shop, checks the response and
          records its outcome. Price and inventory controls appear on imported
          products in Store.
        </p>
      </div>
    </section>
  );
}
export function ShopifyListingActions({
  listing: l,
  enabled,
  mutate,
}: {
  listing: StoreProduct;
  enabled: boolean;
  mutate: Mutate;
}) {
  const [variantId, setVariant] = useState(l.remoteVariants?.[0]?.id ?? "");
  const variant = l.remoteVariants?.find((v) => v.id === variantId);
  return (
    <details className="record">
      <summary>{l.title} · Shopify controls</summary>
      <p className="help">
        Remote content: {l.remoteStatus ?? "Not imported"} · Price confirmed:{" "}
        {l.priceSyncedAt ?? "Never"} · Inventory confirmed:{" "}
        {l.inventorySyncedAt ?? "Never"}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void mutate(
            `/listings/${l.id}`,
            "PATCH",
            { title: f.get("title"), description: f.get("description") },
            "Listing content saved locally. Sync to send it to Shopify.",
          );
        }}
      >
        <label className="field">
          <span>Edit listing title</span>
          <input name="title" defaultValue={l.title} required />
        </label>
        <label className="field">
          <span>Edit listing description</span>
          <textarea name="description" defaultValue={l.description} required />
        </label>
        <button>Save listing changes</button>
      </form>
      <button
        disabled={!enabled || l.status === "SYNCING"}
        onClick={() =>
          void mutate(
            "/jobs",
            "POST",
            {
              type: "STORE_SYNC",
              source: "shopify",
              payload: { listingId: l.id },
            },
            "Shopify draft sync queued.",
          )
        }
      >
        {l.externalId ? "Update Shopify product" : "Create Shopify draft"}
      </button>
      {l.remoteVariants?.length ? (
        <>
          <label className="field">
            <span>Remote variant / SKU</span>
            <select
              value={variantId}
              onChange={(e) => setVariant(e.target.value)}
            >
              {l.remoteVariants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.sku || v.id}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(
                "/jobs",
                "POST",
                {
                  type: "SHOPIFY_PRICE_SYNC",
                  source: "shopify",
                  payload: {
                    listingId: l.id,
                    variantId,
                    price: Number(f.get("price")),
                  },
                },
                "Price update queued; confirmation requires Shopify readback.",
              );
            }}
          >
            <label className="field">
              <span>Shopify variant price (INR)</span>
              <input
                name="price"
                key={variantId}
                defaultValue={variant?.price}
                min="0.01"
                step="0.01"
                type="number"
                required
              />
            </label>
            <button disabled={!enabled}>Sync Shopify price</button>
          </form>
          {variant?.inventory.map((location) => (
            <form
              key={`${variant.id}:${location.locationId}`}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate(
                  "/jobs",
                  "POST",
                  {
                    type: "SHOPIFY_INVENTORY_SYNC",
                    source: "shopify",
                    payload: {
                      listingId: l.id,
                      variantId,
                      locationId: location.locationId,
                      quantity: Number(f.get("quantity")),
                      changeFromQuantity: location.quantity,
                    },
                  },
                  "Inventory update queued with a compare-and-set check.",
                );
              }}
            >
              <label className="field">
                <span>
                  {location.locationName} · last recorded stock{" "}
                  {location.quantity}
                </span>
                <input
                  name="quantity"
                  type="number"
                  min="0"
                  step="1"
                  required
                />
              </label>
              <button disabled={!enabled}>Sync Shopify inventory</button>
            </form>
          ))}
        </>
      ) : (
        <p className="help">
          Import or create the Shopify product to obtain confirmed variant and
          inventory IDs.
        </p>
      )}
      {l.status === "ERROR" && !l.externalId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void mutate(
              `/listings/${l.id}/reconcile`,
              "POST",
              { externalId: f.get("externalId") },
              "Remote product linked after reconciliation. A content retry is now safe.",
            );
          }}
        >
          <p className="help">
            After an ambiguous create, import products and inspect Shopify
            before linking the existing remote ID.
          </p>
          <label className="field">
            <span>Confirmed imported Shopify product ID</span>
            <input
              name="externalId"
              required
              placeholder="gid://shopify/Product/…"
            />
          </label>
          <button disabled={!enabled}>Reconcile existing product</button>
        </form>
      )}
    </details>
  );
}
export function OpportunityEvidence({
  p,
  d,
  mutate,
}: {
  p: Product;
  d: Dataset;
  mutate: Mutate;
}) {
  const observations = d.observations.filter(
      (o) =>
        (p.sourceReferences ?? []).includes(o.reference ?? "") ||
        o.productName === p.name,
    ),
    views = observations
      .filter((o) => o.signalType === "HUMAN_PAGEVIEWS")
      .map((o) => ({
        date: o.observedAt.slice(0, 10),
        views: o.signalValue ?? 0,
      }));
  return (
    <>
      <div className="actions">
        <span className="badge">{evidenceState(p, d)}</span>
        <button
          onClick={() =>
            void mutate(
              `/products/${p.id}/recompute`,
              "POST",
              {},
              "Current-model score recomputed; historical snapshots retained.",
            )
          }
        >
          Recompute current model
        </button>
      </div>
      <p className="help">
        Canonical: {p.canonicalName ?? p.name} · First seen{" "}
        {p.firstSeen ?? p.createdAt} · Last seen {p.lastSeen ?? p.updatedAt}
      </p>
      <p className="help">Aliases: {(p.aliases ?? []).join(", ") || "None"}</p>
      {views.length > 0 && (
        <>
          <h3>Observed topic attention</h3>
          <p className="help">
            GLOBAL human Wikipedia pageviews. No purchase-demand inference.
            Missing dates are not filled.
          </p>
          <Suspense fallback={<p>Loading observed history…</p>}>
            <AttentionChart data={views} />
          </Suspense>
        </>
      )}
      {observations.map((o) => (
        <details key={o.id}>
          <summary>
            {o.sourceId} · {o.observedAt.slice(0, 10)} ·{" "}
            {o.signalType ?? "Operator evidence"}
            {o.signalValue != null ? ` · ${o.signalValue}` : ""}
          </summary>
          {o.reference && (
            <a href={o.reference} target="_blank" rel="noreferrer">
              Source reference
            </a>
          )}
          <p className="help">
            Region: {o.region ?? "Unspecified"} · Retrieved:{" "}
            {o.fetchedAt ?? o.createdAt} · Confidence:{" "}
            {o.confidence == null
              ? "Unspecified"
              : `${o.confidence * 100}% response completeness, not buying intent`}
          </p>
          <pre>{JSON.stringify(o.payload, null, 2)}</pre>
        </details>
      ))}
      <details>
        <summary>
          Historical score snapshots (
          {(d.scoreHistory ?? []).filter((h) => h.productId === p.id).length})
        </summary>
        {(d.scoreHistory ?? [])
          .filter((h) => h.productId === p.id)
          .reverse()
          .map((h) => (
            <details key={h.id}>
              <summary>
                {h.createdAt} · {h.scoreVersion} ·{" "}
                {h.scoring.score ?? "Insufficient data"} · {h.reason}
              </summary>
              <pre>{JSON.stringify(h, null, 2)}</pre>
            </details>
          ))}
      </details>
      <details>
        <summary>Edit canonical identity and aliases</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void mutate(
              `/products/${p.id}/identity`,
              "PATCH",
              {
                canonicalName: f.get("name"),
                category: f.get("category"),
                aliases: String(f.get("aliases"))
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean),
              },
              "Identity saved; conflicting aliases are never merged automatically.",
            );
          }}
        >
          <label className="field">
            <span>Canonical product name</span>
            <input name="name" defaultValue={p.name} required />
          </label>
          <label className="field">
            <span>Canonical category</span>
            <input name="category" defaultValue={p.category} required />
          </label>
          <label className="field">
            <span>Aliases (comma separated)</span>
            <input name="aliases" defaultValue={(p.aliases ?? []).join(", ")} />
          </label>
          <button>Save identity</button>
        </form>
      </details>
    </>
  );
}
