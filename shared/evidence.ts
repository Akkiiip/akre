import type { Dataset, Product } from "./domain";
export function evidenceState(
  product: Product,
  d: Dataset,
  now = Date.now(),
): "DEMO" | "LIVE" | "STALE" | "ERROR" | "NOT CONFIGURED" | "MANUAL" {
  if (product.mode === "DEMO") return "DEMO";
  const o = d.opportunities.find((o) => o.productId === product.id),
    sourceIds = o?.sourceIds ?? [];
  const observations = d.observations.filter(
    (row) =>
      sourceIds.includes(row.sourceId) &&
      ((product.sourceReferences ?? []).includes(row.reference ?? "") ||
        row.productName === product.name),
  );
  const external = observations.filter(
    (row) => !row.sourceId.startsWith("manual-"),
  );
  if (!external.length)
    return observations.length ? "MANUAL" : "NOT CONFIGURED";
  const failed = d.jobs
    .filter((j) => sourceIds.includes(j.source))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (failed?.status === "ERROR") return "ERROR";
  const latest = Math.max(...external.map((row) => Date.parse(row.observedAt)));
  return now - latest > 7 * 86400000 ? "STALE" : "LIVE";
}
