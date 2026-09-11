import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { Repository } from "../server/database";
import { Service } from "../server/service";
import { ShopifyProvider, YouTubeProvider } from "../server/providers";
import { evidenceState } from "../shared/evidence";
const repo = new Repository(
  process.env.AKRE_LIVE_DATABASE ?? "data/live.sqlite",
  "LIVE",
);
const demo = new Repository(":memory:", "DEMO");
try {
  const d = repo.snapshot(),
    product = d.products.find((p) => p.canonicalName === "Air fryer");
  assert.ok(product);
  const observations = d.observations.filter(
    (o) => o.sourceId === "wikimedia" && o.productName === "Air fryer",
  );
  const signals = d.signals.filter(
    (s) => s.sourceId === "wikimedia" && s.productId === product.id,
  );
  assert.equal(observations.length, 28);
  assert.equal(signals.length, 8);
  assert.equal(new Set(observations.map((o) => o.externalId)).size, 28);
  for (const o of observations) {
    assert.ok(o.fetchedAt);
    assert.equal(o.mode, "LIVE");
    assert.equal(o.signalValue, o.payload.views);
    assert.equal(o.payload.article, "Air_fryer");
  }
  for (const s of signals) assert.equal(s.factor, "trendAcceleration");
  const opportunity = d.opportunities.find((o) => o.productId === product.id)!;
  assert.ok(opportunity);
  assert.equal(opportunity.scoring.score, null);
  assert.equal(opportunity.inputs.demandStrength, undefined);
  assert.equal(opportunity.scoreVersion, "akre-score/1.0.0");
  assert.ok(d.audit.some((a) => a.action === "WIKIMEDIA_INGESTED"));
  assert.ok(d.audit.some((a) => a.action === "OPPORTUNITY_SCORED"));
  assert.ok(
    d.jobs.some((j) => j.source === "wikimedia" && j.status === "COMPLETED"),
  );
  const before = JSON.stringify(d);
  for (const kind of ["scoreHistory", "audit"] as const) {
    assert.ok(d[kind].length);
    assert.throws(() => repo.put(kind, d[kind][0]), /append-only/);
    assert.throws(
      () => repo.db.prepare("DELETE FROM records WHERE kind=?").run(kind),
      /append-only/,
    );
  }
  assert.equal(JSON.stringify(repo.snapshot()), before);
  assert.ok(
    Object.values(d)
      .flat()
      .every((e) => e.mode === "LIVE"),
  );
  assert.ok(demo.list("products").every((p) => p.mode === "DEMO"));
  assert.equal(
    demo.list("observations").some((o) => o.sourceId === "wikimedia"),
    false,
  );
  const service = new Service(
    repo,
    new ShopifyProvider({}),
    new YouTubeProvider(),
  );
  assert.equal(
    service.integrations().find((i) => i.source === "shopify")?.status,
    "NOT CONFIGURED",
  );
  assert.equal(evidenceState(product, d), "LIVE");
  const report = {
    verifiedAt: new Date().toISOString(),
    database: "data/live.sqlite",
    product: product.canonicalName,
    observations: observations.length,
    attentionAccelerationSignals: signals.length,
    score: opportunity.scoring.score,
    scoreVersion: opportunity.scoreVersion,
    missingPurchasingEvidence: true,
    auditEvents: d.audit.length,
    immutableScoreSnapshots: d.scoreHistory.length,
    immutableUpdateAndDeleteVerified: true,
    demoSeparationVerified: true,
    sourceState: evidenceState(product, d),
    shopifyWithoutCredentials: "NOT CONFIGURED",
    note: "Read existing persisted source data; no provider responses or business metrics generated.",
  };
  writeFileSync(
    "docs/verification/live-persistence.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  repo.close();
  demo.close();
}
