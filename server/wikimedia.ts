import { z } from "zod";
import { createHash } from "node:crypto";
import type { SourceObservation, TrendSignal } from "../shared/domain";
import { normalize } from "../shared/discovery";
export const WIKIMEDIA_VERSION = "wikimedia-attention/1.0.0";
export const WIKIMEDIA_SOURCE = "wikimedia";
export const observationId = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const ingestionInput = z
  .object({
    article: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100).default("Unclassified"),
    project: z
      .enum(["en.wikipedia.org", "hi.wikipedia.org"])
      .default("en.wikipedia.org"),
    start: z.iso.date(),
    end: z.iso.date(),
  })
  .strict()
  .refine((v) => v.start <= v.end, "Start must not follow end")
  .refine(
    (v) => (Date.parse(v.end) - Date.parse(v.start)) / 86400000 <= 90,
    "At most 91 days per ingestion",
  )
  .refine(
    (v) => v.end < new Date().toISOString().slice(0, 10),
    "Only completed UTC days can be ingested",
  );
export type IngestionInput = z.infer<typeof ingestionInput>;
const itemSchema = z.object({
  project: z.string(),
  article: z.string().min(1),
  granularity: z.literal("daily"),
  timestamp: z.string().regex(/^\d{8}00$/),
  access: z.literal("all-access"),
  agent: z.literal("user"),
  views: z.number().int().nonnegative().safe(),
});
export interface AttentionProvider {
  id: string;
  fetch(input: IngestionInput): Promise<SourceObservation[]>;
}
export function parsePageviews(
  body: unknown,
  input: IngestionInput,
  fetchedAt = new Date().toISOString(),
): SourceObservation[] {
  const { items } = z
    .object({ items: z.array(itemSchema).min(1).max(91) })
    .parse(body);
  const rows = new Map<string, SourceObservation>();
  for (const raw of items) {
    const day = `${raw.timestamp.slice(0, 4)}-${raw.timestamp.slice(4, 6)}-${raw.timestamp.slice(6, 8)}`;
    z.iso.date().parse(day);
    if (
      day < input.start ||
      day > input.end ||
      raw.project !== input.project.replace(/\.org$/, "") ||
      raw.article.replaceAll("_", " ") !== input.article.replaceAll("_", " ")
    )
      throw new Error(
        "Wikimedia returned a mismatched article, project or date",
      );
    const externalId = `${input.project}:${raw.article}:${day}:user:all-access`;
    if (rows.has(externalId)) {
      if (rows.get(externalId)!.signalValue !== raw.views)
        throw new Error("Conflicting duplicate Wikimedia observation");
      continue;
    }
    const reference = `https://${input.project}/wiki/${encodeURIComponent(raw.article.replaceAll(" ", "_"))}`;
    rows.set(externalId, {
      id: observationId(externalId),
      workspaceId: "default",
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
      mode: "LIVE",
      sourceId: WIKIMEDIA_SOURCE,
      externalId,
      productName: raw.article.replaceAll("_", " "),
      category: input.category,
      observedAt: `${day}T00:00:00.000Z`,
      reference,
      payload: raw,
      region: "GLOBAL",
      signalType: "HUMAN_PAGEVIEWS",
      signalValue: raw.views,
      confidence: 1,
      fetchedAt,
      providerVersion: WIKIMEDIA_VERSION,
      sourceUrl: reference,
    });
  }
  return [...rows.values()].sort((a, b) =>
    a.observedAt.localeCompare(b.observedAt),
  );
}
export class WikimediaProvider implements AttentionProvider {
  id = WIKIMEDIA_SOURCE;
  async fetch(input: IngestionInput) {
    const checked = ingestionInput.parse(input),
      stamp = (v: string) => v.replaceAll("-", "") + "00";
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${checked.project}/all-access/user/${encodeURIComponent(checked.article.replaceAll(" ", "_"))}/daily/${stamp(checked.start)}/${stamp(checked.end)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "AKRE/0.4 (https://github.com/Akkiiip/akre; topic-interest research)",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `Wikimedia HTTP ${response.status}${response.status === 429 ? " (rate limited; retry later)" : ""}`,
      );
    return parsePageviews(await response.json(), checked);
  }
}
// Three full weeks, no gap filling. Topic attention is not purchase demand.
export function attentionSignals(
  observations: SourceObservation[],
  productId: string,
): TrendSignal[] {
  const rows = [
    ...new Map(
      observations
        .filter((o) => o.sourceId === WIKIMEDIA_SOURCE)
        .map((o) => [o.externalId, o]),
    ).values(),
  ].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const result: TrendSignal[] = [];
  for (let end = 20; end < rows.length; end++) {
    const window = rows.slice(end - 20, end + 1);
    if (
      window.some(
        (o, i) =>
          i > 0 &&
          Date.parse(o.observedAt) - Date.parse(window[i - 1].observedAt) !==
            86400000,
      )
    )
      continue;
    const sums = [0, 0, 0];
    window.forEach((o, i) => {
      sums[Math.floor(i / 7)] += o.signalValue!;
    });
    if (sums[0] === 0 || sums[1] === 0) continue;
    const previousGrowth = (sums[1] / sums[0] - 1) * 100,
      currentGrowth = (sums[2] / sums[1] - 1) * 100;
    const rawValue = currentGrowth - previousGrowth,
      last = window[20];
    result.push({
      id: observationId(`${productId}:${last.externalId}:${WIKIMEDIA_VERSION}`),
      workspaceId: "default",
      mode: "LIVE",
      createdAt: last.fetchedAt!,
      updatedAt: last.fetchedAt!,
      productId,
      sourceId: WIKIMEDIA_SOURCE,
      observationId: last.id,
      factor: "trendAcceleration",
      rawValue,
      normalizedValue: normalize(rawValue, -100, 100),
      unit: "weekly attention growth change (percentage points)",
      observedAt: last.observedAt,
      normalizationVersion: WIKIMEDIA_VERSION,
      validUntil: new Date(
        Date.parse(last.observedAt) + 7 * 86400000,
      ).toISOString(),
      evidence: {
        observationIds: window.map((o) => o.id),
        weeklyViews: sums,
        previousGrowth,
        currentGrowth,
        bounds: [-100, 100],
        interpretation:
          "GLOBAL topic-attention acceleration. Not purchasing demand; demandStrength remains unavailable.",
      },
    });
  }
  return result;
}
