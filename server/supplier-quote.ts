import { z } from "zod";
import type { SourceObservation, SupplierOffer } from "../shared/domain";
import type { Service } from "./service";

export const SUPPLIER_QUOTE_SOURCE = "operator-supplier-quote" as const;

const url = z.string().url().max(2000);
const money = z.number().finite().nonnegative().max(1e9);

export const supplierQuoteInput = z
  .object({
    productId: z.string().min(1).max(150),
    supplierName: z.string().trim().min(1).max(200),
    supplierRegion: z.string().trim().min(1).max(100),
    productName: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100),
    sku: z.string().trim().max(200).optional(),
    moq: z.number().int().positive().max(1_000_000),
    unitCost: money,
    shippingCost: money,
    deliveryDays: z.number().int().positive().max(365).nullable(),
    stockStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
    rating: z.number().finite().min(0).max(5).nullable(),
    currency: z.string().trim().length(3).toUpperCase(),
    sourceUrl: url,
    observedAt: z.string().datetime({ offset: true }),
    quoteReference: z.string().trim().min(3).max(2000),
  })
  .strict();

export type SupplierQuoteInput = z.infer<typeof supplierQuoteInput>;

/** Operator-supplied evidence; no marketplace scraping or sales inference. */
export class OperatorSupplierQuoteProvider {
  readonly id = SUPPLIER_QUOTE_SOURCE;
  readonly evidenceKinds = ["SUPPLIER", "SHIPPING", "PRICE"] as const;

  validate(input: unknown) {
    return supplierQuoteInput.parse(input);
  }

  async fetch(input: SupplierQuoteInput): Promise<SourceObservation[]> {
    const fetchedAt = new Date().toISOString();
    const externalId = `quote:${input.quoteReference}`;
    return [
      {
        id: `observation:${externalId}`,
        workspaceId: "default",
        createdAt: fetchedAt,
        updatedAt: fetchedAt,
        mode: "LIVE",
        region: input.supplierRegion,
        signalType: "VERIFIED_SUPPLIER_QUOTE",
        signalValue: input.unitCost,
        confidence: 1,
        fetchedAt,
        providerVersion: "1.0",
        sourceId: this.id,
        sourceUrl: input.sourceUrl,
        externalId,
        productName: input.productName,
        category: input.category,
        observedAt: input.observedAt,
        reference: input.quoteReference,
        payload: {
          productId: input.productId,
          supplierName: input.supplierName,
          supplierRegion: input.supplierRegion,
          sku: input.sku ?? null,
          moq: input.moq,
          unitCost: input.unitCost,
          shippingCost: input.shippingCost,
          deliveryDays: input.deliveryDays,
          stockStatus: input.stockStatus,
          rating: input.rating,
          currency: input.currency,
          verificationStatus: "OPERATOR_VERIFIED",
          meaning:
            "Supplier quote evidence supplied and verified by the operator; not a purchase or sales observation.",
        },
      },
    ];
  }

  extractSignals() {
    return [];
  }
}

export function supplierOfferFromQuote(
  service: Service,
  input: SupplierQuoteInput,
  observation: SourceObservation,
): SupplierOffer {
  const product = service.repo.get("products", input.productId);
  const supplier = service.repo
    .list("suppliers")
    .find(
      (item) =>
        item.name === input.supplierName && item.region === input.supplierRegion,
    );
  const now = new Date().toISOString();
  const nextSupplier =
    supplier ?? {
      ...service.base(),
      name: input.supplierName,
      region: input.supplierRegion,
      reference: input.sourceUrl,
      confidence: 1,
    };
  if (!supplier) service.repo.put("suppliers", nextSupplier);
  if (!(product.supplierIds ?? []).includes(nextSupplier.id))
    service.repo.put("products", {
      ...product,
      supplierIds: [...product.supplierIds, nextSupplier.id],
      updatedAt: now,
    });

  return {
    ...service.base(),
    source: SUPPLIER_QUOTE_SOURCE,
    sku: input.sku,
    supplierId: nextSupplier.id,
    productId: input.productId,
    variantId: null,
    moq: input.moq,
    unitCost: input.unitCost,
    shippingCost: input.shippingCost,
    deliveryDays: input.deliveryDays,
    region: input.supplierRegion,
    stockStatus: input.stockStatus,
    rating: input.rating,
    reference: observation.reference,
    lastChecked: input.observedAt,
    currency: input.currency,
    updatedAt: now,
  };
}
