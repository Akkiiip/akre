import { createHash } from "node:crypto";
import { z } from "zod";
import type { SourceObservation, TrendSignal } from "../shared/domain";
import { normalize } from "../shared/discovery";
import type { DiscoveryProvider } from "./discovery-engine";

export const GOOGLE_TRENDS_VERSION = "google-trends-search-demand/1.0.0";
export const GOOGLE_TRENDS_SOURCE = "google-trends";
const FEED_URL = "https://trends.google.com/trending/rss";

export const googleTrendsInput = z
  .object({
    geo: z.string().regex(/^[A-Z]{2}$/).default("IN"),
    category: z.string().trim().min(1).max(100).default("Unclassified"),
    maxResults: z.number().int().min(1).max(50).default(25),
  })
  .strict();
export type GoogleTrendsInput = z.infer<typeof googleTrendsInput>;

const decodeXml = (value: string) =>
  value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

function tag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

export function parseApproxTraffic(value: string) {
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([KMB])?\+?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier =
    match[2]?.toUpperCase() === "M"
      ? 1_000_000
      : match[2]?.toUpperCase() === "B"
        ? 1_000_000_000
        : match[2]?.toUpperCase() === "K"
          ? 1_000
          : 1;
  return Math.round(base * multiplier);
}

export function parseTrendingRss(
  body: string,
  input: GoogleTrendsInput,
  fetchedAt = new Date().toISOString(),
): SourceObservation[] {
  if (!body.includes("<rss") || !body.includes("<item>"))
    throw new Error("Google Trends returned an invalid RSS feed");
  const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const rows: SourceObservation[] = [];
  for (const [index, item] of items.slice(0, input.maxResults).entries()) {
    const query = tag(item, "title");
    const trafficText = tag(item, "ht:approx_traffic");
    const approxTraffic = parseApproxTraffic(trafficText);
    const link = tag(item, "link") || `https://trends.google.com/trending?geo=${input.geo}`;
    const pubDateText = tag(item, "pubDate");
    const observedAt = pubDateText
      ? new Date(pubDateText).toISOString()
      : fetchedAt;
    if (!query || approxTraffic === null) continue;
    const externalId = `${input.geo}:${query.toLocaleLowerCase("en-IN")}:${observedAt}`;
    rows.push({
      id: createHash("sha256").update(`${GOOGLE_TRENDS_SOURCE}:${externalId}`).digest("hex"),
      workspaceId: "default",
      createdAt: fetchedAt,
      updatedAt: fetchedAt,
      mode: "LIVE",
      sourceId: GOOGLE_TRENDS_SOURCE,
      externalId,
      productName: query,
      category: input.category,
      observedAt,
      reference: link,
      sourceUrl: "https://trends.google.com/trending",
      region: input.geo,
      signalType: "GOOGLE_SEARCH_APPROX_TRAFFIC",
      signalValue: approxTraffic,
      confidence: 0.9,
      fetchedAt,
      providerVersion: GOOGLE_TRENDS_VERSION,
      payload: {
        query,
        approxTraffic,
        approxTrafficText: trafficText,
        geo: input.geo,
        trendStatus: "TRENDING_NOW",
        source: "Google Trends Trending Now RSS",
        sourceIndex: index,
        notice:
          "Search-interest evidence only. It does not prove product demand, purchases, profitability, or supplier viability.",
      },
    });
  }
  return rows;
}

export class GoogleTrendsProvider
  implements DiscoveryProvider<GoogleTrendsInput>
{
  id = GOOGLE_TRENDS_SOURCE;
  evidenceKinds = ["DEMAND"] as const;

  validate(input: unknown) {
    return googleTrendsInput.parse(input);
  }

  async fetch(input: GoogleTrendsInput) {
    const checked = this.validate(input);
    const url = new URL(FEED_URL);
    url.searchParams.set("geo", checked.geo);
    const response = await fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9",
        "User-Agent": "AKRE/1.0 (commerce-intelligence; Google Trends public feed)",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        `Google Trends HTTP ${response.status}${response.status === 429 ? " (rate limited; retry later)" : ""}`,
      );
    return parseTrendingRss(await response.text(), checked);
  }

  extractSignals(observations: SourceObservation[], productId: string): TrendSignal[] {
    return observations
      .filter((o) => o.sourceId === GOOGLE_TRENDS_SOURCE && o.signalValue != null)
      .map((o) => {
        const traffic = o.signalValue!;
        return {
          id: createHash("sha256")
            .update(`${productId}:${o.id}:${GOOGLE_TRENDS_VERSION}:demandStrength`)
            .digest("hex"),
          workspaceId: "default",
          createdAt: o.fetchedAt ?? o.updatedAt,
          updatedAt: o.fetchedAt ?? o.updatedAt,
          mode: "LIVE",
          productId,
          sourceId: GOOGLE_TRENDS_SOURCE,
          observationId: o.id,
          factor: "demandStrength" as const,
          rawValue: traffic,
          normalizedValue: normalize(Math.log10(Math.max(1, traffic)), 0, 7),
          unit: "Google Trends approximate searches (log-scaled)",
          observedAt: o.observedAt,
          normalizationVersion: GOOGLE_TRENDS_VERSION,
          validUntil: new Date(Date.parse(o.observedAt) + 24 * 60 * 60 * 1000).toISOString(),
          evidence: {
            region: o.region,
            source: "Google Trends Trending Now",
            approxTraffic: traffic,
            interpretation:
              "Search-interest evidence. Not purchase proof and not a sales estimate.",
            trendDirection: "UP_BY_TRENDING_STATUS",
          },
        };
      });
  }
}
