import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { Repository } from "../../server/database";
import { Service } from "../../server/service";
import { ShopifyProvider, YouTubeProvider } from "../../server/providers";
import {
  WikimediaProvider,
  parsePageviews,
  attentionSignals,
  ingestionInput,
} from "../../server/wikimedia";
import { matchProduct, recompute } from "../../server/intelligence";
import { evidenceState } from "../../shared/evidence";
import {
  SCORING_VERSION,
  weights,
  scoreOpportunity,
} from "../../shared/scoring";
const day = (ago: number) =>
  new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
const input = () => ({
  article: "Air_fryer",
  category: "Kitchen",
  project: "en.wikipedia.org" as const,
  start: day(29),
  end: day(2),
});
function response() {
  return {
    items: Array.from({ length: 28 }, (_, i) => ({
      project: "en.wikipedia",
      article: "Air_fryer",
      granularity: "daily",
      timestamp: day(29 - i).replaceAll("-", "") + "00",
      access: "all-access",
      agent: "user",
      views: 100,
    })),
  };
}
let repo: Repository, service: Service, provider: WikimediaProvider;
beforeEach(() => {
  repo = new Repository(":memory:", "LIVE");
  provider = new WikimediaProvider();
  service = new Service(
    repo,
    new ShopifyProvider({}),
    new YouTubeProvider(),
    provider,
  );
});
afterEach(() => {
  repo.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("validates official response metadata and stores raw separately from normalized envelope", () => {
  const rows = parsePageviews(response(), input());
  expect(rows).toHaveLength(28);
  expect(rows[0].region).toBe("GLOBAL");
  expect(rows[0].signalType).toBe("HUMAN_PAGEVIEWS");
  expect(rows[0].payload).toHaveProperty("views", 100);
  expect(rows[0].observedAt).toContain("T00:00:00.000Z");
  expect(rows[0].confidence).toBe(1);
  expect(() =>
    parsePageviews({ items: [{ ...response().items[0], views: -1 }] }, input()),
  ).toThrow();
  expect(() =>
    parsePageviews(
      { items: [{ ...response().items[0], article: "Unrelated" }] },
      input(),
    ),
  ).toThrow();
});
it("deduplicates identical days and rejects conflicting duplicate values", () => {
  const r = response();
  r.items.push(r.items[0]);
  expect(parsePageviews(r, input())).toHaveLength(28);
  r.items.push({ ...r.items[0], views: 200 });
  expect(() => parsePageviews(r, input())).toThrow("Conflicting");
});
it("requires complete three-week windows and never infers purchasing demand", () => {
  const rows = parsePageviews(response(), input()),
    signals = attentionSignals(rows, "p");
  expect(signals).toHaveLength(8);
  expect(signals[0].rawValue).toBe(0);
  expect(signals[0].normalizedValue).toBe(50);
  expect(signals.every((s) => s.factor === "trendAcceleration")).toBe(true);
  expect(attentionSignals(rows.slice(0, 20), "p")).toHaveLength(0);
  expect(
    attentionSignals(
      rows.filter((_, i) => i !== 10),
      "p",
    ),
  ).toHaveLength(0);
  expect(
    attentionSignals(
      rows.map((o) => ({ ...o, signalValue: 0 })),
      "p",
    ),
  ).toHaveLength(0);
});
it("persists a full ingestion atomically, idempotently, with auditable snapshots", async () => {
  vi.spyOn(provider, "fetch").mockResolvedValue(
    parsePageviews(response(), input()),
  );
  for (let n = 0; n < 2; n++) {
    const job = service.enqueue({
      type: "TREND_INGESTION",
      source: "wikimedia",
      payload: input(),
    });
    await service.runNext();
    expect(repo.get("jobs", job.id).status).toBe("COMPLETED");
  }
  expect(repo.list("observations")).toHaveLength(28);
  expect(repo.list("signals")).toHaveLength(8);
  expect(repo.list("products")).toHaveLength(1);
  expect(repo.list("scoreHistory")).toHaveLength(2);
  expect(repo.list("opportunities")[0].scoring.score).toBeNull();
  expect(repo.list("opportunities")[0].inputs.demandStrength).toBeUndefined();
  expect(
    repo.list("audit").some((e) => e.action === "WIKIMEDIA_INGESTED"),
  ).toBe(true);
  expect(evidenceState(repo.list("products")[0], repo.snapshot())).toBe("LIVE");
});
it("records errors and allows a safe explicit retry without partial records", async () => {
  vi.spyOn(provider, "fetch")
    .mockRejectedValueOnce(new Error("Wikimedia HTTP 429"))
    .mockResolvedValueOnce(parsePageviews(response(), input()));
  const j = service.enqueue({
    type: "TREND_INGESTION",
    source: "wikimedia",
    payload: input(),
  });
  await service.runNext();
  expect(repo.get("jobs", j.id).status).toBe("ERROR");
  expect(repo.list("observations")).toHaveLength(0);
  expect(
    service.integrations().find((i) => i.provider === "Wikimedia")?.status,
  ).toBe("ERROR");
  service.retry(j.id);
  await service.runNext();
  expect(repo.get("jobs", j.id).retryCount).toBe(1);
  expect(repo.get("jobs", j.id).status).toBe("COMPLETED");
});
it("preserves historical scores, requires explicit version migration and prevents snapshot overwrite", async () => {
  vi.spyOn(provider, "fetch").mockResolvedValue(
    parsePageviews(response(), input()),
  );
  service.enqueue({
    type: "TREND_INGESTION",
    source: "wikimedia",
    payload: input(),
  });
  await service.runNext();
  const original = repo.list("scoreHistory")[0],
    opportunity = repo.list("opportunities")[0];
  repo.put("opportunities", {
    ...opportunity,
    scoring: { ...opportunity.scoring, version: "old-unsupported-model" },
  });
  expect(() =>
    repo.transaction(() =>
      recompute(service, opportunity.productId, "INGESTION"),
    ),
  ).toThrow("Unknown scoring version");
  repo.transaction(() =>
    recompute(service, opportunity.productId, "EXPLICIT_CURRENT_MODEL", true),
  );
  expect(repo.list("opportunities")[0].scoreVersion).toBe(SCORING_VERSION);
  expect(repo.list("scoreHistory").find((h) => h.id === original.id)).toEqual(
    original,
  );
  expect(() =>
    repo.put("scoreHistory", { ...original, reason: "overwritten" }),
  ).toThrow("append-only");
});
it("treats expired evidence as stale and excludes it from explicit recalculation", async () => {
  vi.spyOn(provider, "fetch").mockResolvedValue(
    parsePageviews(response(), input()),
  );
  service.enqueue({
    type: "TREND_INGESTION",
    source: "wikimedia",
    payload: input(),
  });
  await service.runNext();
  const p = repo.list("products")[0];
  expect(evidenceState(p, repo.snapshot(), Date.now() + 10 * 86400000)).toBe(
    "STALE",
  );
  for (const s of repo.list("signals"))
    repo.put("signals", { ...s, validUntil: "2000-01-01T00:00:00Z" });
  repo.transaction(() =>
    recompute(service, p.id, "EXPLICIT_CURRENT_MODEL", true),
  );
  expect(repo.list("opportunities")[0].inputs).toEqual({});
});
it("uses conservative category-aware identity and rejects ambiguous matches", () => {
  const base = {
    id: "one",
    workspaceId: "default",
    mode: "LIVE" as const,
    createdAt: day(1),
    updatedAt: day(1),
    name: "Bottle 500ml",
    category: "Kitchen",
    identityKey: "bottle 500ml",
    lifecycle: "DISCOVERED" as const,
    supplierIds: [],
    aliases: ["Travel bottle 500ml"],
  };
  expect(matchProduct([base], "Travel bottle 500ml", "Kitchen", null)?.id).toBe(
    "one",
  );
  expect(
    matchProduct([base], "Bottle 1000ml", "Kitchen", null),
  ).toBeUndefined();
  expect(
    matchProduct([base], "Bottle 500ml", "Industrial", null),
  ).toBeUndefined();
  expect(() =>
    matchProduct(
      [base, { ...base, id: "two" }],
      "Bottle 500ml",
      "Kitchen",
      null,
    ),
  ).toThrow("Ambiguous");
});
it("rejects future or unbounded provider ranges and retains deterministic model weights", () => {
  expect(() =>
    ingestionInput.parse({ ...input(), end: "2999-01-01" }),
  ).toThrow();
  expect(() =>
    ingestionInput.parse({ ...input(), start: "2000-01-01" }),
  ).toThrow();
  const before = scoreOpportunity({
    trendAcceleration: 70,
    demandStrength: 70,
  });
  const old = weights.trendAcceleration;
  weights.trendAcceleration = 99;
  expect(
    scoreOpportunity({ trendAcceleration: 70, demandStrength: 70 }),
  ).toEqual(before);
  weights.trendAcceleration = old;
});
it("fails closed on HTTP failure or invalid JSON schema", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
  );
  await expect(provider.fetch(input())).rejects.toThrow("503");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"items":[]}')),
  );
  await expect(provider.fetch(input())).rejects.toThrow();
});
