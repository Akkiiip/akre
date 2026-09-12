type EvidenceRow = Record<string, any>;

type AppState = {
  mode?: string;
  data?: {
    products?: EvidenceRow[];
    observations?: EvidenceRow[];
    opportunities?: EvidenceRow[];
    sources?: EvidenceRow[];
  };
};

const id = "akre-discovery-layer";
const esc = (v: unknown) => String(v ?? "—").replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtDate = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};
const freshness = (v: unknown) => {
  if (!v) return "Unknown";
  const age = Date.now() - new Date(String(v)).getTime();
  if (!Number.isFinite(age)) return "Unknown";
  const hours = age / 36e5;
  return hours < 1 ? "Fresh" : hours < 24 ? `${Math.round(hours)}h old` : `${Math.round(hours / 24)}d old`;
};

async function json(path: string, init?: RequestInit) {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!r.ok) throw new Error(body?.detail || body?.error || `Request failed (${r.status})`);
  return body;
}

function render(state: AppState) {
  if (location.pathname !== "/radar" && location.pathname !== "/") return;
  const root = document.querySelector("main");
  if (!root) return;
  let panel = document.getElementById(id);
  if (!panel) {
    panel = document.createElement("section");
    panel.id = id;
    root.querySelector(".modeBanner")?.insertAdjacentElement("afterend", panel);
  }
  const products = state.data?.products ?? [];
  const observations = state.data?.observations ?? [];
  const opportunities = state.data?.opportunities ?? [];
  const attention = observations.filter((o) => o.evidenceKind === "ATTENTION" || o.kind === "ATTENTION");
  const demand = observations.filter((o) => o.evidenceKind === "DEMAND" || o.kind === "DEMAND" || o.evidenceKind === "DEMAND/SEARCH");
  const latestDemand = [...demand].sort((a, b) => String(b.observedAt ?? b.createdAt ?? "").localeCompare(String(a.observedAt ?? a.createdAt ?? "")));

  panel.innerHTML = `
    <div class="akre-discovery-head">
      <div>
        <div class="akre-eyebrow">DISCOVERY ENGINE / EVIDENCE</div>
        <h2>Attention → Search Demand</h2>
        <p>Separate evidence streams for what people notice and what they actively search for. Search interest is <b>not purchase demand</b>.</p>
      </div>
      <div class="akre-discovery-actions">
        <button data-run="both">Run attention + search</button>
        <button data-refresh>Refresh evidence</button>
      </div>
    </div>
    <div class="akre-provider-grid">
      <article><span class="akre-dot live"></span><b>Wikimedia</b><small>ATTENTION · pageviews</small><strong>${attention.length} observations</strong></article>
      <article><span class="akre-dot demand"></span><b>Google Trends</b><small>DEMAND / SEARCH · Trending Now</small><strong>${demand.length} observations</strong></article>
      <article><span class="akre-dot neutral"></span><b>Purchase evidence</b><small>Not inferred from search</small><strong>Insufficient data</strong></article>
    </div>
    <div class="akre-evidence-grid">
      <div class="akre-evidence-block">
        <div class="akre-block-title"><span>Search demand observations</span><em>${latestDemand.length}</em></div>
        ${latestDemand.length ? `<div class="akre-observations">${latestDemand.slice(0, 8).map((o) => `
          <div class="akre-observation">
            <div><b>${esc(o.productName ?? o.query ?? o.name)}</b><small>${esc(o.geography ?? o.geo ?? "—")} · ${fmtDate(o.observedAt ?? o.createdAt)}</small></div>
            <span class="akre-value">${esc(o.value ?? o.actualValue ?? o.metricValue ?? "Observed")}</span>
            <span class="akre-fresh">${freshness(o.observedAt ?? o.createdAt)}</span>
          </div>`).join("")}</div>` : `<div class="akre-empty">No search-demand observations yet. Run the discovery job to retrieve real observations.</div>`}
      </div>
      <div class="akre-evidence-block">
        <div class="akre-block-title"><span>Decision coverage</span><em>${products.length}</em></div>
        ${products.slice(0, 8).map((p) => {
          const o = opportunities.find((x) => x.productId === p.id);
          const intelligence = o?.intelligence ?? {};
          return `<div class="akre-product-row"><div><b>${esc(p.name)}</b><small>${esc(p.category)}</small></div><span>${esc(intelligence.guidance ?? "INSUFFICIENT DATA")}</span><strong>${esc(o?.scoring?.score ?? "—")}</strong></div>`;
        }).join("") || `<div class="akre-empty">No products in the workspace.</div>`}
      </div>
    </div>
    <div class="akre-disclaimer">Evidence rule: ATTENTION and DEMAND/SEARCH remain distinct. No search-interest observation is treated as a sale, conversion, or purchase-demand measurement.</div>
  `;

  panel.querySelector("[data-refresh]")?.addEventListener("click", async () => {
    try { render(await json("/api/state")); } catch (e) { window.alert(e instanceof Error ? e.message : "Unable to refresh evidence"); }
  });
  panel.querySelector("[data-run]")?.addEventListener("click", async () => {
    const button = panel!.querySelector<HTMLButtonElement>("[data-run]");
    if (button) { button.disabled = true; button.textContent = "Running…"; }
    try {
      const payload = { runs: [
        { provider: "wikimedia", payload: {} },
        { provider: "google-trends", payload: { geo: "IN" } },
      ] };
      await json("/api/discovery/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      render(await json("/api/state"));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Discovery run failed");
      if (button) { button.disabled = false; button.textContent = "Run attention + search"; }
    }
  });
}

let lastPath = location.pathname;
async function refresh() {
  if (location.pathname !== lastPath) { lastPath = location.pathname; }
  if (location.pathname !== "/radar" && location.pathname !== "/") {
    document.getElementById(id)?.remove();
    return;
  }
  try { render(await json("/api/state")); } catch { /* main app owns auth/loading errors */ }
}

const observer = new MutationObserver(() => { if (!document.getElementById(id)) void refresh(); });
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("popstate", () => void refresh());
setTimeout(() => void refresh(), 250);
setInterval(() => { if (location.pathname === "/radar" || location.pathname === "/") void refresh(); }, 7000);
