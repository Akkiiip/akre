import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Repository } from "../server/database";
import { Service } from "../server/service";
import { ShopifyProvider, YouTubeProvider } from "../server/providers";
const args = process.argv.slice(2),
  arg = (key: string, fallback: string) => {
    const i = args.indexOf(key);
    return i >= 0 ? args[i + 1] : fallback;
  };
const day = (ago: number) =>
  new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
const path = arg("--database", "data/live.sqlite");
const repo = new Repository(path, "LIVE");
const service = new Service(
  repo,
  new ShopifyProvider({}),
  new YouTubeProvider(),
);
try {
  const payload = {
    article: arg("--article", "Air_fryer"),
    category: arg("--category", "Kitchen"),
    project: arg("--project", "en.wikipedia.org"),
    start: arg("--start", day(29)),
    end: arg("--end", day(2)),
  };
  const job = service.enqueue({
    type: "TREND_INGESTION",
    source: "wikimedia",
    payload,
  });
  while (repo.get("jobs", job.id).status === "QUEUED") await service.runNext();
  const completed = repo.get("jobs", job.id);
  if (completed.status !== "COMPLETED")
    throw new Error(completed.error ?? "Ingestion did not complete");
  const data = repo.snapshot(),
    report = {
      verifiedAt: new Date().toISOString(),
      provider: "Wikimedia Analytics API",
      classification:
        "ACTUALLY RETRIEVED AND PERSISTED; historical verification snapshot, not a live fixture",
      region: "GLOBAL",
      interpretation: "Human topic pageviews, not purchasing demand",
      request: payload,
      job: completed,
      products: data.products,
      observations: data.observations.filter((o) => o.sourceId === "wikimedia"),
      signals: data.signals.filter((s) => s.sourceId === "wikimedia"),
      opportunities: data.opportunities,
      scoreHistoryCount: data.scoreHistory.length,
      auditEventCount: data.audit.length,
    };
  if (args.includes("--report")) {
    const output = arg("--report", "docs/verification/live-ingestion.json");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        status: completed.status,
        database: path,
        products: report.products.length,
        observations: report.observations.length,
        signals: report.signals.length,
        scores: report.opportunities.map((o) => ({
          productId: o.productId,
          score: o.scoring.score,
          version: o.scoring.version,
        })),
        verifiedAt: report.verifiedAt,
      },
      null,
      2,
    ),
  );
} finally {
  repo.close();
}
