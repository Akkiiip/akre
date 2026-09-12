const KEY = "akre-live-discovery-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(body?.detail || body?.error || `Request failed (${response.status})`);
  return body;
}

async function discoverLiveCandidates() {
  if (location.pathname !== "/radar" && location.pathname !== "/") return;
  if (sessionStorage.getItem(KEY)) return;
  try {
    const state = await json("/api/state");
    if (state?.mode !== "LIVE") return;
    const last = Number(localStorage.getItem(KEY) || 0);
    if (Number.isFinite(last) && last > Date.now() - DAY_MS) return;
    sessionStorage.setItem(KEY, "running");
    const result = await json("/api/discovery/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "google-trends",
        payload: { geo: "IN", category: "Unclassified", maxResults: 50 },
      }),
    });
    if ((result?.jobs ?? []).some((job: any) => job.status === "COMPLETED")) {
      localStorage.setItem(KEY, String(Date.now()));
      window.dispatchEvent(new CustomEvent("akre:live-discovery-complete"));
    }
  } catch (error) {
    sessionStorage.removeItem(KEY);
    console.warn("AKRE live discovery unavailable", error);
  }
}

window.addEventListener("popstate", () => void discoverLiveCandidates());
window.addEventListener("akre:live-discovery-request", () => void discoverLiveCandidates());
setTimeout(() => void discoverLiveCandidates(), 900);
