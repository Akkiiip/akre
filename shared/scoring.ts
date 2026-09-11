import {
  factors,
  type ScoringInputs,
  type ScoreResult,
  type Factor,
} from "./domain";
export const SCORING_VERSION = "akre-score/1.0.0";
export const weights: Record<Factor, number> = {
  trendAcceleration: 15,
  demandStrength: 15,
  novelty: 8,
  contentPotential: 10,
  competition: 8,
  priceAttractiveness: 6,
  shippingSuitability: 7,
  marginPotential: 12,
  supplierAvailability: 7,
  marketFit: 7,
  saturationRisk: 5,
};
const inverse = new Set<Factor>(["competition", "saturationRisk"]);
export const factorLabel = (factor: string) =>
  factor.replace(/([A-Z])/g, " $1").replace(/^./, (v) => v.toUpperCase());
export function scoreOpportunity(inputs: ScoringInputs): ScoreResult {
  const components = factors.map((factor) => {
    const input = inputs[factor] ?? null;
    if (input !== null && (!Number.isFinite(input) || input < 0 || input > 100))
      throw new Error(`${factor} must be normalized to 0–100`);
    const score =
      input === null ? null : inverse.has(factor) ? 100 - input : input;
    return {
      factor,
      input,
      score,
      weight: weights[factor],
      explanation:
        input === null
          ? "Insufficient data"
          : `${factorLabel(factor)}: ${input}/100${inverse.has(factor) ? " (lower is better)" : ""}`,
    };
  });
  const present = components.filter((c) => c.score !== null);
  const coverage = present.reduce((n, c) => n + c.weight, 0);
  // Missing demand or trend prevents a recommendation even with high coverage.
  const eligible =
    coverage >= 60 &&
    inputs.demandStrength != null &&
    inputs.trendAcceleration != null;
  return {
    version: SCORING_VERSION,
    score: eligible
      ? Math.round(
          present.reduce((n, c) => n + c.score! * c.weight, 0) / coverage,
        )
      : null,
    confidence: coverage,
    components,
    positive: present.filter((c) => c.score! >= 70).map((c) => c.explanation),
    negative: present.filter((c) => c.score! < 50).map((c) => c.explanation),
    missing: components.filter((c) => c.score === null).map((c) => c.factor),
  };
}
