type Row = Record<string, any>;

const ID = "akre-radar-live";
let rendering = false;

const esc = (value: unknown): string =>
  String(value ?? "—").replace(/[&<>\"]/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return map[char] ?? char;
  });

async function json(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || `Request failed (${response.status})`);
  }
  return body;
}

function classification(product: Row, observations: Row[]): string {
  return String(
    observations.find((item) => item.productName === product.name)?.payload?.productClassification ??
      "AMBIGUOUS",
  );
}

function trendObservation(product: Row, observations: Row[]): Row | undefined {
  return observations.find((item) => item.productName === product.name);
}

function candidateMarkup(product: Row, index: number, observation: Row | undefined, opportunity: Row | undefined): string {
  const selectedClass = index === 0 ? " selected" : "";
  const traffic = Number(observation?.signalValue ?? 0);
  return [
    `<div class="radarCandidate${selectedClass}">`,
    `<span class="radarRank">${index + 1}</span>`,
    `<span class="radarCandidateMain"><b>${esc(product.name)}</b>`,
    `<small>${esc(product.category)} · ${traffic.toLocaleString("en-IN")} approx searches</small></span>`,
    `<span class="radarScore">${esc(opportunity?.scoring?.score ?? "—")}</span>`,
    `<span class="radarStatus">NEW</span>`,
    `</div>`,
  ].join("");
}

function decisionMarkup(
  selected: Row | undefined,
  offers: Row[],
  costs: Row[],
): string {
  if (!selected) {
    return `<div class="empty">No fresh product candidate is currently available.</div>`;
  }

  const hasOffer = offers.some((offer) => offer.productId === selected.id);
  const hasCost = costs.some((cost) => cost.productId === selected.id);
  const category = String(selected.category || "?");

  return [
    `<div class="radarProductHead">`,
    `<div class="productIcon">${esc(category.slice(0, 1))}</div>`,
    `<div><div class="smallcaps">${esc(category)}</div>`,
    `<h3>${esc(selected.name)}</h3><p>LIVE Google Trends → PRODUCT</p></div>`,
    `</div>`,
    `<div class="radarSteps">`,
    `<div class="radarStep done"><b>01</b><span>Live trend</span><strong>FOUND</strong></div>`,
    `<div class="radarStep done"><b>02</b><span>Product intent</span><strong>PRODUCT</strong></div>`,
    `<div class="radarStep ${hasOffer ? "done" : "wait"}"><b>03</b><span>Supplier</span><strong>${hasOffer ? "FOUND" : "MISSING"}</strong></div>`,
    `<div class="radarStep ${hasCost ? "done" : "wait"}"><b>04</b><span>Economics</span><strong>${hasCost ? "READY" : "MISSING"}</strong></div>`,
    `<div class="radarStep wait"><b>05</b><span>Test</span><strong>GATED</strong></div>`,
    `</div>`,
  ].join("");
}

function supplierResultsMarkup(local: any, cj: any): string {
  const localRows = Array.isArray(local?.suppliers) ? local.suppliers : [];
  const cjRows = Array.isArray(cj?.products) ? cj.products : [];

  const researched = localRows.length
    ? localRows
        .map(
          (supplier: Row) =>
            `<div class="record"><b>${esc(supplier.name)}</b><p>${esc(supplier.status)} · ${esc(supplier.integration)}</p><small>${esc(supplier.evidence?.reviewSummary || "Evidence captured")}</small></div>`,
        )
        .join("")
    : `<div class="empty">No researched supplier match.</div>`;

  const liveCj = cjRows.length
    ? cjRows
        .map(
          (product: Row) =>
            `<div class="record"><b>${esc(product.name ?? product.nameEn ?? product.sku)}</b><p>${esc(product.sellPriceUsd ?? product.sellPrice ?? "—")} USD · stock ${esc(product.inventory ?? product.verifiedInventory ?? "unknown")}</p></div>`,
        )
        .join("")
    : `<div class="empty">CJ is not configured or no live match was returned.</div>`;

  return [
    `<div class="contentgrid">`,
    `<div><h3>Researched India suppliers</h3>${researched}</div>`,
    `<div><h3>Live CJ catalog</h3>${liveCj}</div>`,
    `</div>`,
  ].join("");
}

async function render(): Promise<void> {
  if (rendering) return;
  rendering = true;

  try {
    const onRadar = location.pathname === "/radar" || location.pathname === "/";
    const workspace = document.querySelector<HTMLElement>("fieldset.workspace");

    if (!onRadar || !workspace) {
      document.getElementById(ID)?.remove();
      if (workspace) workspace.style.display = "";
      return;
    }

    workspace.style.display = "none";

    let root = document.getElementById(ID);
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

      const liveObservations = observations.filter((item) => item.sourceId === "google-trends");
      const candidates = products
        .filter(
          (product) =>
            liveObservations.some((item) => item.productName === product.name) &&
            classification(product, liveObservations) === "PRODUCT",
        )
        .sort((left, right) => {
          const leftSignal = Number(trendObservation(left, liveObservations)?.signalValue ?? 0);
          const rightSignal = Number(trendObservation(right, liveObservations)?.signalValue ?? 0);
          return rightSignal - leftSignal;
        });

      const selected = candidates[0];
      const candidateRows = candidates.length
        ? candidates
            .slice(0, 15)
            .map((product, index) => {
              const observation = trendObservation(product, liveObservations);
              const opportunity = opportunities.find((item) => item.productId === product.id);
              return candidateMarkup(product, index, observation, opportunity);
            })
            .join("")
        : `<div class="empty">No fresh product-intent candidates were returned. Click refresh to run the live feed again.</div>`;

      const economicsReady = candidates.filter(
        (product) =>
          offers.some((offer) => offer.productId === product.id) &&
          costs.some((cost) => cost.productId === product.id),
      ).length;

      root.innerHTML = [
        `<div class="radarCommand">`,
        `<section class="radarHero"><div>`,
        `<div class="smallcaps">COMMERCE COMMAND CENTER · INDIA</div>`,
        `<h2>Fresh products from live search demand</h2>`,
        `<p>AKRE now shows only candidates created from the current Google Trends feed. Existing manual products cannot occupy this list.</p>`,
        `<div class="actions"><button data-refresh>Refresh live India trends</button>`,
        selected
          ? `<button data-suppliers>Find suppliers for ${esc(selected.name)}</button>`
          : "",
        `</div></div>`,
        `<div class="radarGate"><span>PIPELINE</span><b>LIVE TREND</b><i>→</i><b>PRODUCT</b><i>→</i><b>SUPPLIER</b><i>→</i><b>ECONOMICS</b><i>→</i><b>TEST</b></div>`,
        `</section>`,
        `<section class="metrics">`,
        `<div class="metric"><span>Fresh Google Trends signals</span><strong>${liveObservations.length}</strong><small>India · past 24h feed</small></div>`,
        `<div class="metric"><span>Product candidates</span><strong>${candidates.length}</strong><small>Strict product intent</small></div>`,
        `<div class="metric"><span>Supplier offers</span><strong>${offers.length}</strong><small>Recorded evidence</small></div>`,
        `<div class="metric"><span>Economics ready</span><strong>${economicsReady}</strong><small>Supplier + cost</small></div>`,
        `</section>`,
        `<div class="contentgrid">`,
        `<section class="panel"><div class="panelTitle"><h2>New product candidates</h2><span class="badge source-evidence">GOOGLE TRENDS</span></div>${candidateRows}</section>`,
        `<section class="panel"><div class="panelTitle"><h2>Decision gate</h2><span class="badge">${selected ? "NEW CANDIDATE" : "WAITING"}</span></div>${decisionMarkup(selected, offers, costs)}</section>`,
        `</div>`,
        `<section class="panel radarEvidence"><div class="panelTitle"><h2>Supplier intelligence</h2><span class="badge">EVIDENCE SEPARATED</span></div>`,
        `<div id="${ID}-results"><div class="empty">Supplier matching starts after a fresh product candidate is found.</div></div>`,
        `</section>`,
        `<div class="radarFootnote">Search interest is demand evidence, not purchase proof. Supplier research is not live inventory until connected.</div>`,
        `</div>`,
      ].join("");

      root.querySelector("[data-refresh]")?.addEventListener("click", async () => {
        const button = root?.querySelector<HTMLButtonElement>("[data-refresh]");
        if (button) {
          button.disabled = true;
          button.textContent = "Refreshing…";
        }
        try {
          await json("/api/discovery/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "google-trends",
              payload: { geo: "IN", category: "Unclassified", maxResults: 50 },
            }),
          });
          await render();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Discovery failed");
          if (button) button.disabled = false;
        }
      });

      root.querySelector("[data-suppliers]")?.addEventListener("click", async () => {
        const results = root?.querySelector<HTMLElement>(`#${ID}-results`);
        if (!results || !selected) return;
        results.innerHTML = `<div class="empty">Matching researched India suppliers and the live CJ catalog…</div>`;

        try {
          const local = await json("/api/suppliers/catalogs/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: selected.name, category: selected.category }),
          });

          let cj: any = null;
          try {
            cj = await json("/api/suppliers/cj/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                keyword: selected.name,
                countryCode: "IN",
                page: 1,
                size: 10,
              }),
            });
          } catch {
            cj = null;
          }

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

const observer = new MutationObserver(() => {
  if (location.pathname === "/radar" || location.pathname === "/") {
    setTimeout(() => void render(), 150);
  }
});

if (document.body) observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener("popstate", () => void render());
setTimeout(() => void render(), 700);
