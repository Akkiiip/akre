import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Repository } from "../../server/database";
import { Service } from "../../server/service";
import { ShopifyProvider, YouTubeProvider } from "../../server/providers";
import { createApp } from "../../server/app";
let repo: Repository, service: Service;
beforeEach(() => {
  repo = new Repository(":memory:", "DEMO");
  service = new Service(repo, new ShopifyProvider({}), new YouTubeProvider());
});
afterEach(() => {
  repo.close();
  vi.unstubAllGlobals();
});
describe("persisted workflows", () => {
  it("seeds only demo and rolls back failed transactions", () => {
    expect(repo.list("products")).toHaveLength(6);
    expect(() =>
      repo.transaction(() => {
        repo.put("products", {
          ...repo.get("products", "product-1"),
          name: "changed",
        });
        throw new Error("rollback");
      }),
    ).toThrow();
    expect(repo.get("products", "product-1").name).toBe(
      "Portable Pet Water Bottle",
    );
  });
  it("LIVE database starts empty", () => {
    const live = new Repository(":memory:", "LIVE");
    expect(live.list("products")).toHaveLength(0);
    live.close();
  });
  it("persists approval and a traceable experiment decision with daily upserts", () => {
    service.transition("product-1", { lifecycle: "SHORTLISTED" });
    service.transition("product-1", { lifecycle: "APPROVED" });
    const a = service.createAsset({
      productId: "product-1",
      type: "HOOK",
      title: "Test hook",
      body: "Test concept",
    });
    const e = service.createExperiment({
      productId: "product-1",
      channel: "Meta",
      sellingPrice: 699,
      creativeId: a.id,
      budget: 2000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      successCriteria: {
        minImpressions: 1000,
        minClicks: 100,
        minPurchases: 10,
        maxSpend: 2000,
        targetRoas: 2,
        minContributionProfit: 100,
      },
      killCriteria: { maxLoss: 1000 },
    });
    service.transition("product-1", { lifecycle: "TESTING" });
    const m = {
      date: "2026-09-01",
      spend: 500,
      impressions: 2000,
      clicks: 200,
      addToCart: 40,
      checkout: 25,
      purchases: 20,
      revenue: 13980,
      reference: "manual export",
    };
    service.saveMetrics(e.id, m);
    service.saveMetrics(e.id, { ...m, spend: 600 });
    expect(repo.list("metrics")).toHaveLength(1);
    expect(repo.list("decisions")).toHaveLength(2);
    expect(repo.list("decisions")[1].evidence).toHaveProperty("experiment");
    service.transition("product-1", { lifecycle: "WINNER" });
    expect(
      repo.list("audit").some((a) => a.action === "EXPERIMENT_METRICS_SAVED"),
    ).toBe(true);
  });
  it("rejects a creative from another product and unapproved experiments", () => {
    const a = service.createAsset({
      productId: "product-2",
      type: "HOOK",
      title: "Hook",
      body: "Demo",
    });
    expect(() =>
      service.createExperiment({
        productId: "product-1",
        channel: "Meta",
        sellingPrice: 699,
        creativeId: a.id,
        budget: 100,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        successCriteria: {
          minImpressions: 100,
          minClicks: 10,
          minPurchases: 1,
          maxSpend: 100,
          targetRoas: 2,
          minContributionProfit: 10,
        },
        killCriteria: { maxLoss: 100 },
      }),
    ).toThrow();
  });
  it("executes a real queued scoring job and records completion audit", async () => {
    const j = service.enqueue({
      type: "PRODUCT_DISCOVERY",
      source: "internal",
      payload: {},
    });
    expect(j.status).toBe("QUEUED");
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("COMPLETED");
    expect(repo.list("opportunities")).toHaveLength(6);
    expect(
      repo.list("audit").some((a) => a.action === "OPPORTUNITY_SCORED"),
    ).toBe(true);
  });
  it("retains job errors and bounded retry state", async () => {
    const j = service.enqueue({
      type: "ECONOMICS_RECALCULATION",
      source: "internal",
      payload: {},
    });
    vi.spyOn(service, "execute").mockRejectedValueOnce(
      new Error("Controlled failure"),
    );
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("ERROR");
    expect(service.retry(j.id).retryCount).toBe(1);
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("COMPLETED");
  });
  it("never queues a fake external operation", () => {
    expect(() =>
      service.enqueue({
        type: "STORE_SYNC",
        source: "shopify",
        payload: { listingId: "x" },
      }),
    ).toThrow("DEMO");
    expect(
      service.integrations().every((i) => i.status === "NOT CONFIGURED"),
    ).toBe(true);
  });
});
describe("API security and validation", () => {
  it("enforces authentication, JSON validation, and origin checks", async () => {
    const app = createApp(service, {
      password: "test-only-password",
      sessionSecret: "test-only-secret",
      origin: "http://localhost",
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const addr = server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      expect((await fetch(url + "/api/state")).status).toBe(401);
      const login = await fetch(url + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-only-password" }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const state = await fetch(url + "/api/state", { headers: { cookie } });
      expect(state.status).toBe(200);
      expect(JSON.stringify(await state.json())).not.toContain(
        "test-only-password",
      );
      const invalid = await fetch(url + "/api/products/product-1/economics", {
        method: "PUT",
        headers: { cookie, "Content-Type": "application/json" },
        body: '{"sellingPrice":-1}',
      });
      expect(invalid.status).toBe(400);
      const cross = await fetch(url + "/api/jobs", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json",
          Origin: "https://untrusted.example",
        },
        body: "{}",
      });
      expect(cross.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
describe("external provider result handling", () => {
  it("fails closed without credentials", async () => {
    await expect(
      new ShopifyProvider({}).syncOrders("2026-09-01"),
    ).rejects.toThrow("NOT CONFIGURED");
    await expect(new YouTubeProvider().observe("bottle")).rejects.toThrow(
      "NOT CONFIGURED",
    );
  });
  it("rejects Shopify HTTP, GraphQL and user errors", async () => {
    const p = new ShopifyProvider({
      shop: "test.myshopify.com",
      token: "test-only",
      version: "2026-07",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    await expect(p.syncOrders("2026-09-01")).rejects.toThrow("HTTP 401");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ errors: [{ message: "bad" }] })),
        ),
    );
    await expect(p.updateProduct("id", "title", "desc")).rejects.toThrow(
      "rejected",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { productUpdate: { userErrors: [{ message: "bad" }] } },
          }),
        ),
      ),
    );
    await expect(p.updateProduct("id", "title", "desc")).rejects.toThrow(
      "rejected",
    );
  });
  it("requires an actual external product ID before create success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { productCreate: { product: null, userErrors: [] } },
          }),
        ),
      ),
    );
    const p = new ShopifyProvider({
      shop: "test.myshopify.com",
      token: "test-only",
      version: "2026-07",
    });
    const listing = service.createListing({
      productId: "product-1",
      title: "Bottle",
      description: "Description",
      price: 699,
    });
    await expect(p.createProduct(listing)).rejects.toThrow("no product ID");
  });
  it("retains YouTube provenance without inventing demand scores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: { videoId: "video1" },
                snippet: { title: "Bottle demo", publishedAt: "2026-09-01" },
              },
            ],
          }),
        ),
      ),
    );
    const [o] = await new YouTubeProvider("test-only").observe("bottle");
    expect(o.reference).toBe("https://www.youtube.com/watch?v=video1");
    expect(o.payload).not.toHaveProperty("demandStrength");
  });
});
