import { useMemo, useState } from "react";
import type { Dataset, Product } from "../shared/domain";
import { api } from "./api";

type Row = Record<string, any>;
type Mutate = (path: string, method: string, body: unknown, message: string) => Promise<boolean>;

const money = (v: unknown) =>
  typeof v === "number"
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v)
    : "—";

function classification(product: Product, d: Dataset) {
  const obs = d.observations.find((o) => o.productName === product.name);
  return String(obs?.payload?.productClassification ?? "AMBIGUOUS");
}

function sourceCount(d: Dataset, sourceId: string) {
  return d.observations.filter((o) => o.sourceId === sourceId).length;
}

export function RadarPage({ d, query, mutate }: { d: Dataset; query: string; mutate: Mutate }) {
  const [selectedId, setSelectedId] = useState(d.products[0]?.id ?? "");
  const [supplierResults, setSupplierResults] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    return [...d.products]
      .filter((p) => classification(p, d) !== "NON_PRODUCT")
      .filter((p) => `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const sa = d.opportunities.find((o) => o.productId === a.id)?.scoring.score ?? -1;
        const sb = d.opportunities.find((o) => o.productId === b.id)?.scoring.score ?? -1;
        return sb - sa;
      });
  }, [d, query]);

  const selected = candidates.find((p) => p.id === selectedId) ?? candidates[0];
  const opportunity = selected && d.opportunities.find((o) => o.productId === selected.id);
  const offerCount = selected ? d.offers.filter((o) => o.productId === selected.id).length : 0;
  const cost = selected ? d.costs.find((c) => c.productId === selected.id) : undefined;
  const margin = cost ? ((cost.assumptions.sellingPrice - cost.assumptions.productCost - cost.assumptions.shipping) / Math.max(cost.assumptions.sellingPrice, 1)) * 100 : null;

  async function discover() {
    await mutate(
      "/discovery/runs",
      "POST",
      { provider: "google-trends", payload: { geo: "IN", category: "Unclassified", maxResults: 50 } },
      "Live India trend discovery completed.",
    );
  }

  async function matchSuppliers() {
    if (!selected) return;
    setBusy(true);
    try {
      const local = await api<any>("/suppliers/catalogs/search", "POST", { query: selected.name, category: selected.category });
      let cj: any = null;
      try {
        cj = await api<any>("/suppliers/cj/search", "POST", { keyword: selected.name, countryCode: "IN", page: 1, size: 10 });
      } catch {
        cj = { configured: false, products: [] };
      }
      setSupplierResults({ local, cj });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="radarCommand">
      <section className="radarHero">
        <div>
          <div className="smallcaps">COMMERCE COMMAND CENTER · INDIA</div>
          <h2>What should AKRE sell today?</h2>
          <p>Live trends are only the starting signal. AKRE advances a candidate only when product intent, supplier evidence, economics and test readiness are sufficiently supported.</p>
          <div className="actions">
            <button onClick={() => void discover()}>Run live discovery</button>
            {selected && <button onClick={() => void matchSuppliers()} disabled={busy}>{busy ? "Matching suppliers…" : "Find suppliers"}</button>}
          </div>
        </div>
        <div className="radarGate">
          <span>EXECUTION GATE</span>
          <b>DISCOVER</b><i>→</i><b>CLASSIFY</b><i>→</i><b>SUPPLIER</b><i>→</i><b>ECONOMICS</b><i>→</i><b>TEST</b>
        </div>
      </section>

      <section className="metrics">
        <div className="metric"><span>Search-demand signals</span><strong>{sourceCount(d, "google-trends")}</strong><small>Google Trends evidence</small></div>
        <div className="metric"><span>Product candidates</span><strong>{candidates.length}</strong><small>Non-product trends removed</small></div>
        <div className="metric"><span>Supplier offers</span><strong>{d.offers.length}</strong><small>Recorded supplier evidence</small></div>
        <div className="metric"><span>Test-ready</span><strong>{d.products.filter((p) => d.offers.some((o) => o.productId === p.id) && d.costs.some((c) => c.productId === p.id)).length}</strong><small>Supplier + economics present</small></div>
      </section>

      <div className="contentgrid">
        <section className="panel radarCandidates">
          <div className="panelTitle"><h2>Live product candidates</h2><span className="badge source-evidence">SOURCE EVIDENCE</span></div>
          {candidates.length === 0 ? <div className="empty">No commercial candidates yet. Run live discovery.</div> : candidates.slice(0, 12).map((p) => {
            const o = d.opportunities.find((x) => x.productId === p.id);
            const c = classification(p, d);
            const offers = d.offers.filter((x) => x.productId === p.id).length;
            const selectedClass = p.id === selected?.id ? "selected" : "";
            return <button key={p.id} className={`radarCandidate ${selectedClass}`} onClick={() => { setSelectedId(p.id); setSupplierResults(null); }}>
              <span className="radarRank">{c === "PRODUCT" ? "P" : "?"}</span>
              <span className="radarCandidateMain"><b>{p.name}</b><small>{p.category} · {c}</small></span>
              <span className="radarScore">{o?.scoring.score ?? "—"}</span>
              <span className="radarStatus">{offers ? "SUPPLIER" : "DISCOVERED"}</span>
            </button>;
          })}
        </section>

        <section className="panel radarDecision">
          <div className="panelTitle"><h2>Decision funnel</h2><span className="badge">{selected?.lifecycle ?? "NO CANDIDATE"}</span></div>
          {!selected ? <div className="empty">Select a candidate to inspect its execution state.</div> : <>
            <div className="radarProductHead"><div className="productIcon">{selected.category.slice(0, 1)}</div><div><div className="smallcaps">{selected.category}</div><h3>{selected.name}</h3><p>{classification(selected, d)} · {selected.source ?? "unknown source"}</p></div></div>
            <div className="radarSteps">
              <div className="radarStep done"><b>01</b><span>Discovery</span><strong>LIVE</strong></div>
              <div className={`radarStep ${classification(selected, d) === "PRODUCT" ? "done" : "wait"}`}><b>02</b><span>Product intent</span><strong>{classification(selected, d)}</strong></div>
              <div className={`radarStep ${offerCount ? "done" : "wait"}`}><b>03</b><span>Supplier evidence</span><strong>{offerCount ? `${offerCount} OFFER${offerCount > 1 ? "S" : ""}` : "MISSING"}</strong></div>
              <div className={`radarStep ${cost ? "done" : "wait"}`}><b>04</b><span>Economics</span><strong>{cost ? `${margin?.toFixed(0)}% gross` : "MISSING"}</strong></div>
              <div className="radarStep wait"><b>05</b><span>Test</span><strong>NOT READY</strong></div>
            </div>
          </>}
        </section>
      </div>

      {selected && <section className="panel radarEvidence">
        <div className="panelTitle"><h2>Evidence & supplier match</h2><span className="badge">{supplierResults ? "RESULTS" : "READY"}</span></div>
        {!supplierResults ? <div className="empty">Click <b>Find suppliers</b> to query the researched India supplier network and the live CJ catalog when connected.</div> : <div className="contentgrid">
          <div>
            <h3>Researched supplier network</h3>
            {(supplierResults.local?.suppliers ?? []).map((s: any) => <div className="record" key={s.id}><b>{s.name}</b><p>{s.status} · {s.integration} · {s.region}</p><small>{s.evidence?.reviewSummary}</small></div>)}
            {!supplierResults.local?.suppliers?.length && <div className="empty">No researched supplier match for this exact candidate.</div>}
          </div>
          <div>
            <h3>Live CJ catalog</h3>
            {supplierResults.cj?.products?.length ? supplierResults.cj.products.slice(0, 6).map((p: any) => <div className="record" key={p.id}><b>{p.name}</b><p>{p.sku ?? "No SKU"} · {money(p.sellPriceUsd)} USD · stock {p.inventory ?? p.verifiedInventory ?? "unknown"}</p><small>{p.deliveryCycle ?? "Delivery unknown"}</small></div>) : <div className="empty">CJ is not configured or returned no live match. Add <code>CJ_API_KEY</code> in Vercel to activate the live catalog.</div>}
          </div>
        </div>}
      </section>}

      <section className="radarFootnote">LIVE rule: search trends are evidence of search interest, not sales. Supplier research is not a live inventory guarantee. AKRE will not mark a product TEST READY until the required evidence chain is present.</section>
    </div>
  );
}
