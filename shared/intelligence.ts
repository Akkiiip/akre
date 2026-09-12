import type { EconomicsInputs, SourceObservation, TrendSignal } from "./domain";

export type IntelligenceFreshness = "FRESH" | "AGING" | "STALE" | "NO EVIDENCE";
export type OpportunityGuidance = "TEST" | "WATCH" | "REJECT" | "INSUFFICIENT DATA";

export interface CommerceIntelligence {
  estimatedSellingPrice: number | null;
  supplierCost: number | null;
  shippingCost: number | null;
  estimatedGrossMargin: number | null;
  impulseBuyPotential: number | null;
  indiaFit: number | null;
  competitionLevel: number | null;
  contentCreativePotential: number | null;
  novelty: number | null;
  economicsSource: "VERIFIED_SUPPLIER_OFFER" | "OPERATOR_ASSUMPTION" | "INSUFFICIENT DATA";
}

export interface IntelligenceSummary {
  trendDirection: "ACCELERATING" | "STEADY" | "DECELERATING" | "INSUFFICIENT DATA";
  dataFreshness: IntelligenceFreshness;
  evidenceQuality: number | null;
  latestEvidenceAt: string | null;
  missingDataFlags: string[];
  commerce: CommerceIntelligence;
  guidance: OpportunityGuidance;
  guidanceReasons: string[];
}

export function dataFreshness(
  signals: TrendSignal[],
  now = Date.now(),
): { state: IntelligenceFreshness; latestEvidenceAt: string | null } {
  const latest = signals
    .map((signal) => signal.observedAt)
    .filter((value) => !Number.isNaN(Date.parse(value)))
    .sort()
    .at(-1);
  if (!latest) return { state: "NO EVIDENCE", latestEvidenceAt: null };
  const ageDays = (now - Date.parse(latest)) / 86_400_000;
  return {
    state: ageDays <= 7 ? "FRESH" : ageDays <= 30 ? "AGING" : "STALE",
    latestEvidenceAt: latest,
  };
}

export function evidenceQuality(observations: SourceObservation[]) {
  const quality = observations
    .map((observation) => observation.confidence)
    .filter((value): value is number => value != null && Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(1, value)));
  return quality.length
    ? Math.round((quality.reduce((sum, value) => sum + value, 0) / quality.length) * 100)
    : null;
}

export function commerceIntelligence(
  inputs: Record<string, number | null | undefined>,
  economics: EconomicsInputs | undefined,
  supplierOffer: { unitCost: number; shippingCost: number | null; reference: string | null } | undefined,
): CommerceIntelligence {
  const verified = !!supplierOffer?.reference && supplierOffer.shippingCost !== null;
  return {
    estimatedSellingPrice: economics?.sellingPrice ?? null,
    supplierCost: verified ? supplierOffer!.unitCost : null,
    shippingCost: verified ? supplierOffer!.shippingCost : null,
    estimatedGrossMargin:
      economics && economics.sellingPrice > 0
        ? Math.round(((economics.sellingPrice - economics.productCost - economics.shipping) / economics.sellingPrice) * 100)
        : null,
    impulseBuyPotential: inputs.impulseBuyPotential ?? null,
    indiaFit: inputs.indiaFit ?? null,
    competitionLevel: inputs.competition ?? null,
    contentCreativePotential: inputs.contentPotential ?? null,
    novelty: inputs.novelty ?? null,
    economicsSource: verified
      ? "VERIFIED_SUPPLIER_OFFER"
      : economics
        ? "OPERATOR_ASSUMPTION"
        : "INSUFFICIENT DATA",
  };
}

export function guidance(
  score: number | null,
  confidence: number,
  inputs: Record<string, number | null | undefined>,
  freshness: IntelligenceFreshness,
  commerce: CommerceIntelligence,
): Pick<IntelligenceSummary, "guidance" | "guidanceReasons" | "trendDirection" | "missingDataFlags"> {
  const missing = [
    ["demandStrength", "Purchase-demand evidence"],
    ["trendAcceleration", "Trend acceleration evidence"],
    ["indiaFit", "India-fit assessment"],
    ["marginPotential", "Margin-potential assessment"],
  ].filter(([factor]) => inputs[factor] == null).map(([, label]) => label);
  if (commerce.economicsSource !== "VERIFIED_SUPPLIER_OFFER")
    missing.push("Verified supplier cost and shipping quote");
  const trendDirection =
    inputs.trendAcceleration == null
      ? "INSUFFICIENT DATA"
      : inputs.trendAcceleration >= 60
        ? "ACCELERATING"
        : inputs.trendAcceleration < 40
          ? "DECELERATING"
          : "STEADY";
  if (score === null || missing.length)
    return {
      guidance: "INSUFFICIENT DATA",
      guidanceReasons: ["AKRE will not recommend a test while required evidence is missing.", ...missing],
      trendDirection,
      missingDataFlags: missing,
    };
  if (freshness === "STALE" || freshness === "NO EVIDENCE")
    return {
      guidance: "WATCH",
      guidanceReasons: ["Evidence is stale; refresh sources before spending on a test."],
      trendDirection,
      missingDataFlags: [],
    };
  if (score >= 70 && confidence >= 60)
    return {
      guidance: "TEST",
      guidanceReasons: ["Demand, economics, India fit and supplier quote meet the current testing threshold."],
      trendDirection,
      missingDataFlags: [],
    };
  return {
    guidance: score < 45 ? "REJECT" : "WATCH",
    guidanceReasons: [score < 45 ? "Current weighted evidence is below the testing threshold." : "Evidence is complete but the weighted opportunity is not yet strong enough to test."],
    trendDirection,
    missingDataFlags: [],
  };
}