import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository } from "../../server/database";
import { Service } from "../../server/service";
import { ShopifyProvider, YouTubeProvider } from "../../server/providers";
import { createApp } from "../../server/app";
it("keeps saved changes across database reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "akre-persistence-"));
  const path = join(directory, "test.sqlite");
  try {
    const first = new Repository(path, "DEMO");
    first.put("products", {
      ...first.get("products", "product-1"),
      lifecycle: "SHORTLISTED",
    });
    first.close();
    const second = new Repository(path, "DEMO");
    expect(second.get("products", "product-1").lifecycle).toBe("SHORTLISTED");
    expect(second.list("products")).toHaveLength(6);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
it("records source evidence, normalizes, groups identity and validates offers and variants", async () => {
  const repo = new Repository(":memory:", "LIVE");
  const service = new Service(
    repo,
    new ShopifyProvider({}),
    new YouTubeProvider(),
  );
  const server = createApp(service).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = async (path: string, body: unknown) =>
    fetch(url + "/api" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const input = {
      productName: "Source Bottle",
      category: "Outdoor",
      sourceName: "Authorized supplier report",
      reference: "https://example.com/report",
      note: "Controlled API test fixture; not real market evidence",
      measurements: [
        {
          factor: "trendAcceleration",
          value: 150,
          min: 100,
          max: 200,
          unit: "index",
        },
        {
          factor: "demandStrength",
          value: 80,
          min: 0,
          max: 100,
          unit: "index",
        },
      ],
    };
    expect(
      (
        await post("/observations", {
          ...input,
          reference: "javascript:alert(1)",
        })
      ).status,
    ).toBe(400);
    expect((await post("/observations", input)).status).toBe(201);
    await service.runNext();
    expect(repo.list("products")).toHaveLength(1);
    expect(
      repo.list("signals").find((s) => s.factor === "trendAcceleration")
        ?.normalizedValue,
    ).toBe(50);
    expect(repo.list("opportunities")[0].scoring.score).toBeNull();
    expect(repo.list("opportunities")[0].sourceIds).toHaveLength(1);
    expect(
      (await post("/observations", { ...input, productName: "source-bottle" }))
        .status,
    ).toBe(201);
    await service.runNext();
    expect(repo.list("products")).toHaveLength(1);
    expect(repo.list("observations")).toHaveLength(2);
    const productId = repo.list("products")[0].id;
    const variantResponse = await post("/variants", {
      productId,
      sku: "BOTTLE-500",
      attributes: { size: "500ml" },
    });
    expect(variantResponse.status).toBe(201);
    const variant = await variantResponse.json();
    const offer = {
      productId,
      supplierName: "Test Supplier",
      region: "IN",
      variantId: variant.id,
      moq: 10,
      unitCost: 200,
      shippingCost: null,
      deliveryDays: null,
      rating: null,
      stockStatus: "UNKNOWN",
      reference: "https://example.com/offer",
      lastChecked: "2026-09-01T00:00:00.000Z",
    };
    expect((await post("/offers", offer)).status).toBe(201);
    expect(repo.list("offers")[0].shippingCost).toBeNull();
    expect(repo.list("products")[0].supplierIds).toHaveLength(1);
    expect(
      (
        await post("/variants", {
          productId,
          sku: "BOTTLE-500",
          attributes: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (await post("/offers", { ...offer, productId: "missing" })).status,
    ).toBe(404);
    service.saveCosts(productId, {
      sellingPrice: 600,
      productCost: 200,
      shipping: 50,
      paymentFeeRate: 0.02,
      paymentFeeFixed: 0,
      platformFeeRate: 0,
      advertisingCost: 100,
      returnsAllowance: 30,
      otherVariableCosts: 0,
    });
    expect(repo.list("opportunities")[0].costId).toBe(repo.list("costs")[0].id);
    expect(repo.list("opportunities")[0].sellingPrice).toBe(600);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    repo.close();
  }
});
