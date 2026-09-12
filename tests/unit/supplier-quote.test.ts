import { describe, expect, it } from "vitest";
import { OperatorSupplierQuoteProvider, supplierQuoteInput } from "../../server/supplier-quote";

describe("operator supplier quote provider", () => {
  const valid = {
    productId: "p1",
    supplierName: "Example Supplier",
    supplierRegion: "India",
    productName: "Portable Blender",
    category: "Kitchen",
    sku: "PB-01",
    moq: 10,
    unitCost: 499,
    shippingCost: 80,
    deliveryDays: 5,
    stockStatus: "IN_STOCK" as const,
    rating: 4.5,
    currency: "INR",
    sourceUrl: "https://supplier.example/quote/PB-01",
    observedAt: "2026-09-13T10:00:00.000Z",
    quoteReference: "PB-01-2026-09-13",
  };

  it("declares supplier, shipping and price capabilities without purchase claims", async () => {
    const provider = new OperatorSupplierQuoteProvider();
    const input = provider.validate(valid);
    const [observation] = await provider.fetch(input);
    expect(provider.evidenceKinds).toEqual(["SUPPLIER", "SHIPPING", "PRICE"]);
    expect(observation.sourceId).toBe("operator-supplier-quote");
    expect(observation.sourceUrl).toBe(valid.sourceUrl);
    expect(observation.observedAt).toBe(valid.observedAt);
    expect(observation.payload.verificationStatus).toBe("OPERATOR_VERIFIED");
    expect(observation.payload.meaning).toContain("not a purchase");
    expect(provider.extractSignals([observation], "p1")).toEqual([]);
  });

  it("rejects incomplete provenance and unsafe economics", () => {
    expect(() => supplierQuoteInput.parse({ ...valid, sourceUrl: "not-a-url" })).toThrow();
    expect(() => supplierQuoteInput.parse({ ...valid, unitCost: -1 })).toThrow();
    expect(() => supplierQuoteInput.parse({ ...valid, moq: 0 })).toThrow();
    expect(() => supplierQuoteInput.parse({ ...valid, quoteReference: "x" })).toThrow();
  });

  it("requires an explicit quote reference so repeated snapshots do not silently overwrite evidence", async () => {
    const provider = new OperatorSupplierQuoteProvider();
    await expect(provider.fetch(provider.validate({ ...valid, quoteReference: "" }))).rejects.toThrow();
  });
});
