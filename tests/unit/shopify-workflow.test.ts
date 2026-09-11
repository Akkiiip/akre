import { it, expect, vi, afterEach } from "vitest";
import { Repository } from "../../server/database";
import { Service } from "../../server/service";
import { ShopifyProvider, YouTubeProvider } from "../../server/providers";
import { importProducts } from "../../server/shopify-api";
const gid = (type: string, n = 1) => `gid://shopify/${type}/${n}`;
const shop = {
  id: gid("Shop"),
  name: "Test store",
  myshopifyDomain: "test.myshopify.com",
  currencyCode: "INR" as const,
  plan: { partnerDevelopment: true as const },
};
const remote = (price = "100", quantity = 10) => ({
  id: gid("Product"),
  title: "Bottle",
  productType: "Kitchen",
  descriptionHtml: "Description",
  status: "DRAFT",
  variants: {
    nodes: [
      {
        id: gid("ProductVariant"),
        sku: "B-1",
        price,
        inventoryItem: {
          id: gid("InventoryItem"),
          inventoryLevels: {
            nodes: [
              {
                location: { id: gid("Location"), name: "Warehouse" },
                quantities: [{ name: "available", quantity }],
              },
            ],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    ],
    pageInfo: { hasNextPage: false },
  },
});
function setup() {
  const repo = new Repository(":memory:", "LIVE"),
    provider = new ShopifyProvider({
      shop: shop.myshopifyDomain,
      token: "test-only",
      version: "2026-07",
    }),
    service = new Service(repo, provider, new YouTubeProvider());
  return { repo, provider, service };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("never labels credentials as a verified connection until the API succeeds", async () => {
  const { repo, provider, service } = setup();
  try {
    expect(
      service.integrations().find((i) => i.provider === "Shopify")?.status,
    ).toBe("UNVERIFIED");
    vi.spyOn(provider, "testConnection")
      .mockRejectedValueOnce(new Error("Shopify HTTP 401"))
      .mockResolvedValueOnce(shop);
    const j = service.enqueue({
      type: "SHOPIFY_CONNECT",
      source: "shopify",
      payload: {},
    });
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("ERROR");
    expect(
      service.integrations().find((i) => i.provider === "Shopify")?.verifiedAt,
    ).toBeNull();
    service.retry(j.id);
    await service.runNext();
    expect(
      service.integrations().find((i) => i.provider === "Shopify")?.status,
    ).toBe("CONNECTED");
  } finally {
    repo.close();
  }
});
it("imports real response structures idempotently and records variants/inventory mappings", async () => {
  const { repo, provider, service } = setup();
  vi.spyOn(provider, "testConnection").mockResolvedValue(shop);
  vi.spyOn(provider, "graphql").mockResolvedValue({
    products: { nodes: [remote()], pageInfo: { hasNextPage: false } },
  });
  try {
    for (let i = 0; i < 2; i++) {
      service.enqueue({
        type: "SHOPIFY_PRODUCT_IMPORT",
        source: "shopify",
        payload: {},
      });
      await service.runNext();
    }
    expect(repo.list("products")).toHaveLength(1);
    expect(repo.list("listings")).toHaveLength(1);
    expect(repo.list("variants")).toHaveLength(1);
    expect(
      repo.list("listings")[0].remoteVariants?.[0].inventory[0].quantity,
    ).toBe(10);
    expect(
      service.integrations().find((i) => i.provider === "Shopify")?.status,
    ).toBe("SYNCED");
  } finally {
    repo.close();
  }
});
it("confirms price via readback and retains failure/retry state", async () => {
  const { repo, provider, service } = setup();
  vi.spyOn(provider, "testConnection").mockResolvedValue(shop);
  const graph = vi.spyOn(provider, "graphql").mockResolvedValueOnce({
    products: { nodes: [remote()], pageInfo: { hasNextPage: false } },
  });
  try {
    service.enqueue({
      type: "SHOPIFY_PRODUCT_IMPORT",
      source: "shopify",
      payload: {},
    });
    await service.runNext();
    const listing = repo.list("listings")[0];
    vi.spyOn(provider, "syncPrice").mockResolvedValue();
    graph
      .mockResolvedValueOnce({ product: remote() })
      .mockResolvedValueOnce({ product: remote() });
    const j = service.enqueue({
      type: "SHOPIFY_PRICE_SYNC",
      source: "shopify",
      payload: {
        listingId: listing.id,
        variantId: gid("ProductVariant"),
        price: 125,
      },
    });
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("ERROR");
    expect(repo.get("listings", listing.id).priceSyncedAt).toBeUndefined();
    graph
      .mockResolvedValueOnce({ product: remote() })
      .mockResolvedValueOnce({ product: remote("125") });
    service.retry(j.id);
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("COMPLETED");
    expect(repo.get("listings", listing.id).priceSyncedAt).toBeTruthy();
  } finally {
    repo.close();
  }
});
it("uses compare-and-set inventory and a stable job idempotency key", async () => {
  const { repo, provider, service } = setup();
  vi.spyOn(provider, "testConnection").mockResolvedValue(shop);
  const graph = vi.spyOn(provider, "graphql").mockResolvedValueOnce({
    products: { nodes: [remote()], pageInfo: { hasNextPage: false } },
  });
  try {
    service.enqueue({
      type: "SHOPIFY_PRODUCT_IMPORT",
      source: "shopify",
      payload: {},
    });
    await service.runNext();
    const listing = repo.list("listings")[0];
    graph
      .mockResolvedValueOnce({ product: remote() })
      .mockResolvedValueOnce({
        inventorySetQuantities: {
          inventoryAdjustmentGroup: {
            changes: [{ name: "available", quantityAfterChange: 15 }],
          },
        },
      })
      .mockResolvedValueOnce({ product: remote("100", 15) });
    const j = service.enqueue({
      type: "SHOPIFY_INVENTORY_SYNC",
      source: "shopify",
      payload: {
        listingId: listing.id,
        variantId: gid("ProductVariant"),
        locationId: gid("Location"),
        quantity: 15,
        changeFromQuantity: 10,
      },
    });
    await service.runNext();
    expect(repo.get("jobs", j.id).status).toBe("COMPLETED");
    const call = graph.mock.calls.find(([query]) =>
      query.includes("@idempotent"),
    );
    expect(call?.[1]).toMatchObject({
      key: j.id,
      input: { quantities: [{ changeFromQuantity: 10, quantity: 15 }] },
    });
  } finally {
    repo.close();
  }
});
it("rejects silent nested truncation and repeated pagination cursors", async () => {
  const { repo, provider } = setup();
  const r = remote();
  r.variants.pageInfo.hasNextPage = true;
  const mock = vi.spyOn(provider, "graphql").mockResolvedValue({
    products: { nodes: [r], pageInfo: { hasNextPage: false } },
  });
  try {
    await expect(importProducts(provider)).rejects.toThrow("capacity");
    mock.mockResolvedValue({
      products: {
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "repeated" },
      },
    });
    await expect(importProducts(provider)).rejects.toThrow("repeated");
  } finally {
    repo.close();
  }
});
it("blocks ambiguous create retries until a returned ID is reconciled", async () => {
  const { repo, service } = setup();
  try {
    const p = {
      ...service.base(),
      name: "Bottle",
      category: "Kitchen",
      identityKey: "bottle",
      lifecycle: "APPROVED" as const,
      supplierIds: [],
    };
    repo.put("products", p);
    const listing = service.createListing({
      productId: p.id,
      title: "Bottle",
      description: "Description",
      price: 100,
    });
    const j = service.enqueue({
      type: "STORE_SYNC",
      source: "shopify",
      payload: { listingId: listing.id },
    });
    repo.put("jobs", { ...j, status: "ERROR", error: "Timeout" });
    expect(() => service.retry(j.id)).toThrow("Reconcile");
    repo.put("listings", { ...listing, externalId: gid("Product") });
    expect(service.retry(j.id).status).toBe("QUEUED");
  } finally {
    repo.close();
  }
});

it("rejects production stores and malformed development-store verification", async () => {
  const { repo, provider } = setup();
  try {
    const api = vi.spyOn(provider, "graphql");
    api.mockResolvedValue({
      shop: { ...shop, plan: { partnerDevelopment: false } },
    });
    await expect(provider.testConnection()).rejects.toThrow();
    api.mockResolvedValue({ shop });
    await expect(provider.testConnection()).resolves.toEqual(shop);
  } finally {
    repo.close();
  }
});
it("rejects repeated or missing order pagination cursors", async () => {
  const { repo, provider } = setup();
  try {
    const api = vi.spyOn(provider, "graphql");
    api.mockResolvedValue({
      orders: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } },
    });
    await expect(provider.syncOrders("2026-01-01")).rejects.toThrow(
      "pagination",
    );
    api.mockResolvedValue({
      orders: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } },
    });
    await expect(provider.syncOrders("2026-01-01")).rejects.toThrow(
      "pagination",
    );
  } finally {
    repo.close();
  }
});
it("refuses queued operations when Shopify configuration changes", async () => {
  const { repo, provider, service } = setup();
  try {
    const job = service.enqueue({
      type: "SHOPIFY_CONNECT",
      source: "shopify",
      payload: {},
    });
    const api = vi.spyOn(provider, "testConnection").mockResolvedValue(shop);
    vi.spyOn(provider, "fingerprint").mockReturnValue(
      "changed-store-configuration",
    );
    await service.runNext();
    expect(repo.get("jobs", job.id).status).toBe("ERROR");
    expect(repo.get("jobs", job.id).error).toContain("configuration changed");
    expect(api).not.toHaveBeenCalled();
  } finally {
    repo.close();
  }
});
