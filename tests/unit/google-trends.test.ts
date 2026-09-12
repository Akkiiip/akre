import { expect, it, vi } from "vitest";
import { googleTrendsInput, GoogleTrendsProvider, parseApproxTraffic, parseTrendingRss } from "../../server/google-trends";

const rss = `<?xml version="1.0"?><rss><channel>
<item>
<title>portable blender</title>
<link>https://trends.google.com/trending?geo=IN</link>
<pubDate>Sat, 12 Sep 2026 02:00:00 GMT</pubDate>
<ht:approx_traffic>50K+</ht:approx_traffic>
</item>
<item>
<title><![CDATA[air fryer]]></title>
<link>https://trends.google.com/trending?geo=IN</link>
<pubDate>Sat, 12 Sep 2026 01:00:00 GMT</pubDate>
<ht:approx_traffic>1M+</ht:approx_traffic>
</item>
</channel></rss>`;

it("parses Google Trends approximate search traffic conservatively", () => {
  expect(parseApproxTraffic("500+ ")).toBe(500);
  expect(parseApproxTraffic("50K+")).toBe(50_000);
  expect(parseApproxTraffic("1.5M+")).toBe(1_500_000);
  expect(parseApproxTraffic("unknown")).toBeNull();
});

it("normalizes public India search-trend observations as DEMAND evidence", () => {
  const rows = parseTrendingRss(rss, googleTrendsInput.parse({ geo: "IN" }));
  expect(rows).toHaveLength(2);
  expect(rows[0].region).toBe("IN");
  expect(rows[0].signalType).toBe("GOOGLE_SEARCH_APPROX_TRAFFIC");
  expect(rows[0].payload.notice).toContain("does not prove product demand");
});

it("provider has explicit DEMAND capability and preserves duplicate search observations", async () => {
  const provider = new GoogleTrendsProvider();
  expect(provider.evidenceKinds).toEqual(["DEMAND"]);
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } }),
    );
  const observations = await provider.fetch({ geo: "IN", category: "Kitchen", maxResults: 25 });
  const signals = provider.extractSignals(observations, "product-1");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(signals[0].factor).toBe("demandStrength");
  expect(signals[0].evidence?.interpretation).toContain("Not purchase proof");
  fetcher.mockRestore();
});

it("provider surfaces upstream failure instead of inventing demand", async () => {
  const provider = new GoogleTrendsProvider();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
  await expect(
    provider.fetch({ geo: "IN", category: "Kitchen", maxResults: 25 }),
  ).rejects.toThrow("Google Trends HTTP 503");
  vi.restoreAllMocks();
});
