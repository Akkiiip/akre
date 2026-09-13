export {};

type Row = Record<string, any>;

const ID = "akre-radar-live";
let rendering = false;

const esc = (value: unknown): string =>
  String(value ?? "—").replace(/[&<>\"]/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
    return map[char] ?? char;
  });

async function json(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(body?.error || body?.detail || `Request failed (${response.status})`);
  return body;
}

function productObservationRows(observations: Row[]): Row[] {
  const live = observations.filter((item) => item.sourceId === "google-trends");
  const byName = new Map<string, Row>();
  for (const item of live) {
    const name = String(item.productName ?? item.payload?.query ?? "").trim();
    if (!name) continue;
    const classification = String(item.payload?.productClassification ?? "AMBIGUOUS");
    const current = byName.get(name);
    const score = Number(item.signalValue ?? item.payload?.approxTraffic ?? 0);
    const currentScore = Number(current?.signalValue ?? current?.payload?.approxTraffic ?? 0);
    if (!current || score > currentScore) {
      byName.set(name, { ...item, productName: name, payload: { ...(item.payload ?? {}), productClassification: classification } });
    }
  }
  return [...byName.values()].sort((a, b) => Number(b.signalValue ?? 0) - Number(a.signalValue ?? 0));
}

function classificationFor(row: Row): string {
  return String(row.payload?.productClassification ?? "AMBIGUOUS");
}

function supplierResultsMarkup(local: any, cj: any): string {
  const localRows = Array.isArray(local?.suppliers) ? local.suppliers : [];
  const cjRows = Array.isArray(cj?.products) ? cj.products : [];
  const researched = localRows.length
    ? localRows.map((supplier: Row) => `<div class="record"><b>${esc(supplier.name)}</b><p>${esc(supplier.status)} · ${esc(supplier.integration)}</p><small>${esc(supplier.evidence?.reviewSummary || "Evidence captured")}</small></div>`).join("")
    : `<div class="empty">No researched supplier match.</div>`;
  const liveCj = cjRows.length
    ? cjRows.slice(0, 10).map((product: Row) => `<div class="record"><b>${esc(product.name ?? product.nameEn ?? product.sku)}</b><p>${esc(product.sellPriceUsd ?? product.sellPrice ?? "—")} USD · stock ${esc(product.inventory ?? product.verifiedInventory ?? "unknown")}</p><small>${esc(product.deliveryCycle || "Delivery unknown")}</small></div>`).join("")
    : `<div class="empty">CJ is not configured or no live match was returned.</div>`;
  return `<div class="contentgrid"><div><h3>Researched India suppliers</h3>${researched}</div><div><h3>Live CJ catalog</h3>${liveCj}</div></div>`;
}

async function render(): Promise<void> {
  if (rendering) return;
  const onRadar = location.pathname === "/radar" || location.pathname === "/";
  const workspace = document.querySelector<HTMLElement>("fieldset.workspace");
  const existingRoot = document.getElementById(ID);

  if (!onRadar || !workspace) {
    existingRoot?.remove();
    if (workspace) workspace.style.display = "";
    return;
  }

  rendering = true;
  try {
    workspace.style.display = "none";
    let root = existingRoot;
    if (!root) {
      root = document.createElement("section");
      root.id = ID;
      workspace.insertAdjacentElement("beforebegin", root);
    }

    try {
      const state = await json("/api/state");
      const data = state?.data ?? {};
      const products: Row[] = Array.isArray(data.products) ? data.products : [];
      const observations: Row[] = Array.isArray(data.observations) ? data.observations : [];
      const opportunities: Row[] = Array.isArray(data.opportunities) ? data.opportunities : [];
      const offers: Row[] = Array.isArray(data.offers) ? data.offers : [];
      const costs: Row[] = Array.isArray(data.costs) ? data.costs : [];
      const liveRows = productObservationRows(observations);
      const strictRows = liveRows.filter((row) => classificationFor(row) === "PRODUCT");
      const verificationRows = liveRows.filter((row) => classificationFor(row) !== "PRODUCT");
      const productByName = new Map(products.map((product) => [String(product.name), product]));
      const candidates = strictRows
        .map((row) => productByName.get(String(row.productName)))
        .filter(Boolean) as Row[];
      candidates.sort((a, b) => {
        const aRow = strictRows.find((row) => row.productName === a.name);
        const bRow = strictRows.find((row) => row.productName === b.name);
        return Number(bRow?.signalValue ?? 0) - Number(aRow?.signalValue ?? 0);
      });
      const selected = candidates[0];
      const selectedObservation = selected ? strictRows.find((row) => row.productName === selected.name) : undefined;
      const candidateRows = liveRows.length
        ? liveRows.slice(0, 20).map((row, index) => {
            const product = productByName.get(String(row.productName));
            const kind = classificationFor(row);
            const opportunity = product ? opportunities.find((item) => item.productId === product.id) : undefined;
            const isProduct = kind === "PRODUCT";
            return `<div class="radarCandidate ${isProduct && product?.id === selected?.id ? "selected" : ""}"><span class="radarRank">${index + 1}</span><span class="radarCandidateMain"><b>${esc(row.productName)}</b><small>${esc(row.payload?.classificationCategory || product?.category || "Unclassified")} · ${Number(row.signalValue ?? 0).toLocaleString("en-IN")} approx searches</small></span><span class="radarScore">${isProduct ? esc(opportunity?.scoring?.score ?? "—") : "—"}</span><span class="radarStatus">${isProduct ? "PRODUCT" : "VERIFY"}</span></div>`;
          }).join("")
        : `<div class="empty">No fresh Google Trends signals are loaded yet. Run the live India trend feed.</div>`;
      const selectedOffer = selected ? offers.some((offer) => offer.productId === selected.id) : false;
      const selectedCost = selected ? costs.some((cost) => cost.productId === selected.id) : false;
      const economicsReady = candidates.filter((product) => offers.some((offer) => offer.productId === product.id) && costs.some((cost) => cost.productId === product.id)).length;

      root.innerHTML = `
        <div class="radarCommand">
          <section class="radarHero"><div>
            <div class="smallcaps">COMMERCE COMMAND CENTER · INDIA</div>
            <h2>Fresh products from live search demand</h2>
            <p>Every fresh Google Trends query is visible. Confirmed product-intent signals are marked PRODUCT; unresolved commercial signals stay visible as VERIFY instead of being fabricated into products.</p>
            <div class="actions"><button data-refresh>Refresh live India trends</button>${selected ? `<button data-suppliers>Find suppliers for ${esc(selected.name)}</button>` : ""}</div>
          </div><div class="radarGate"><span>PIPELINE</span><b>LIVE TREND</b><i>→</i><b>PRODUCT</b><i>→</i><b>SUPPLIER</b><i>→</i><b>ECONOMICS</b><i>→</i><b>TEST</b></div></section>
          <section class="metrics">
            <div class="metric"><span>Fresh Google Trends signals</span><strong>${liveRows.length}</strong><small>India · current feed</small></div>
            <div class="metric"><span>Product candidates</span><strong>${strictRows.length}</strong><small>Confirmed PRODUCT classification</small></div>
            <div class="metric"><span>Needs verification</span><strong>${verificationRows.length}</strong><small>Visible, not fabricated</small></div>
            <div class="metric"><span>Economics ready</span><strong>${economicsReady}</strong><small>Supplier + cost</small></div>
          </section>
          <div class="contentgrid">
            <section class="panel"><div class="panelTitle"><h2>Fresh trend candidates</h2><span class="badge source-evidence">GOOGLE TRENDS · ${liveRows.length}</span></div>${candidateRows}</section>
            <section class="panel"><div class="panelTitle"><h2>Decision gate</h2><span class="badge">${selected ? "NEW CANDIDATE" : "WAITING FOR PRODUCT INTENT"}</span></div>
              ${selected ? `<div class="radarProductHead"><div class="productIcon">${esc(String(selected.category || "?").slice(0,1))}</div><div><div class="smallcaps">${esc(selected.category)}</div><h3>${esc(selected.name)}</h3><p>LIVE Google Trends → PRODUCT · ${Number(selectedObservation?.signalValue ?? 0).toLocaleString("en-IN")} approx searches</p></div></div><div class="radarSteps"><div class="radarStep done"><b>01</b><span>Live trend</span><strong>FOUND</strong></div><div class="radarStep done"><b>02</b><span>Product intent</span><strong>PRODUCT</strong></div><div class="radarStep ${selectedOffer ? "done" : "wait"}"><b>03</b><span>Supplier</span><strong>${selectedOffer ? "FOUND" : "MISSING"}</strong></div><div class="radarStep ${selectedCost ? "done" : "wait"}"><b>04</b><span>Economics</span><strong>${selectedCost ? "READY" : "MISSING"}</strong></div><div class="radarStep wait"><b>05</b><span>Test</span><strong>GATED</strong></div></div>` : `<div class="empty">Fresh signals are visible on the left. None is currently classified as a confirmed product, so supplier matching remains gated.</div>`}
            </section>
          </div>
          <section class="panel radarEvidence"><div class="panelTitle"><h2>Supplier intelligence</h2><span class="badge">EVIDENCE SEPARATED</span></div><div id="${ID}-results"><div class="empty">Find suppliers after a confirmed PRODUCT candidate is available.</div></div></section>
          <div class="radarFootnote">Search interest is demand/attention evidence, not purchase proof. VERIFY rows remain unconfirmed until classification evidence is strong enough.</div>
        </div>`;

      root.querySelector("[data-refresh]")?.addEventListener("click", async () => {
        const button = root?.querySelector<HTMLButtonElement>("[data-refresh]");
        if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
        try {
          await json("/api/discovery/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google-trends", payload: { geo: "IN", category: "Unclassified", maxResults: 50 } }) });
          await render();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Discovery failed");
          if (button) { button.disabled = false; button.textContent = "Retry live India trends"; }
        }
      });

      root.querySelector("[data-suppliers]")?.addEventListener("click", async () => {
        const results = root?.querySelector<HTMLElement>(`#${ID}-results`);
        if (!results || !selected) return;
        results.innerHTML = `<div class="empty">Matching researched India suppliers and live CJ catalog…</div>`;
        try {
          const local = await json("/api/suppliers/catalogs/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: selected.name, category: selected.category }) });
          let cj: any = null;
          try {
            cj = await json("/api/suppliers/cj/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword: selected.name, countryCode: "IN", page: 1, size: 10 }) });
          } catch {}
          results.innerHTML = supplierResultsMarkup(local, cj);
        } catch (error) {
          results.innerHTML = `<div class="empty">${esc(error instanceof Error ? error.message : "Supplier matching failed")}</div>`;
        }
      });
    } catch (error) {
      root.innerHTML = `<div class="panel"><div class="empty">${esc(error instanceof Error ? error.message : "Unable to load live radar")}</div></div>`;
    }
  } finally {
    rendering = false;
  }
}

window.addEventListener("popstate", () => void render());
window.addEventListener("akre:live-discovery-complete", () => void render());
setInterval(() => {
  const onRadar = location.pathname === "/radar" || location.pathname === "/";
  const workspace = document.querySelector<HTMLElement>("fieldset.workspace");
  const root = document.getElementById(ID);
  if (!onRadar) {
    if (root) root.remove();
    if (workspace) workspace.style.display = "";
    return;
  }
  if (workspace && !root) void render();
}, 1000);
setTimeout(() => void render(), 400);
