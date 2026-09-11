import { it, expect, vi } from "vitest";
import { Repository } from "../../server/database";
import { Service } from "../../server/service";
import { ShopifyProvider, YouTubeProvider } from "../../server/providers";
it("imports actual net tax-exclusive order amounts idempotently without inventing profit", async () => {
  const repo = new Repository(":memory:", "LIVE");
  const shopify = new ShopifyProvider({
    shop: "test.myshopify.com",
    token: "test-only",
    version: "2026-07",
  });
  const service = new Service(repo, shopify, new YouTubeProvider());
  vi.spyOn(shopify, "testConnection").mockResolvedValue({
    id: "gid://shopify/Shop/1",
    name: "Test shop",
    myshopifyDomain: "test.myshopify.com",
    plan: { partnerDevelopment: true as const },
    currencyCode: "INR",
  });
  vi.spyOn(shopify, "syncOrders").mockResolvedValue([
    {
      id: "gid://shopify/Order/1",
      createdAt: "2026-09-01T00:00:00.000Z",
      currencyCode: "INR",
      currentTotalPriceSet: { shopMoney: { amount: "118" } },
      currentTotalTaxSet: { shopMoney: { amount: "18" } },
      totalRefundedSet: { shopMoney: { amount: "50" } },
    },
  ]);
  try {
    for (let i = 0; i < 2; i++) {
      service.enqueue({
        type: "ORDER_SYNC",
        source: "shopify",
        payload: { since: "2026-09-01" },
      });
      await service.runNext();
    }
    expect(repo.list("orders")).toHaveLength(1);
    expect(repo.list("orders")[0].revenue).toBe(100);
    expect(repo.list("orders")[0].refunds).toBe(0);
    expect(repo.list("orders")[0].variableCosts).toBeNull();
    expect(repo.list("stores")).toHaveLength(1);
    expect(repo.list("jobs").every((j) => j.status === "COMPLETED")).toBe(true);
  } finally {
    repo.close();
  }
});
