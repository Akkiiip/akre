import {
  factors,
  type ScoringInputs,
  type ScoreResult,
  type Factor,
} from "./domain";
export const SCORING_VERSION = "akre-score/1.1.0";
export const weights: Record<Factor, number> = {
  trendAcceleration: 12,
  demandStrength: 14,
  novelty: 7,
  contentPotential: 9,
  competition: 8,
  priceAttractiveness: 6,
  shippingSuitability: 7,
  marginPotential: 11,
  supplierAvailability: 7,
  marketFit: 5,
  saturationRisk: 2,
  indiaFit: 7,
  impulseBuyPotential: 5,
};
const legacyWeights: Record<Factor, number> = { ...weights, indiaFit: 0, impulseBuyPotential: 0, trendAcceleration: 15, demandStrength: 15, novelty: 8, contentPotential: 10, competition: 8, priceAttractiveness: 6, shippingSuitability: 7, marginPotential: 12, supplierAvailability: 7, marketFit: 7, saturationRisk: 5 };
const inverse = new Set<Factor>(["competition", "saturationRisk"]);
export const factorLabel = (factor: string) =>
  factor.replace(/([A-Z])/g, " $1").replace(/^./, (v) => v.toUpperCase());
export const scoringModels: Readonly<
  Record<string, Readonly<Record<Factor, number>>>
> = Object.freeze({ [SCORING_VERSION]: Object.freeze({ ...weights }), "akre-score/1.0.0": Object.freeze({ ...legacyWeights }) });
export function scoreOpportunity(
  inputs: ScoringInputs,
  version = SCORING_VERSION,
): ScoreResult {
  const model = scoringModels[version];
  if (!model)
    throw new Error(
      `Unknown scoring version: ${version}. Explicit current-model recalculation is required.`,
    );
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
      weight: model[factor],
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
    version,
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
