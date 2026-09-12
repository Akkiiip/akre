import type { SourceObservation, SyncJob, TrendSignal } from "../shared/domain";
import { deduplicate } from "../shared/discovery";
import type { Service } from "./service";
import { recompute, upsertIdentity } from "./intelligence";

export type DiscoveryEvidenceKind =
  | "ATTENTION"
  | "DEMAND"
  | "PURCHASE"
  | "PRICE"
  | "COMPETITION"
  | "SUPPLIER"
  | "SHIPPING"
  | "OTHER";

export interface DiscoveryProvider<TInput = Record<string, unknown>> {
  id: string;
  evidenceKinds: readonly DiscoveryEvidenceKind[];
  validate(input: unknown): TInput;
  fetch(input: TInput): Promise<SourceObservation[]>;
  extractSignals(observations: SourceObservation[], productId: string): TrendSignal[];
}

/** Request-bounded orchestration; raw observations remain source provenance. */
export async function runDiscovery<TInput>(
  service: Service,
  job: SyncJob,
  provider: DiscoveryProvider<TInput>,
) {
  if (service.repo.mode !== "LIVE")
    throw new Error("External discovery requires the LIVE workspace");
  const input = provider.validate(job.payload);
  const fetched = await provider.fetch(input);
  const rows = deduplicate(fetched);
  if (rows.length !== fetched.length)
    throw new Error("Provider returned duplicate source observations");
  service.repo.transaction(() => {
    let inserted = 0;
    const productIds = new Set<string>();
    for (const row of rows) {
      if (row.sourceId !== provider.id)
        throw new Error("Discovery provider returned an observation for another source");
      const prior = service.repo
        .list("observations")
        .find(
          (item) =>
            item.sourceId === row.sourceId && item.externalId === row.externalId,
        );
      if (prior) {
        if (JSON.stringify(prior.payload) !== JSON.stringify(row.payload))
          throw new Error(
            "Provider revised stored evidence; explicit reconciliation is required",
          );
      } else {
        service.repo.put("observations", row);
        inserted += 1;
      }
      productIds.add(upsertIdentity(service, row).id);
    }
    for (const productId of productIds) {
      const product = service.repo.get("products", productId);
      const evidence = service.repo
        .list("observations")
        .filter(
          (item) =>
            item.sourceId === provider.id &&
            ((product.sourceReferences ?? []).includes(item.reference ?? "") ||
              item.productName === product.name),
        );
      for (const signal of provider.extractSignals(evidence, productId))
        if (!service.repo.list("signals").some((old) => old.id === signal.id))
          service.repo.put("signals", signal);
      recompute(service, productId, "DISCOVERY_RUN");
    }
    service.audit("DISCOVERY_RUN_COMPLETED", job.id, {
      provider: provider.id,
      evidenceKinds: [...provider.evidenceKinds],
      received: rows.length,
      inserted,
      productIds: [...productIds],
      meaning: provider.evidenceKinds.includes("ATTENTION")
        ? "Attention evidence only; not purchase demand or purchase proof."
        : provider.evidenceKinds.includes("DEMAND")
          ? "Search/demand evidence only; not purchase proof."
          : "Evidence retained according to the provider capability contract.",
    });
  });
}
