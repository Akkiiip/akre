import type { Service } from "./service";
import type { Product, SourceObservation, SyncJob } from "../shared/domain";
import { identityKey, aggregateSignals } from "../shared/discovery";
import { runDiscovery } from "./discovery-engine";
import { scoreOpportunity, SCORING_VERSION } from "../shared/scoring";
import { commerceIntelligence, dataFreshness, evidenceQuality, guidance } from "../shared/intelligence";
import {
  WikimediaProvider,
  ingestionInput,
  attentionSignals,
  WIKIMEDIA_SOURCE,
} from "./wikimedia";
export function matchProduct(
  products: Product[],
  name: string,
  category: string,
  reference: string | null,
): Product | undefined {
  const key = identityKey(name),
    matches = products.filter(
      (p) =>
        (p.identityKey === key ||
          (p.aliases ?? []).some((a) => identityKey(a) === key) ||
          (reference && (p.sourceReferences ?? []).includes(reference))) &&
        (p.category === category ||
          p.category === "Unclassified" ||
          category === "Unclassified"),
    );
  if (matches.length > 1)
    throw new Error(
      "Ambiguous product identity; review aliases before ingestion",
    );
  return matches[0];
}
export function upsertIdentity(s: Service, o: SourceObservation) {
  const prior = matchProduct(
    s.repo.list("products"),
    o.productName,
    o.category,
    o.reference,
  );
  const p: Product = {
    ...(prior ?? {
      ...s.base(),
      name: o.productName,
      canonicalName: o.productName,
      category: o.category,
      identityKey: identityKey(o.productName),
      lifecycle: "DISCOVERED",
      supplierIds: [],
      source: o.sourceId,
      sourceUrl: o.sourceUrl ?? o.reference,
      mediaUrl: typeof o.payload.mediaUrl === "string" ? o.payload.mediaUrl : null,
      discoveredAt: o.observedAt,
    }),
    aliases: [...new Set([...(prior?.aliases ?? []), o.productName])],
    sourceReferences: [
      ...new Set([
        ...(prior?.sourceReferences ?? []),
        ...(o.reference ? [o.reference] : []),
      ]),
    ],
    firstSeen:
      prior?.firstSeen && prior.firstSeen < o.observedAt
        ? prior.firstSeen
        : o.observedAt,
    lastSeen:
      prior?.lastSeen && prior.lastSeen > o.observedAt
        ? prior.lastSeen
        : o.observedAt,
    updatedAt: new Date().toISOString(),
  };
  s.repo.put("products", p);
  return p;
}
export function recompute(
  s: Service,
  productId: string,
  reason: string,
  explicitCurrent = false,
) {
  const p = s.repo.get("products", productId),
    old = s.repo.list("opportunities").find((o) => o.productId === productId);
  const all = s.repo
    .list("signals")
    .filter((sig) => sig.productId === productId);
  const signals = all.filter(
    (sig) => !sig.validUntil || sig.validUntil > new Date().toISOString(),
  );
  const inputs = aggregateSignals(signals),
    version = explicitCurrent
      ? SCORING_VERSION
      : (old?.scoring.version ?? SCORING_VERSION);
  const scoring = scoreOpportunity(inputs, version);
  const observations = s.repo
    .list("observations")
    .filter(
      (o) =>
        (p.sourceReferences ?? []).includes(o.reference ?? "") ||
        identityKey(o.productName) === p.identityKey,
    );
  const cost = s.repo.list("costs").find((item) => item.productId === productId);
  const supplierOffer = cost?.supplierOfferId
    ? s.repo.list("offers").find((offer) => offer.id === cost.supplierOfferId)
    : undefined;
  const freshness = dataFreshness(all);
  const commerce = commerceIntelligence(inputs, cost?.assumptions, supplierOffer);
  const recommendation = guidance(scoring.score, scoring.confidence, inputs, freshness.state, commerce);
  const intelligence = {
    ...recommendation,
    dataFreshness: freshness.state,
    latestEvidenceAt: freshness.latestEvidenceAt,
    evidenceQuality: evidenceQuality(observations),
    commerce,
  };
  const opportunity = {
    ...(old ?? { ...s.base(), productId, sellingPrice: null, costId: null }),
    sourceIds: [
      ...new Set([
        ...observations.map((o) => o.sourceId),
        ...signals.map((sig) => sig.sourceId),
      ]),
    ],
    signalIds: signals.map((sig) => sig.id),
    inputs,
    scoring,
    intelligence,
    scoreVersion: scoring.version,
    scoredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  s.repo.put("opportunities", opportunity);
  s.repo.put("scoreHistory", {
    ...s.base(),
    productId,
    opportunityId: opportunity.id,
    reason,
    scoreVersion: scoring.version,
    inputs,
    scoring,
    signalIds: signals.map((sig) => sig.id),
    evidence: {
      signals,
      observations,
      intelligence,
      excludedExpiredSignalIds: all
        .filter((sig) => !signals.includes(sig))
        .map((sig) => sig.id),
    },
  });
  s.audit("OPPORTUNITY_SCORED", productId, {
    reason,
    version,
    score: scoring.score,
    signalIds: opportunity.signalIds,
    previousVersion: old?.scoring.version ?? null,
  });
  return opportunity;
}
export async function ingestWikimedia(
  s: Service,
  job: SyncJob,
  provider = new WikimediaProvider(),
) {
  const result = await runDiscovery(s, job, {
    id: WIKIMEDIA_SOURCE,
    evidenceKind: "ATTENTION",
    validate: (payload) => ingestionInput.parse(payload),
    fetch: (input) => provider.fetch(input),
    extractSignals: attentionSignals,
  });
  s.repo.transaction(() => s.audit("WIKIMEDIA_INGESTED", job.id, { input: ingestionInput.parse(job.payload), meaning: "Human topic pageviews; no purchase-demand inference" }));
  return result;
}
