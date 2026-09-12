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
import "./radar-command.css";
import { RadarPage } from "./Radar";
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
            <h1>{page === "Radar" ? "Commerce command center." : page}</h1>
            <p className="sub">
              {page === "Radar" ? "Discover → Classify → Source → Price → Test" : "Discover → Score → Approve → Test → Measure → Scale / Kill"}
            </p>
          </div>
          <div className="topactions">
            {page !== "Radar" && <label className="search">
              <Search size={16} />
              <input
                aria-label="Search products"
                placeholder="Search products…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>}
            <button
              disabled={busy || !state}
              className="scanbtn"
              onClick={() =>
                void mutate(
                  page === "Radar" ? "/discovery/runs" : "/jobs",
                  "POST",
                  page === "Radar"
                    ? { provider: "google-trends", payload: { geo: "IN", category: "Unclassified", maxResults: 50 } }
                    : { type: "PRODUCT_DISCOVERY", source: "internal", payload: {} },
                  page === "Radar" ? "Live India discovery completed." : "Discovery job queued. Track execution in Settings.",
                )
              }
            >
              <RefreshCw size={16} /> {page === "Radar" ? "Refresh live radar" : "Recalculate"}
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
            {page === "Radar" && <RadarPage d={d} query={query} mutate={mutate} />}
            {page === "Products" && (
              <Catalogue d={d} page={page} query={query} selected={selected} onSelect={setSelectedId} mutate={mutate} />
            )}
            {page === "Suppliers" && <Suppliers d={d} query={query} mutate={mutate} />}
            {page === "Content" && <Content d={d} mutate={mutate} />}
            {page === "Experiments" && <Experiments d={d} mutate={mutate} />}
            {page === "Store" && <StorePage d={d} state={state!} mutate={mutate} />}
            {page === "Analytics" && <Analytics d={d} />}
            {page === "Settings" && <SettingsPage state={state!} mutate={mutate} />}
          </fieldset>
        )}
      </main>
    </div>
  );
}
