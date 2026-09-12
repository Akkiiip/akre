import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Search,
  RefreshCw,
  ShoppingBag,
  BarChart3,
  Truck,
  Settings,
  Zap,
  Clapperboard,
  Store,
  FlaskConical,
} from "lucide-react";
import type {
  Dataset,
  Product,
  EconomicsInputs,
  Experiment,
} from "../shared/domain";
import { lifecycles } from "../shared/domain";
import { factorLabel } from "../shared/scoring";
import { economics } from "../shared/economics";
import { transitions } from "../shared/lifecycle";
import { evaluateExperiment } from "../shared/experiments";
import { analytics } from "../shared/analytics";
import { api, ApiError, type AppState } from "./api";
import "./styles.css";
import "./production.css";
import {
  SourceIngestion,
  ShopifySettings,
  ShopifyListingActions,
  OpportunityEvidence,
} from "./LiveControls";
import { evidenceState } from "../shared/evidence";
import { experimentAnalytics } from "../shared/experiment-analytics";
import { ProductCreate, OfferCreate, VariantCreate } from "./CatalogueTools";
const nav = [
  ["Radar", Zap],
  ["Products", ShoppingBag],
  ["Suppliers", Truck],
  ["Store", Store],
  ["Content", Clapperboard],
  ["Experiments", FlaskConical],
  ["Analytics", BarChart3],
  ["Settings", Settings],
] as const;
const RevenueChart = lazy(() =>
  import("./Charts").then((m) => ({ default: m.RevenueChart })),
);
const OrdersChart = lazy(() =>
  import("./Charts").then((m) => ({ default: m.OrdersChart })),
);
type Page = (typeof nav)[number][0];
const money = (v: number | null | undefined) =>
  v == null
    ? "Insufficient data"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(v);
const number = (v: number | null | undefined) =>
  v == null
    ? "Insufficient data"
    : v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const percent = (v: number | null | undefined) =>
  v == null ? "Insufficient data" : `${(v * 100).toFixed(1)}%`;
const date = (v: string) => new Date(v).toLocaleDateString("en-IN");
const today = () => new Date().toISOString().slice(0, 10);
function Status({ value }: { value: string }) {
  return (
    <span className={`badge ${value.replaceAll(" ", "-").toLowerCase()}`}>
      {value}
    </span>
  );
}
function Panel({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panelTitle">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <div className="tableScroll">
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
type Mutate = (
  path: string,
  method: string,
  body: unknown,
  message: string,
) => Promise<boolean>;
function App() {
  const [state, setState] = useState<AppState | null>(null),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const route = () => {
    const candidate = location.pathname.split("/")[1];
    return nav.find(([p]) => p.toLowerCase() === candidate)?.[0] ?? "Radar";
  };
  const [page, setPage] = useState<Page>(route),
    [query, setQuery] = useState(""),
    [selectedId, setSelectedId] = useState("");
  async function refresh() {
    try {
      const next = await api<AppState>("/state");
      setState(next);
      setSelectedId((current) => current || next.data.products[0]?.id || "");
      setError("");
      setAuth(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth(true);
      else setError(e instanceof Error ? e.message : "Unable to load");
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const pop = () => setPage(route());
    window.addEventListener("popstate", pop);
    return () => {
      clearInterval(timer);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  function navigate(next: Page) {
    history.pushState({}, "", `/${next.toLowerCase()}`);
    setPage(next);
    setQuery("");
  }
  const mutate: Mutate = async (path, method, body, message) => {
    setBusy(true);
    setNotice("");
    try {
      await api(path, method, body);
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setNotice(
        `Error: ${e instanceof Error ? e.message : "Operation failed"}`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (auth)
    return (
      <main className="signin">
        <Panel title="Sign in to AKRE">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              await mutate(
                "/login",
                "POST",
                { password: form.get("password") },
                "Signed in",
              );
            }}
          >
            <Field label="Workspace password">
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <button>Sign in</button>
            <p role="alert">{notice}</p>
          </form>
        </Panel>
      </main>
    );
  const d = state?.data,
    selected = d?.products.find((p) => p.id === selectedId) ?? d?.products[0];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">A</div>
          <div>
            <div className="brandname">AKRE</div>
            <div className="brandsub">COMMERCE INTELLIGENCE</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main navigation">
          {nav.map(([label, Icon]) => (
            <a
              key={label}
              href={`/${label.toLowerCase()}`}
              aria-current={page === label ? "page" : undefined}
              className={`navitem ${page === label ? "active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(label);
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebarBottom">
          <div className="livebox">
            <div className="livehead">
              <b>Workspace data</b>
            </div>
            <Status
              value={
                state?.mode === "LIVE"
                  ? "PRODUCTION"
                  : (state?.mode ?? "LOADING")
              }
            />
            <p>
              {state?.mode === "DEMO"
                ? "Sample records · no external activity"
                : "Persisted records · see source evidence"}
            </p>
          </div>
          <div className="profile">
            <div className="avatar">A</div>
            <div>
              <b>Owner workspace</b>
              <span>INR · contribution economics</span>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <div className="crumb">AKRE / {page.toUpperCase()}</div>
            <h1>{page === "Radar" ? "Product intelligence radar." : page}</h1>
            <p className="sub">
              Discover → Score → Approve → Test → Measure → Scale / Kill
            </p>
          </div>
          <div className="topactions">
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search products"
                placeholder="Search products…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !state}
              className="scanbtn"
              onClick={() =>
                void mutate(
                  "/jobs",
                  "POST",
                  {
                    type: "PRODUCT_DISCOVERY",
                    source: "internal",
                    payload: {},
                  },
                  "Discovery job queued. Track execution in Settings.",
                )
              }
            >
              <RefreshCw size={16} /> Recalculate radar
            </button>
          </div>
        </header>
        {state && (
          <div className={`modeBanner ${state.mode.toLowerCase()}`}>
            <Status value={state.mode === "LIVE" ? "PRODUCTION" : "DEMO"} />
            <span>
              {state.mode === "DEMO"
                ? (state.storage?.notice ??
                  "Demonstration workspace. Product signals and cost assumptions are sample data. Saved changes remain in the demo database.")
                : `${state.storage?.notice ?? "Production workspace."} LIVE labels require retrieved source evidence. Manual assumptions and missing data are identified separately.`}
            </span>
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className={notice.startsWith("Error:") ? "error" : "notice"}
          >
            {notice}
            <button className="plain" onClick={() => setNotice("")}>
              Dismiss
            </button>
          </div>
        )}
        {!d ? (
          <Empty>
            {error
              ? "Workspace unavailable. Retry after the API is restored."
              : "Loading workspace…"}
          </Empty>
        ) : (
          <fieldset className="workspace" disabled={busy}>
            {(page === "Radar" || page === "Products") && (
              <Catalogue
                d={d}
                page={page}
                query={query}
                selected={selected}
                onSelect={setSelectedId}
                mutate={mutate}
              />
            )}{" "}
            {page === "Suppliers" && (
              <Suppliers d={d} query={query} mutate={mutate} />
            )}{" "}
            {page === "Content" && <Content d={d} mutate={mutate} />}{" "}
            {page === "Experiments" && <Experiments d={d} mutate={mutate} />}{" "}
            {page === "Store" && (
              <StorePage d={d} state={state!} mutate={mutate} />
            )}{" "}
            {page === "Analytics" && <Analytics d={d} />}{" "}
            {page === "Settings" && (
              <SettingsPage state={state!} mutate={mutate} />
            )}
          </fieldset>
        )}
      </main>
    </div>
  );
}
function Catalogue({
  d,
  page,
  query,
  selected,
  onSelect,
  mutate,
}: {
  d: Dataset;
  page: Page;
  query: string;
  selected?: Product;
  onSelect: (id: string) => void;
  mutate: Mutate;
}) {
  const [category, setCategory] = useState(""),
    [lifecycle, setLifecycle] = useState(""),
    [sort, setSort] = useState("score");
  const filtered = useMemo(
    () =>
      d.products
        .filter(
          (p) =>
            (p.name + " " + p.category)
              .toLowerCase()
              .includes(query.toLowerCase()) &&
            (!category || p.category === category) &&
            (!lifecycle || p.lifecycle === lifecycle),
        )
        .sort((a, b) => {
          if (sort === "name") return a.name.localeCompare(b.name);
          if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt);
          if (sort === "margin") {
            const margin = (p: Product) => {
              const c = d.costs.find((c) => c.productId === p.id);
              return c
                ? (economics(c.assumptions).contributionMargin ?? -Infinity)
                : -Infinity;
            };
            return margin(b) - margin(a);
          }
          return (
            (d.opportunities.find((o) => o.productId === b.id)?.scoring.score ??
              -1) -
            (d.opportunities.find((o) => o.productId === a.id)?.scoring.score ??
              -1)
          );
        }),
    [d, query, category, lifecycle, sort],
  );
  const scores = d.opportunities.flatMap((o) =>
    o.scoring.score === null ? [] : [o.scoring.score],
  );
  return (
    <>
      <section className="metrics">
        <Metric
          label="Product opportunities"
          value={String(d.products.length)}
          note="Persisted catalogue"
        />
        <Metric
          label="Approved for testing"
          value={String(
            d.products.filter((p) => p.lifecycle === "APPROVED").length,
          )}
          note="Explicit operator approval"
        />
        <Metric
          label="Average AKRE score"
          value={
            scores.length
              ? number(scores.reduce((a, b) => a + b, 0) / scores.length)
              : "Insufficient data"
          }
          note={`${scores.length} with sufficient score coverage`}
        />
        <Metric
          label="Experiments"
          value={String(d.experiments.length)}
          note="Saved test plans"
        />
      </section>
      <ProductCreate mutate={mutate} />
      <div className="toolbar">
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {[...new Set(d.products.map((p) => p.category))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Lifecycle">
          <select
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value)}
          >
            <option value="">All states</option>
            {lifecycles.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Sort by">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">AKRE score ↓</option>
            <option value="name">Product A–Z</option>
            <option value="margin">Contribution margin ↓</option>
            <option value="updated">Recently updated</option>
          </select>
        </Field>
        <span className="muted">
          {filtered.length} of {d.products.length} products
        </span>
      </div>
      <div className="contentgrid">
        <Panel
          title={
            page === "Radar" ? "Ranked opportunities" : "Operating catalogue"
          }
          aside={
            <Status
              value={
                d.products[0]?.mode === "DEMO" ? "DEMO" : "SOURCE EVIDENCE"
              }
            />
          }
        >
          <Table
            heads={[
              "Product",
              "Source / discovered",
              "Guidance",
              "AKRE score",
              "Trend index",
              "Demand",
              "Margin",
              "Lifecycle",
              "Created",
              "Updated",
            ]}
          >
            {filtered.map((p) => {
              const o = d.opportunities.find((o) => o.productId === p.id),
                c = d.costs.find((c) => c.productId === p.id);
              return (
                <tr
                  key={p.id}
                  className={selected?.id === p.id ? "selected" : ""}
                >
                  <td>
                    <button
                      className="productLink"
                      onClick={() => onSelect(p.id)}
                    >
                      <span className="thumb">{p.category.slice(0, 1)}</span>
                      <span>
                        <b>{p.name}</b>
                        <small>
                          {p.category} ·{" "}
                          {p.supplierIds
                            .map(
                              (id) =>
                                d.suppliers.find((s) => s.id === id)?.name,
                            )
                            .join(", ") || "No supplier"}
                        </small>
                      </span>
                    </button>
                  </td>
                  <td>
                    <Status value={evidenceState(p, d)} />
                    <small>{p.source ?? "Unspecified"} · {date(p.discoveredAt ?? p.createdAt)}</small>
                  </td>
                  <td><Status value={o?.intelligence?.guidance ?? "INSUFFICIENT DATA"} /></td>
                  <td className="score">{number(o?.scoring.score)}</td>
                  <td>{number(o?.inputs.trendAcceleration)}</td>
                  <td>{number(o?.inputs.demandStrength)}</td>
                  <td>
                    {c
                      ? percent(economics(c.assumptions).contributionMargin)
                      : "Insufficient data"}
                  </td>
                  <td>
                    <Status value={p.lifecycle} />
                  </td>
                  <td>{date(p.createdAt)}</td>
                  <td>{date(p.updatedAt)}</td>
                </tr>
              );
            })}
          </Table>
          {!filtered.length && (
            <Empty>
              No products match these filters. Connected source observations can
              be processed through discovery.
            </Empty>
          )}
        </Panel>
        {selected ? (
          <ProductDetail key={selected.id} p={selected} d={d} mutate={mutate} />
        ) : (
          <Panel title="Opportunity intelligence">
            <Empty>Select a product to inspect the evidence chain.</Empty>
          </Panel>
        )}
      </div>
    </>
  );
}
function ProductDetail({
  p,
  d,
  mutate,
}: {
  p: Product;
  d: Dataset;
  mutate: Mutate;
}) {
  const [tab, setTab] = useState("Overview");
  const o = d.opportunities.find((o) => o.productId === p.id),
    cost = d.costs.find((c) => c.productId === p.id),
    score = o?.scoring;
  const tabs = [
    "Overview",
    "Evidence",
    "Suppliers",
    "Economics",
    "Variants",
    "Experiments",
    "Store",
    "Creative",
    "Decisions",
  ];
  return (
    <Panel
      title="Opportunity intelligence"
      aside={<Status value={p.lifecycle} />}
    >
      <div className="productCard">
        <div className="productIcon">{p.category.slice(0, 1)}</div>
        <div>
          <div className="smallcaps">{p.category}</div>
          <h3>{p.name}</h3>
          <p>Discovered {date(p.discoveredAt ?? p.createdAt)} · Updated {date(p.updatedAt)}</p>
        </div>
      </div>
      <div className="detailTabs" role="tablist" aria-label="Product details">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="detailBody" role="tabpanel">
        {tab === "Overview" && (
          <>
            <div className="scoreline">
              <div className="mega">{score?.score ?? "—"}</div>
              <div>
                <b>AKRE score</b>
                <span>
                  {score?.score == null
                    ? "Insufficient data"
                    : `${score.version} · ${score.confidence}% evidence coverage`}
                </span>
              </div>
            </div>
            <p className="help">
              Confidence reports weighted evidence coverage, not a statistical probability. Trend index is normalized acceleration, not measured percentage growth.
            </p>
            <dl>
              <dt>Testing guidance</dt>
              <dd>{o?.intelligence?.guidance ?? "INSUFFICIENT DATA"}</dd>
              <dt>Trend direction</dt>
              <dd>{o?.intelligence?.trendDirection ?? "INSUFFICIENT DATA"}</dd>
              <dt>Data freshness</dt>
              <dd>{o?.intelligence?.dataFreshness ?? "NO EVIDENCE"}</dd>
              <dt>Evidence quality</dt>
              <dd>{o?.intelligence?.evidenceQuality == null ? "Insufficient data" : String(o.intelligence.evidenceQuality) + "% source completeness"}</dd>
              <dt>India fit</dt>
              <dd>{number(o?.intelligence?.commerce.indiaFit ?? null)}</dd>
              <dt>Competition</dt>
              <dd>{number(o?.intelligence?.commerce.competitionLevel ?? null)}</dd>
              <dt>Estimated gross margin</dt>
              <dd>{o?.intelligence?.commerce.estimatedGrossMargin == null ? "Insufficient data" : String(o.intelligence.commerce.estimatedGrossMargin) + "% · " + (o.intelligence.commerce.economicsSource === "VERIFIED_SUPPLIER_OFFER" ? "verified quote" : "operator assumptions")}</dd>
              <dt>Selling price</dt>
              <dd>{money(cost?.assumptions.sellingPrice)}</dd>
              <dt>Landed cost</dt>
              <dd>
                {cost
                  ? money(economics(cost.assumptions).landedCost)
                  : "Insufficient data"}
              </dd>
              <dt>Contribution / order</dt>
              <dd>
                {cost
                  ? money(economics(cost.assumptions).contributionProfit)
                  : "Insufficient data"}
              </dd>
            </dl>
            <h3>Why AKRE recommends this outcome</h3>
            {o?.intelligence?.guidanceReasons.map((reason) => (
              <p className={o.intelligence?.guidance === "TEST" ? "positive" : "help"} key={reason}>{reason}</p>
            ))}
            <h3>Weighted score components</h3>
            {score?.positive.map((s) => (
              <p className="positive" key={s}>
                {s}
              </p>
            ))}
            {score?.negative.map((s) => (
              <p className="negative" key={s}>
                {s}
              </p>
            ))}
            <p className="help">
              Missing score factors: {score?.missing.map(factorLabel).join(", ") || "None"}. Required evidence: {o?.intelligence?.missingDataFlags.join(", ") || "Complete"}
            </p>
            <Table heads={["Component", "Input", "Score", "Weight"]}>
              {score?.components.map((c) => (
                <tr key={c.factor}>
                  <td>{factorLabel(c.factor)}</td>
                  <td>{number(c.input)}</td>
                  <td>{number(c.score)}</td>
                  <td>{c.weight}%</td>
                </tr>
              ))}
            </Table>
            <div className="actions">
              {transitions[p.lifecycle].map((next) => (
                <button
                  key={next}
                  onClick={() =>
                    void mutate(
                      `/products/${p.id}/lifecycle`,
                      "PATCH",
                      { lifecycle: next },
                      `Lifecycle saved: ${next}`,
                    )
                  }
                >
                  {next === "SHORTLISTED"
                    ? "Shortlist"
                    : next === "APPROVED"
                      ? "Approve product"
                      : next.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "Evidence" && (
          <>
            <h3>Source → observation → signal → score</h3>
            <OpportunityEvidence p={p} d={d} mutate={mutate} />
            <p className="help">
              {p.mode === "DEMO"
                ? "Synthetic fixture inputs. No external market evidence has been collected."
                : "Every normalized signal retains its source observation."}
            </p>
            {d.signals
              .filter((s) => s.productId === p.id)
              .map((s) => (
                <details key={s.id}>
                  <summary>
                    {factorLabel(s.factor)} · {number(s.normalizedValue)} / 100
                  </summary>
                  <p>
                    {d.sources.find((src) => src.id === s.sourceId)?.name} ·{" "}
                    {date(s.observedAt)}
                  </p>
                  <Json
                    value={{
                      signal: s,
                      observation: d.observations.find(
                        (o) => o.id === s.observationId,
                      ),
                    }}
                  />
                </details>
              ))}
            {!d.signals.some((s) => s.productId === p.id) && (
              <Empty>
                Insufficient data: no normalized signals. Raw observations
                require a justified normalization model.
              </Empty>
            )}
            <details>
              <summary>Scoring snapshot</summary>
              <Json value={o ?? null} />
            </details>
          </>
        )}
        {tab === "Suppliers" && <OfferTable d={d} productId={p.id} />}
        {tab === "Economics" &&
          (cost ? (
            <EconomicsForm
              key={cost.updatedAt}
              initial={cost.assumptions}
              offers={d.offers.filter((o) => o.productId === p.id)}
              initialOfferId={cost.supplierOfferId}
              onSave={(inputs) =>
                mutate(
                  `/products/${p.id}/economics`,
                  "PUT",
                  inputs,
                  "Economic assumptions saved. Existing experiments keep their original cost snapshot.",
                )
              }
            />
          ) : (
            <EconomicsForm
              offers={d.offers.filter((o) => o.productId === p.id)}
              initial={{
                sellingPrice: 0,
                productCost: 0,
                shipping: 0,
                paymentFeeRate: 0,
                paymentFeeFixed: 0,
                platformFeeRate: 0,
                advertisingCost: 0,
                returnsAllowance: 0,
                otherVariableCosts: 0,
              }}
              onSave={(inputs) =>
                mutate(
                  `/products/${p.id}/economics`,
                  "PUT",
                  inputs,
                  "Economic assumptions saved.",
                )
              }
            />
          ))}
        {tab === "Variants" && (
          <VariantCreate productId={p.id} mutate={mutate} />
        )}{" "}
        {tab === "Variants" &&
          (d.variants.some((v) => v.productId === p.id) ? (
            d.variants
              .filter((v) => v.productId === p.id)
              .map((v) => (
                <div key={v.id}>
                  <h3>{v.sku}</h3>
                  <Json value={v.attributes} />
                </div>
              ))
          ) : (
            <Empty>No variants recorded.</Empty>
          ))}
        {tab === "Experiments" &&
          (d.experiments.some((e) => e.productId === p.id) ? (
            d.experiments
              .filter((e) => e.productId === p.id)
              .map((e) => (
                <div className="record" key={e.id}>
                  <b>{e.channel}</b>
                  <p>
                    {e.startDate} — {e.endDate}
                  </p>
                  <Status value={evaluateExperiment(e, d.metrics).verdict} />
                </div>
              ))
          ) : (
            <Empty>
              No experiments yet. Approve the product, save a creative, then
              create a test in Experiments.
            </Empty>
          ))}
        {tab === "Store" &&
          (d.listings.some((l) => l.productId === p.id) ? (
            d.listings
              .filter((l) => l.productId === p.id)
              .map((l) => (
                <div className="record" key={l.id}>
                  <b>{l.title}</b>
                  <p>
                    <Status value={l.status} />
                  </p>
                  <p>{l.externalId ?? "No external product ID"}</p>
                </div>
              ))
          ) : (
            <Empty>No listing prepared.</Empty>
          ))}
        {tab === "Creative" &&
          (d.assets.some((a) => a.productId === p.id) ? (
            d.assets
              .filter((a) => a.productId === p.id)
              .map((a) => (
                <div className="record" key={a.id}>
                  <b>{a.title}</b>
                  <p>{a.body}</p>
                  <Status value={a.status} />
                </div>
              ))
          ) : (
            <Empty>No creative assets saved.</Empty>
          ))}
        {tab === "Decisions" &&
          (d.decisions.some((dec) => dec.productId === p.id) ? (
            d.decisions
              .filter((dec) => dec.productId === p.id)
              .reverse()
              .map((dec) => (
                <details key={dec.id}>
                  <summary>
                    {dec.verdict} · {date(dec.createdAt)}
                  </summary>
                  {dec.reasons.map((r) => (
                    <p key={r}>{r}</p>
                  ))}
                  <Json value={dec.evidence} />
                </details>
              ))
          ) : (
            <Empty>No experiment recommendation. Insufficient data.</Empty>
          ))}
      </div>
    </Panel>
  );
}
const costLabels: Record<keyof EconomicsInputs, string> = {
  sellingPrice: "Selling price",
  productCost: "Product cost",
  shipping: "Shipping",
  paymentFeeRate: "Payment fee rate (0–1)",
  paymentFeeFixed: "Fixed payment fee",
  platformFeeRate: "Platform fee rate (0–1)",
  advertisingCost: "Advertising / order",
  returnsAllowance: "Returns / refunds allowance",
  otherVariableCosts: "Other variable costs",
};
function EconomicsForm({
  offers = [],
  initialOfferId = null,
  initial,
  onSave,
}: {
  offers?: Dataset["offers"];
  initialOfferId?: string | null;
  initial: EconomicsInputs;
  onSave: (
    i: EconomicsInputs & { supplierOfferId?: string | null },
  ) => Promise<boolean>;
}) {
  const [inputs, setInputs] = useState(initial);
  const [offerId, setOfferId] = useState(initialOfferId);
  let result: ReturnType<typeof economics> | null = null;
  try {
    result = economics(inputs);
  } catch {
    /* Inline validation below. */
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (result) void onSave({ ...inputs, supplierOfferId: offerId });
      }}
    >
      <p className="help">
        INR per order; prices exclude collected taxes. Shipping includes
        freight/duties allocated per unit. Explicit zero assumptions must be
        reviewed before a real test.
      </p>
      <Field label="Supplier quote for economics">
        <select
          value={offerId ?? ""}
          onChange={(e) => {
            const chosen = offers.find((o) => o.id === e.target.value);
            setOfferId(chosen?.id ?? null);
            if (chosen && chosen.shippingCost !== null)
              setInputs({
                ...inputs,
                productCost: chosen.unitCost,
                shipping: chosen.shippingCost,
              });
          }}
        >
          <option value="">Manual assumptions</option>
          {offers.map((o) => (
            <option key={o.id} value={o.id} disabled={o.shippingCost === null}>
              {o.sku || o.id} · {money(o.unitCost)} + {money(o.shippingCost)}{" "}
              shipping · operator entered
            </option>
          ))}
        </select>
      </Field>
      <div className="formGrid">
        {(Object.keys(inputs) as (keyof EconomicsInputs)[]).map((k) => (
          <Field key={k} label={costLabels[k]}>
            <input
              required
              type="number"
              min="0"
              max={k.endsWith("Rate") ? "0.9999" : "1000000000"}
              step="any"
              value={inputs[k]}
              onChange={(e) =>
                setInputs({ ...inputs, [k]: e.target.valueAsNumber })
              }
            />
          </Field>
        ))}
      </div>
      {result ? (
        <dl>
          <dt>Revenue</dt>
          <dd>{money(result.revenue)}</dd>
          <dt>Variable cost</dt>
          <dd>{money(result.variableCost)}</dd>
          <dt>Gross margin</dt>
          <dd>{percent(result.grossMargin)}</dd>
          <dt>Contribution profit</dt>
          <dd>{money(result.contributionProfit)}</dd>
          <dt>Contribution margin</dt>
          <dd>{percent(result.contributionMargin)}</dd>
          <dt>Break-even price</dt>
          <dd>{money(result.breakEvenSellingPrice)}</dd>
          <dt>Maximum allowable CAC</dt>
          <dd>{money(result.maximumAllowableAcquisitionCost)}</dd>
        </dl>
      ) : (
        <p role="alert">
          Enter valid nonnegative costs and combined fee rates below 100%.
        </p>
      )}
      <button disabled={!result}>Save assumptions</button>
      <details>
        <summary>Calculation formulas</summary>
        <p>
          Variable cost = product + shipping + payment fees + platform fees +
          advertising + returns + other costs.
        </p>
        <p>
          Contribution profit = revenue − variable cost. Gross margin = (revenue
          − product − shipping) / revenue.
        </p>
        <p>
          Break-even price = fixed variable costs including advertising / (1 −
          percentage fee rates). Maximum CAC = revenue − non-ad variable costs;
          negative means a loss before advertising.
        </p>
      </details>
    </form>
  );
}
function OfferTable({
  d,
  productId,
  query = "",
}: {
  d: Dataset;
  productId?: string;
  query?: string;
}) {
  const offers = d.offers.filter(
    (o) =>
      (!productId || o.productId === productId) &&
      (d.products.find((p) => p.id === o.productId)?.name ?? "")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <Table
        heads={[
          "Product / supplier",
          "Variant",
          "MOQ",
          "Unit cost",
          "Shipping",
          "Delivery",
          "Region",
          "Stock",
          "Confidence",
          "Source",
          "Checked",
        ]}
      >
        {offers.map((o) => (
          <tr key={o.id}>
            <td>
              <b>{d.products.find((p) => p.id === o.productId)?.name}</b>
              <small>
                {d.suppliers.find((s) => s.id === o.supplierId)?.name}
                <span>
                  {" "}
                  · {o.mode === "DEMO" ? "DEMO" : "MANUAL"} ·{" "}
                  {o.source ?? "Operator entered"}
                  {Date.now() - Date.parse(o.lastChecked) > 14 * 86400000
                    ? " · STALE"
                    : ""}
                </span>
              </small>
            </td>
            <td>{o.sku || o.variantId || "Unspecified"}</td>
            <td>{o.moq}</td>
            <td>{money(o.unitCost)}</td>
            <td>{money(o.shippingCost)}</td>
            <td>
              {o.deliveryDays === null
                ? "Insufficient data"
                : `${o.deliveryDays} days`}
            </td>
            <td>{o.region}</td>
            <td>{o.stockStatus}</td>
            <td>{number(o.rating)}</td>
            <td>
              {o.reference ? (
                <a href={o.reference} target="_blank" rel="noreferrer">
                  Source
                </a>
              ) : o.mode === "DEMO" ? (
                "DEMO fixture"
              ) : (
                "Insufficient data"
              )}
            </td>
            <td>{date(o.lastChecked)}</td>
          </tr>
        ))}
      </Table>
      {!offers.length && (
        <Empty>No supplier offers. Supplier feed: NOT CONFIGURED.</Empty>
      )}
    </>
  );
}
function Suppliers({
  d,
  query,
  mutate,
}: {
  d: Dataset;
  query: string;
  mutate: Mutate;
}) {
  return (
    <Panel title="Supplier offers">
      <p className="sectionIntro">
        Compare offers per product and variant. Unknown shipping, stock and
        delivery information is never estimated.
      </p>
      <OfferTable d={d} query={query} />
      <OfferCreate d={d} mutate={mutate} />
    </Panel>
  );
}
function ProductSelect({
  d,
  value,
  onChange,
  approved = false,
}: {
  d: Dataset;
  value: string;
  onChange: (id: string) => void;
  approved?: boolean;
}) {
  return (
    <Field label="Product">
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select product</option>
        {d.products
          .filter(
            (p) => !approved || ["APPROVED", "TESTING"].includes(p.lifecycle),
          )
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </Field>
  );
}
function Content({ d, mutate }: { d: Dataset; mutate: Mutate }) {
  const [productId, setProduct] = useState("");
  return (
    <div className="twoColumn">
      <Panel title="Creative workspace">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            if (
              await mutate(
                "/assets",
                "POST",
                {
                  productId,
                  type: f.get("type"),
                  title: f.get("title"),
                  body: f.get("body"),
                },
                "Creative draft saved. No publication occurred.",
              )
            )
              form.reset();
          }}
        >
          <ProductSelect d={d} value={productId} onChange={setProduct} />
          <Field label="Creative type">
            <select name="type">
              {[
                "HOOK",
                "VIDEO",
                "UGC",
                "REELS",
                "CAPTION",
                "AD_ANGLE",
                "BRIEF",
                "VARIANT",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input name="title" required maxLength={200} />
          </Field>
          <Field label="Creative copy / concept">
            <textarea name="body" required rows={8} maxLength={20000} />
          </Field>
          <p className="help">
            Write a product hook, shot list, UGC concept or brief. Assets stay
            in draft; publishing providers are not configured.
          </p>
          <button disabled={!productId}>Save creative draft</button>
        </form>
      </Panel>
      <Panel title="Saved creative assets">
        {d.assets
          .filter((a) => !productId || a.productId === productId)
          .map((a) => (
            <article className="record" key={a.id}>
              <Status value={a.status} />
              <h3>{a.title}</h3>
              <p className="help">
                {a.type} · {d.products.find((p) => p.id === a.productId)?.name}
              </p>
              <p className="preserve">{a.body}</p>
              <small>
                Used in{" "}
                {d.experiments.filter((e) => e.creativeId === a.id).length}{" "}
                experiments
              </small>
            </article>
          ))}
        {!d.assets.length && (
          <Empty>
            No creative assets. Save a draft to use in a product experiment.
          </Empty>
        )}
      </Panel>
    </div>
  );
}
function Experiments({ d, mutate }: { d: Dataset; mutate: Mutate }) {
  const [productId, setProduct] = useState("");
  return (
    <>
      <div className="twoColumn">
        <Panel title="Create a product experiment">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                n = (key: string) => Number(f.get(key));
              await mutate(
                "/experiments",
                "POST",
                {
                  productId,
                  channel: f.get("channel"),
                  sellingPrice: n("sellingPrice"),
                  creativeId: f.get("creativeId"),
                  budget: n("budget"),
                  startDate: f.get("startDate"),
                  endDate: f.get("endDate"),
                  successCriteria: {
                    minImpressions: n("minImpressions"),
                    minClicks: n("minClicks"),
                    minPurchases: n("minPurchases"),
                    maxSpend: n("maxSpend"),
                    targetRoas: n("targetRoas"),
                    minContributionProfit: n("minContributionProfit"),
                  },
                  killCriteria: { maxLoss: n("maxLoss") },
                },
                "Experiment saved with criteria and cost snapshot. No ads were launched.",
              );
            }}
          >
            <ProductSelect
              d={d}
              value={productId}
              onChange={setProduct}
              approved
            />
            <Field label="Creative">
              <select name="creativeId" required>
                <option value="">Select saved creative</option>
                {d.assets
                  .filter((a) => a.productId === productId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Channel">
              <input
                name="channel"
                placeholder="Meta / organic / search"
                required
                maxLength={200}
              />
            </Field>
            <div className="formGrid">
              {[
                ["sellingPrice", "Selling price", 699],
                ["budget", "Budget", 2000],
                ["minImpressions", "Minimum impressions", 1000],
                ["minClicks", "Minimum clicks", 100],
                ["minPurchases", "Minimum purchases", 10],
                ["maxSpend", "Spend guardrail", 2000],
                ["targetRoas", "Target ROAS", 2],
                ["minContributionProfit", "Minimum contribution profit", 100],
                ["maxLoss", "Maximum loss", 1000],
              ].map(([name, label, value]) => (
                <Field key={name} label={String(label)}>
                  <input
                    type="number"
                    name={String(name)}
                    defaultValue={value}
                    min={
                      name === "minContributionProfit"
                        ? 0
                        : [
                              "minImpressions",
                              "minClicks",
                              "minPurchases",
                            ].includes(String(name))
                          ? 1
                          : 0.01
                    }
                    step={
                      ["minImpressions", "minClicks", "minPurchases"].includes(
                        String(name),
                      )
                        ? "1"
                        : "any"
                    }
                    required
                  />
                </Field>
              ))}
              <Field label="Start date">
                <input
                  type="date"
                  name="startDate"
                  defaultValue={today()}
                  required
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  name="endDate"
                  defaultValue={today()}
                  required
                />
              </Field>
            </div>
            <p className="help">
              Thresholds are editable planning assumptions. Approve a product
              and save a creative first. Budget is a monitoring threshold; AKRE
              cannot stop spend on an unconnected ad platform.
            </p>
            <button disabled={!productId}>Create experiment</button>
          </form>
        </Panel>
        <Panel title="Testing rules">
          <div className="detailBody">
            <h3>Evidence before decisions</h3>
            <p>
              A minimum traffic sample is required for every recommendation.
              Loss and spend guardrails are evaluated after that sample. SCALE
              also requires the saved purchase count, ROAS and contribution
              target.
            </p>
            <p>
              Metrics are daily totals. Saving the same date replaces that day's
              snapshot and preserves the previous value in the audit log.
            </p>
            <p>
              Contribution uses the experiment’s frozen cost assumptions and
              actual recorded advertising spend.
            </p>
            <Status value="INSUFFICIENT DATA" />
          </div>
        </Panel>
      </div>
      <div className="stack">
        {d.experiments.map((e) => (
          <ExperimentCard key={e.id} experiment={e} d={d} mutate={mutate} />
        ))}
        {!d.experiments.length && (
          <Panel title="Experiment history">
            <Empty>No tests created.</Empty>
          </Panel>
        )}
      </div>
    </>
  );
}
function ExperimentCard({
  experiment: e,
  d,
  mutate,
}: {
  experiment: Experiment;
  d: Dataset;
  mutate: Mutate;
}) {
  const result = evaluateExperiment(e, d.metrics),
    m = result.metrics;
  return (
    <Panel
      title={`${d.products.find((p) => p.id === e.productId)?.name} · ${e.channel}`}
      aside={<Status value={result.verdict} />}
    >
      <div className="detailBody">
        <p>
          {e.startDate} — {e.endDate} · Budget {money(e.budget)} · Creative:{" "}
          {d.assets.find((a) => a.id === e.creativeId)?.title}
        </p>
        <p>{result.reasons.join(" ")}</p>
        <Table
          heads={[
            "Spend",
            "Impressions",
            "Clicks",
            "CTR",
            "CPC",
            "Add to cart",
            "Checkout",
            "Purchases",
            "CVR",
            "Revenue",
            "ROAS",
            "Contribution",
          ]}
        >
          <tr>
            {[
              money(m.spend),
              number(m.impressions),
              number(m.clicks),
              percent(m.ctr),
              money(m.cpc),
              number(m.addToCart),
              number(m.checkout),
              number(m.purchases),
              percent(m.conversionRate),
              money(m.revenue),
              number(m.roas),
              money(m.contributionProfit),
            ].map((v, i) => (
              <td key={i}>{v}</td>
            ))}
          </tr>
        </Table>
        <details>
          <summary>Record daily metrics</summary>
          <form
            onSubmit={async (ev) => {
              ev.preventDefault();
              const f = new FormData(ev.currentTarget),
                values = Object.fromEntries(
                  [
                    "spend",
                    "impressions",
                    "clicks",
                    "addToCart",
                    "checkout",
                    "purchases",
                    "revenue",
                  ].map((k) => [k, Number(f.get(k))]),
                );
              await mutate(
                `/experiments/${e.id}/metrics`,
                "PUT",
                {
                  ...values,
                  date: f.get("date"),
                  reference: f.get("reference"),
                },
                "Daily metrics saved and decision evaluated.",
              );
            }}
          >
            <div className="formGrid">
              <Field label="Metric date">
                <input
                  type="date"
                  name="date"
                  min={e.startDate}
                  max={e.endDate}
                  defaultValue={e.startDate}
                  required
                />
              </Field>
              {[
                "spend",
                "impressions",
                "clicks",
                "addToCart",
                "checkout",
                "purchases",
                "revenue",
              ].map((k) => (
                <Field key={k} label={factorLabel(k)}>
                  <input
                    type="number"
                    min="0"
                    step={["spend", "revenue"].includes(k) ? "0.01" : "1"}
                    name={k}
                    defaultValue={0}
                    required
                  />
                </Field>
              ))}
            </div>
            <Field label="Evidence reference / source">
              <input
                name="reference"
                required
                minLength={3}
                placeholder="Export name, report URL or demo fixture note"
              />
            </Field>
            <button>Save daily totals and evaluate</button>
          </form>
        </details>
        <details>
          <summary>Criteria and economic assumptions</summary>
          <Json value={e} />
        </details>
      </div>
    </Panel>
  );
}
function StorePage({
  d,
  state,
  mutate,
}: {
  d: Dataset;
  state: AppState;
  mutate: Mutate;
}) {
  const [productId, setProduct] = useState(""),
    integration = state.integrations.find((i) => i.provider === "Shopify");
  return (
    <>
      <div className="twoColumn">
        <Panel
          title="Prepare a Shopify listing"
          aside={<Status value={integration?.status ?? "NOT CONFIGURED"} />}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await mutate(
                "/listings",
                "POST",
                {
                  productId,
                  title: f.get("title"),
                  description: f.get("description"),
                  price: Number(f.get("price")),
                },
                "Listing draft saved in AKRE. It has not been published.",
              );
            }}
          >
            <ProductSelect d={d} value={productId} onChange={setProduct} />
            <Field label="Listing title">
              <input name="title" required maxLength={200} />
            </Field>
            <Field label="Description">
              <textarea name="description" required rows={5} />
            </Field>
            <Field label="Planned selling price (INR)">
              <input
                type="number"
                name="price"
                min="0.01"
                step="0.01"
                required
              />
            </Field>
            <button disabled={!productId}>Save listing draft</button>
          </form>
        </Panel>
        <Panel title="Synchronization">
          <div className="detailBody">
            <p>
              Draft synchronization creates or updates actual Shopify draft
              content only after the external API succeeds.
            </p>
            <p>
              Import Shopify products in Settings, then edit content or
              synchronize a confirmed variant’s price and inventory below.
              Inventory uses compare-and-set protection; publication controls
              remain separate.
            </p>
            <p>
              Credentials stay on the server. Demo workspaces cannot call
              external providers.
            </p>
            <button
              disabled={state.mode === "DEMO" || !integration?.configured}
              onClick={() =>
                void mutate(
                  "/jobs",
                  "POST",
                  {
                    type: "ORDER_SYNC",
                    source: "shopify",
                    payload: { since: "2026-01-01" },
                  },
                  "Order sync queued.",
                )
              }
            >
              Sync orders
            </button>
          </div>
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Store products">
          <Table
            heads={[
              "Title",
              "Planned price",
              "Sync status",
              "External ID",
              "Last synced",
              "Publication",
              "Action",
            ]}
          >
            {d.listings.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.title}
                  {l.error && <small className="negative">{l.error}</small>}
                </td>
                <td>{money(l.price)}</td>
                <td>
                  <Status value={l.status} />
                </td>
                <td>{l.externalId ?? "Not created"}</td>
                <td>{l.lastSyncedAt ? date(l.lastSyncedAt) : "Never"}</td>
                <td>
                  {l.remoteStatus
                    ? `Shopify ${l.remoteStatus} (channel publication unverified)`
                    : "Unpublished draft"}
                </td>
                <td>
                  <button
                    disabled={
                      state.mode === "DEMO" ||
                      !integration?.configured ||
                      l.status === "SYNCING" ||
                      l.status === "ERROR"
                    }
                    onClick={() =>
                      void mutate(
                        "/jobs",
                        "POST",
                        {
                          type: "STORE_SYNC",
                          source: "shopify",
                          payload: { listingId: l.id },
                        },
                        "Shopify draft sync queued. See Settings for outcome.",
                      )
                    }
                  >
                    Sync draft content
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          {!d.listings.length && <Empty>No listings prepared.</Empty>}
          {d.listings.map((l) => (
            <ShopifyListingActions
              key={l.id}
              listing={l}
              enabled={
                state.mode === "LIVE" && Boolean(integration?.configured)
              }
              mutate={mutate}
            />
          ))}
        </Panel>
      </div>
    </>
  );
}
function Analytics({ d }: { d: Dataset }) {
  const [range, setRange] = useState("30"),
    [from, setFrom] = useState(today()),
    [to, setTo] = useState(today());
  const end = range === "custom" ? to : today(),
    start =
      range === "custom"
        ? from
        : new Date(Date.now() - (Number(range) - 1) * 86400000)
            .toISOString()
            .slice(0, 10);
  const a = analytics(d.orders, d.metrics, start, end);
  const experimentSummary = experimentAnalytics(
    d.experiments,
    d.metrics,
    start,
    end,
  );
  return (
    <>
      <div className="toolbar">
        <Field label="Date range">
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="1">Today</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        {range === "custom" && (
          <>
            <Field label="From">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      {start > end ? (
        <div className="error">From date must precede To date.</div>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Revenue (net refunds)" value={money(a.revenue)} />
            <Metric label="Orders" value={String(a.orders)} />
            <Metric label="Recorded ad spend" value={money(a.adSpend)} />
            <Metric
              label="Contribution profit"
              value={money(a.contributionProfit)}
            />
          </div>
          <div className="metrics">
            <Metric label="Contribution margin" value={percent(a.margin)} />
            <Metric label="ROAS" value={number(a.roas)} />
            <Metric label="AOV" value={money(a.aov)} />
            <Metric
              label="CAC / conversion rate"
              value="Insufficient data"
              note="Requires attribution and session tracking"
            />
          </div>
          <Panel title="Recorded experiment performance">
            {experimentSummary.hasMetrics ? (
              <>
                <p className="sectionIntro">
                  Operator-entered daily metrics. Purchases are experiment
                  reports, not additional Shopify orders; revenue is not
                  combined with store totals.
                </p>
                <div className="metrics">
                  <Metric
                    label="Reported purchases"
                    value={number(experimentSummary.purchases)}
                  />
                  <Metric
                    label="Recorded experiment revenue"
                    value={money(experimentSummary.revenue)}
                  />
                  <Metric
                    label="Recorded experiment spend"
                    value={money(experimentSummary.spend)}
                  />
                  <Metric
                    label="Experiment ROAS"
                    value={number(experimentSummary.roas)}
                  />
                  <Metric
                    label="Experiment conversion rate"
                    value={percent(experimentSummary.conversionRate)}
                  />
                  <Metric
                    label="Experiment contribution"
                    value={money(experimentSummary.contributionProfit)}
                  />
                  <Metric
                    label="Experiment margin"
                    value={percent(experimentSummary.margin)}
                  />
                </div>
              </>
            ) : (
              <Empty>No experiment metrics in this date range.</Empty>
            )}
          </Panel>
          <Panel title="Revenue, advertising and contribution">
            <div className="chart">
              {a.series.length ? (
                <Suspense fallback={<Empty>Loading chart…</Empty>}>
                  <RevenueChart data={a.series} />
                </Suspense>
              ) : (
                <Empty>
                  No order or spend records in this period. Connect Shopify and
                  record experiment spend to populate this chart.
                </Empty>
              )}
            </div>
          </Panel>
          <div className="stack">
            <Panel title="Recorded orders">
              <div className="chart">
                {a.series.length ? (
                  <Suspense fallback={<Empty>Loading chart…</Empty>}>
                    <OrdersChart data={a.series} />
                  </Suspense>
                ) : (
                  <Empty>
                    No sales history. AKRE does not generate chart data.
                  </Empty>
                )}
              </div>
            </Panel>
          </div>
          <p className="help">
            Revenue comes from orders, not experiment-reported revenue. Ad spend
            comes from daily experiment records; complete spend coverage is
            required for business ROAS. Order contribution stays unavailable
            until actual variable costs are recorded. All dates use UTC.
          </p>
        </>
      )}
    </>
  );
}
function SettingsPage({ state, mutate }: { state: AppState; mutate: Mutate }) {
  const [query, setQuery] = useState("");
  const d = state.data;
  return (
    <>
      <div className="twoColumn stack">
        <SourceIngestion state={state} mutate={mutate} />
        <ShopifySettings state={state} mutate={mutate} />
      </div>
      <Panel title="Integrations">
        <Table
          heads={["Provider", "State", "Last successful sync", "Configuration"]}
        >
          {state.integrations.map((i) => (
            <tr key={i.provider}>
              <td>{i.provider}</td>
              <td>
                <Status value={i.status} />
                {i.error && <small>{i.error}</small>}
              </td>
              <td>{i.lastSyncedAt ? date(i.lastSyncedAt) : "Never"}</td>
              <td>
                {i.provider === "Wikimedia"
                  ? "Public API · select topic to configure"
                  : ["Shopify", "YouTube"].includes(i.provider)
                    ? "Server environment variables"
                    : "Provider implementation planned"}
              </td>
            </tr>
          ))}
        </Table>
        <p className="sectionIntro">
          CONNECTED requires a successful provider check. UNVERIFIED means
          credentials have not been tested. LIVE requires retrieved source
          evidence; STALE means its latest observation is over seven days old.
        </p>
      </Panel>
      <div className="twoColumn stack">
        <Panel title="Source ingestion">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                "/jobs",
                "POST",
                {
                  type: "TREND_INGESTION",
                  source: "youtube",
                  payload: { query },
                },
                "YouTube ingestion queued. Run discovery after ingestion completes.",
              );
            }}
          >
            <Field label="YouTube product query">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
                maxLength={200}
              />
            </Field>
            <p className="help">
              Official API search observations are preserved raw. Video
              popularity is not treated as purchase demand.
            </p>
            <button
              disabled={
                state.mode === "DEMO" ||
                state.integrations.find((i) => i.provider === "YouTube")
                  ?.configured !== true
              }
            >
              Ingest observations
            </button>
          </form>
        </Panel>
        <Panel title="Internal jobs">
          <div className="detailBody actions">
            {[
              ["ECONOMICS_RECALCULATION", "Recalculate economics"],
              ["EXPERIMENT_EVALUATION", "Evaluate experiments"],
              ["WINNER_DETECTION", "Detect winners"],
            ].map(([type, label]) => (
              <button
                key={type}
                onClick={() =>
                  void mutate(
                    "/jobs",
                    "POST",
                    { type, source: "internal", payload: {} },
                    `${label} job queued.`,
                  )
                }
              >
                {label}
              </button>
            ))}
            <p className="help">
              Jobs execute in the backend and persist their outcomes. Winner
              detection records recommendations; it does not launch campaigns or
              spend money.
            </p>
          </div>
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Job execution history">
          <Table
            heads={[
              "Type / source",
              "Status",
              "Started",
              "Completed",
              "Retries",
              "Error",
              "Action",
            ]}
          >
            {[...d.jobs].reverse().map((j) => (
              <tr key={j.id}>
                <td>
                  {j.type}
                  <small>{j.source}</small>
                </td>
                <td>
                  <Status value={j.status} />
                </td>
                <td>
                  {j.startedAt ? new Date(j.startedAt).toLocaleString() : "—"}
                </td>
                <td>
                  {j.completedAt
                    ? new Date(j.completedAt).toLocaleString()
                    : "—"}
                </td>
                <td>{j.retryCount}</td>
                <td>{j.error ?? "—"}</td>
                <td>
                  {j.status === "ERROR" &&
                    (j.type !== "STORE_SYNC" ||
                      Boolean(
                        d.listings.find((l) => l.id === j.payload.listingId)
                          ?.externalId,
                      )) &&
                    j.retryCount < 3 && (
                      <button
                        onClick={() =>
                          void mutate(
                            `/jobs/${j.id}/retry`,
                            "POST",
                            {},
                            "Retry queued.",
                          )
                        }
                      >
                        Retry
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </Table>
          {!d.jobs.length && <Empty>No jobs have been run.</Empty>}
        </Panel>
        <Panel title="Raw source observations">
          {d.observations.map((o) => (
            <details className="record" key={o.id}>
              <summary>
                {o.productName} · {o.sourceId} · {date(o.observedAt)}
              </summary>
              {o.reference && (
                <a href={o.reference} target="_blank" rel="noreferrer">
                  View source
                </a>
              )}
              <Json value={o} />
            </details>
          ))}
          {!d.observations.length && <Empty>No observations collected.</Empty>}
        </Panel>
        <Panel title="Audit trail">
          {[...d.audit].reverse().map((a) => (
            <details className="record" key={a.id}>
              <summary>
                {a.action} · {new Date(a.createdAt).toLocaleString()}
              </summary>
              <p>
                Actor: {a.actorId} · Entity: {a.entityId}
              </p>
              <Json value={a.evidence} />
            </details>
          ))}
          {!d.audit.length && <Empty>No operator actions recorded yet.</Empty>}
        </Panel>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
