import { describe, it, expect } from "vitest";
import { scoreOpportunity, weights } from "../../shared/scoring";
import { economics } from "../../shared/economics";
import {
  normalize,
  identityKey,
  deduplicate,
  aggregateSignals,
} from "../../shared/discovery";
import { assertTransition } from "../../shared/lifecycle";
import { evaluateExperiment } from "../../shared/experiments";
import { analytics } from "../../shared/analytics";
import { seed } from "../../server/seed";
import type {
  Experiment,
  ExperimentMetric,
  ScoringInputs,
} from "../../shared/domain";
const cost = {
  sellingPrice: 100,
  productCost: 20,
  shipping: 5,
  paymentFeeRate: 0.03,
  paymentFeeFixed: 1,
  platformFeeRate: 0.02,
  advertisingCost: 15,
  returnsAllowance: 4,
  otherVariableCosts: 2,
};
const base = {
  id: "e",
  workspaceId: "default",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  mode: "DEMO" as const,
};
const experiment: Experiment = {
  ...base,
  productId: "p",
  channel: "test",
  sellingPrice: 100,
  creativeId: "c",
  budget: 1000,
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  successCriteria: {
    minImpressions: 1000,
    minClicks: 100,
    minPurchases: 10,
    maxSpend: 1000,
    targetRoas: 2,
    minContributionProfit: 50,
  },
  killCriteria: { maxLoss: 400 },
  status: "DRAFT",
  costSnapshot: cost,
};
const metric: ExperimentMetric = {
  ...base,
  id: "m",
  experimentId: "e",
  date: "2026-09-01",
  impressions: 1000,
  clicks: 100,
  addToCart: 30,
  checkout: 20,
  purchases: 10,
  revenue: 1000,
  spend: 200,
  reference: "test evidence",
};
describe("deterministic explainable scoring", () => {
  it("uses weights totaling 100 with risk factors inverted", () => {
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
    const inputs = Object.fromEntries(
      Object.keys(weights).map((k) => [
        k,
        ["competition", "saturationRisk"].includes(k) ? 20 : 80,
      ]),
    ) as ScoringInputs;
    const s = scoreOpportunity(inputs);
    expect(s.score).toBe(80);
    expect(s.confidence).toBe(100);
    expect(s).toEqual(scoreOpportunity(inputs));
    expect(s.components.find((c) => c.factor === "competition")?.score).toBe(
      80,
    );
  });
  it("does not manufacture missing evidence or equate missing with zero", () => {
    expect(scoreOpportunity({}).score).toBeNull();
    const s = scoreOpportunity({
      trendAcceleration: 0,
      demandStrength: 0,
      contentPotential: 0,
      marginPotential: 0,
      marketFit: 0,
      indiaFit: 0,
      shippingSuitability: 0,
    });
    expect(s.score).toBe(0);
    expect(s.missing).toContain("competition");
    expect(s.confidence).toBe(65);
  });
  it("requires demand and acceleration even at high coverage", () => {
    const inputs = Object.fromEntries(Object.keys(weights).map((k) => [k, 80]));
    delete inputs.demandStrength;
    expect(scoreOpportunity(inputs).score).toBeNull();
  });
  it.each([-1, 101, NaN, Infinity])("rejects invalid input %s", (value) =>
    expect(() => scoreOpportunity({ demandStrength: value })).toThrow(),
  );
});
describe("contribution economics", () => {
  it("accounts for every variable cost and explicit margin denominator", () => {
    const e = economics(cost);
    expect(e.variableCost).toBe(52);
    expect(e.contributionProfit).toBe(48);
    expect(e.grossMargin).toBe(0.75);
    expect(e.contributionMargin).toBe(0.48);
    expect(e.maximumAllowableAcquisitionCost).toBe(63);
    expect(e.breakEvenSellingPrice).toBeCloseTo(47 / 0.95);
  });
  it("break-even price produces zero contribution", () => {
    const p = economics(cost).breakEvenSellingPrice;
    expect(
      economics({ ...cost, sellingPrice: p }).contributionProfit,
    ).toBeCloseTo(0);
  });
  it("zero revenue produces unknown margins, negative contribution remains negative", () => {
    expect(
      economics({ ...cost, sellingPrice: 0 }).contributionMargin,
    ).toBeNull();
    expect(
      economics({ ...cost, sellingPrice: 10 }).contributionProfit,
    ).toBeLessThan(0);
  });
  it("rejects invalid costs and impossible fees", () => {
    expect(() => economics({ ...cost, shipping: -1 })).toThrow();
    expect(() => economics({ ...cost, paymentFeeRate: 1 })).toThrow();
    expect(() => economics({ ...cost, advertisingCost: NaN })).toThrow();
  });
});
describe("normalization and identity", () => {
  it("normalizes in a declared range and clamps outliers", () => {
    expect(normalize(150, 100, 200)).toBe(50);
    expect(normalize(-10, 0, 100)).toBe(0);
    expect(normalize(500, 0, 100)).toBe(100);
    expect(() => normalize(1, 2, 2)).toThrow();
  });
  it("conservatively groups punctuation/case differences but not variants", () => {
    expect(identityKey("  PET—Bottle! ")).toBe(identityKey("pet bottle"));
    expect(identityKey("Bottle 500ml")).not.toBe(identityKey("Bottle 1L"));
    expect(identityKey("पानी बोतल")).toContain("प");
  });
  it("deduplicates a source observation without collapsing separate sources", () => {
    const o = seed("DEMO").observations[0];
    expect(
      deduplicate([
        o,
        { ...o, id: "duplicate" },
        { ...o, id: "other", sourceId: "other" },
      ]),
    ).toHaveLength(2);
  });
  it("uses latest signal per source rather than overweighting repeated polls", () => {
    const s = seed("DEMO").signals[0];
    const input = aggregateSignals([
      { ...s, normalizedValue: 10 },
      { ...s, id: "new", observedAt: "2026-09-02", normalizedValue: 80 },
      { ...s, id: "source2", sourceId: "other", normalizedValue: 40 },
    ]);
    expect(input[s.factor]).toBe(60);
  });
});
describe("lifecycle gates", () => {
  it("permits sequential approval and forbids skipping testing", () => {
    expect(() => assertTransition("DISCOVERED", "SHORTLISTED")).not.toThrow();
    expect(() => assertTransition("DISCOVERED", "SCALING")).toThrow();
    expect(() => assertTransition("ARCHIVED", "DISCOVERED")).toThrow();
  });
});
describe("experiment decisions", () => {
  it("requires traffic before every recommendation", () => {
    expect(evaluateExperiment(experiment, []).verdict).toBe(
      "INSUFFICIENT DATA",
    );
    expect(
      evaluateExperiment(experiment, [
        { ...metric, impressions: 20, clicks: 1, spend: 10000 },
      ]).verdict,
    ).toBe("INSUFFICIENT DATA");
  });
  it("scales only with enough purchases and profitable actual spend", () => {
    const r = evaluateExperiment(experiment, [metric]);
    expect(r.verdict).toBe("SCALE");
    expect(r.metrics.contributionProfit).toBe(430);
    expect(r.metrics.ctr).toBe(0.1);
    expect(r.metrics.roas).toBe(5);
  });
  it("kills on a loss guardrail even with no conversions once traffic is sufficient", () => {
    expect(
      evaluateExperiment(experiment, [
        { ...metric, purchases: 0, revenue: 0, spend: 500 },
      ]).verdict,
    ).toBe("KILL");
  });
  it("does not scale on a small purchase sample", () => {
    expect(
      evaluateExperiment(experiment, [
        { ...metric, purchases: 1, revenue: 100, spend: 20 },
      ]).verdict,
    ).toBe("INSUFFICIENT DATA");
  });
  it("watches a sufficient sample below ROAS target without breached guards", () => {
    expect(
      evaluateExperiment(experiment, [{ ...metric, spend: 600 }]).verdict,
    ).toBe("WATCH");
  });
  it("ignores metrics belonging to a different experiment", () => {
    expect(
      evaluateExperiment(experiment, [{ ...metric, experimentId: "other" }])
        .verdict,
    ).toBe("INSUFFICIENT DATA");
  });
});
describe("analytics missing values", () => {
  it("has no made-up series and never reports unknown contribution as zero", () => {
    const a = analytics([], [], "2026-09-01", "2026-09-30");
    expect(a.series).toEqual([]);
    expect(a.contributionProfit).toBeNull();
    expect(a.roas).toBeNull();
  });
  it("filters dates and leaves missing cost data unavailable", () => {
    const order = {
      ...base,
      storeId: "s",
      externalId: "external",
      orderedAt: "2026-09-02T00:00:00Z",
      currency: "INR",
      revenue: 100,
      refunds: 10,
      variableCosts: null,
      acquisitionCost: null,
      customerId: null,
    };
    const a = analytics([order], [], "2026-09-02", "2026-09-02");
    expect(a.revenue).toBe(90);
    expect(a.orders).toBe(1);
    expect(a.contributionProfit).toBeNull();
    expect(analytics([order], [], "2026-09-03", "2026-09-04").orders).toBe(0);
  });
});
