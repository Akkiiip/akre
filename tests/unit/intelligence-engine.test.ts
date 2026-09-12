import { describe, expect, it } from "vitest";
import { commerceIntelligence, dataFreshness, evidenceQuality, guidance } from "../../shared/intelligence";
import { scoreOpportunity } from "../../shared/scoring";

const signals = (observedAt: string) => [{ observedAt } as never];

describe("commerce intelligence evidence rules", () => {
  it("never converts missing purchasing evidence into a test recommendation", () => {
    const inputs = { trendAcceleration: 90, demandStrength: 90, indiaFit: 80, marginPotential: 80 };
    const scoring = scoreOpportunity(inputs);
    const commerce = commerceIntelligence(inputs, undefined, undefined);
    expect(guidance(scoring.score, scoring.confidence, inputs, "FRESH", commerce).guidance).toBe("INSUFFICIENT DATA");
    expect(commerce.estimatedGrossMargin).toBeNull();
  });

  it("marks old signals stale and preserves evidence quality as separate from coverage", () => {
    expect(dataFreshness(signals("2020-01-01T00:00:00.000Z") as never, Date.parse("2026-01-01T00:00:00.000Z")).state).toBe("STALE");
    expect(evidenceQuality([{ confidence: 1 }, { confidence: 0.5 }] as never)).toBe(75);
    expect(evidenceQuality([])).toBeNull();
  });

  it("is deterministic and permits TEST only with complete fresh verified evidence", () => {
    const inputs = { trendAcceleration: 90, demandStrength: 85, indiaFit: 80, marginPotential: 80, contentPotential: 80, novelty: 70, competition: 30, shippingSuitability: 80, supplierAvailability: 80, impulseBuyPotential: 75 };
    const score = scoreOpportunity(inputs);
    const commerce = commerceIntelligence(inputs, { sellingPrice: 999, productCost: 250, shipping: 80, paymentFeeRate: 0, paymentFeeFixed: 0, platformFeeRate: 0, advertisingCost: 0, returnsAllowance: 0, otherVariableCosts: 0 }, { unitCost: 250, shippingCost: 80, reference: "https://supplier.example/quote" });
    expect(guidance(score.score, score.confidence, inputs, "FRESH", commerce).guidance).toBe("TEST");
    expect(scoreOpportunity(inputs)).toEqual(score);
  });
});