import type {
  SourceObservation,
  ScoringInputs,
  TrendSignal,
  Product,
} from "./domain";
import { scoreOpportunity } from "./scoring";
export const NORMALIZATION_VERSION = "akre-normalization/1.0.0";
export function normalize(value: number, min: number, max: number) {
  if (![value, min, max].every(Number.isFinite) || max <= min)
    throw new Error("Invalid normalization bounds");
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
export function identityKey(name: string) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function deduplicate(observations: SourceObservation[]) {
  return [
    ...new Map(
      observations.map((o) => [`${o.sourceId}:${o.externalId}`, o]),
    ).values(),
  ];
}
export function aggregateSignals(signals: TrendSignal[]): ScoringInputs {
  // Latest observation per source/factor; repeated polls do not overweight a source.
  const latest = new Map<string, TrendSignal>();
  for (const s of signals) {
    const key = `${s.sourceId}:${s.factor}`;
    if (!latest.has(key) || latest.get(key)!.observedAt < s.observedAt)
      latest.set(key, s);
  }
  const inputs: ScoringInputs = {};
  for (const s of latest.values()) {
    const peers = [...latest.values()].filter((p) => p.factor === s.factor);
    inputs[s.factor] =
      peers.reduce((sum, p) => sum + p.normalizedValue, 0) / peers.length;
  }
  return inputs;
}
export function discover(products: Product[], signals: TrendSignal[]) {
  return products.map((product) => {
    const evidence = signals.filter((s) => s.productId === product.id);
    const inputs = aggregateSignals(evidence);
    return {
      productId: product.id,
      signalIds: evidence.map((s) => s.id),
      sourceIds: [...new Set(evidence.map((s) => s.sourceId))],
      inputs,
      scoring: scoreOpportunity(inputs),
    };
  });
}
