import { expect, it } from "vitest";
import { Repository } from "../../server/database";
import { Service } from "../../server/service";
import { ShopifyProvider, YouTubeProvider } from "../../server/providers";
import { runDiscovery, type DiscoveryProvider } from "../../server/discovery-engine";
import type { SourceObservation } from "../../shared/domain";

const base = (id: string): SourceObservation => ({ id, workspaceId: "default", mode: "LIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sourceId: "test-source", externalId: id, productName: "Portable blender", category: "Kitchen", observedAt: "2026-01-01T00:00:00.000Z", reference: "https://example.test/product", sourceUrl: "https://example.test/product", payload: { raw: true }, confidence: 1 });
it("discovery rejects duplicate provider evidence and preserves no partial data on failure", async () => {
 const repo=new Repository(":memory:","LIVE"); const service=new Service(repo,new ShopifyProvider({}),new YouTubeProvider()); const job=service.base("job") as never;
 const provider: DiscoveryProvider = { id:"test-source", evidenceKind:"ATTENTION", validate:v=>v as Record<string,unknown>, fetch:async()=>[base("a"),base("a")], extractSignals:()=>[] };
 await expect(runDiscovery(service, job, provider)).rejects.toThrow("duplicate"); expect(repo.list("observations")).toHaveLength(0); repo.close();
});