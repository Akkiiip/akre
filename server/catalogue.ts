import type { Express } from "express";
import { z } from "zod";
import type { Service } from "./service";
import { factors } from "../shared/domain";
import {
  identityKey,
  normalize,
  NORMALIZATION_VERSION,
} from "../shared/discovery";
import { scoreOpportunity } from "../shared/scoring";
const text = z.string().trim().min(1).max(200),
  id = z.string().min(1).max(150),
  amount = z.number().finite().nonnegative().max(1e9);
const reference = z
  .url()
  .refine(
    (v) => ["https:", "http:"].includes(new URL(v).protocol),
    "Use an HTTP(S) source URL",
  );
export function registerCatalogue(app: Express, s: Service) {
  app.post("/api/observations", (req, res) => {
    const input = z
      .object({
        productName: text,
        category: text,
        sourceName: text,
        reference,
        note: z.string().trim().min(3).max(10000),
        measurements: z
          .array(
            z
              .object({
                factor: z.enum(factors),
                value: z.number().finite(),
                min: z.number().finite(),
                max: z.number().finite(),
                unit: text,
              })
              .strict()
              .refine((m) => m.max > m.min, "Maximum must exceed minimum"),
          )
          .max(11)
          .default([]),
      })
      .strict()
      .refine(
        (i) =>
          new Set(i.measurements.map((m) => m.factor)).size ===
          i.measurements.length,
        "One measurement per factor",
      )
      .parse(req.body);
    const opportunity = s.repo.transaction(() => {
      const key = identityKey(input.productName);
      if (!key) throw new Error("Product name must contain letters or numbers");
      let p = s.repo.list("products").find((p) => p.identityKey === key);
      if (!p) {
        p = {
          ...s.base(),
          name: input.productName,
          category: input.category,
          identityKey: key,
          lifecycle: "DISCOVERED",
          supplierIds: [],
        };
        s.repo.put("products", p);
      }
      const sourceId = `manual-${identityKey(input.sourceName).replaceAll(" ", "-")}`;
      s.repo.put("sources", {
        ...s.base(sourceId),
        name: input.sourceName,
        provider: "manual",
        reference: input.reference,
        status: s.repo.mode,
      });
      const observation = {
        ...s.base(),
        sourceId,
        externalId: s.base().id,
        productName: input.productName,
        category: input.category,
        observedAt: new Date().toISOString(),
        reference: input.reference,
        payload: {
          note: input.note,
          measurements: input.measurements,
          method: "Operator-supplied source and normalization bounds",
        },
      };
      s.repo.put("observations", observation);
      for (const m of input.measurements)
        s.repo.put("signals", {
          ...s.base(),
          productId: p.id,
          sourceId,
          observationId: observation.id,
          factor: m.factor,
          rawValue: m.value,
          normalizedValue: normalize(m.value, m.min, m.max),
          unit: m.unit,
          observedAt: observation.observedAt,
          normalizationVersion: NORMALIZATION_VERSION,
        });
      const existing = s.repo
        .list("opportunities")
        .find((o) => o.productId === p!.id);
      if (!existing)
        s.repo.put("opportunities", {
          ...s.base(),
          productId: p.id,
          sourceIds: [sourceId],
          signalIds: [],
          inputs: {},
          scoring: scoreOpportunity({}),
          sellingPrice: null,
          costId: null,
        });
      s.audit("SOURCE_OBSERVATION_RECORDED", p.id, {
        observation,
        normalizationVersion: NORMALIZATION_VERSION,
      });
      return p;
    });
    s.enqueue({ type: "PRODUCT_DISCOVERY", source: "internal", payload: {} });
    res.status(201).json(opportunity);
  });
  app.post("/api/offers", (req, res) => {
    const input = z
      .object({
        productId: id,
        supplierName: text,
        region: text,
        variantId: id.nullable(),
        moq: z.number().int().min(1),
        unitCost: amount,
        shippingCost: amount.nullable(),
        deliveryDays: z.number().int().min(1).nullable(),
        stockStatus: z.enum(["IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"]),
        rating: z.number().min(0).max(100).nullable(),
        reference,
        lastChecked: z.iso.datetime(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      s.repo.transaction(() => {
        const p = s.repo.get("products", input.productId);
        if (
          input.variantId &&
          s.repo.get("variants", input.variantId).productId !== p.id
        )
          throw new Error("Variant belongs to another product");
        let supplier = s.repo
          .list("suppliers")
          .find((v) => identityKey(v.name) === identityKey(input.supplierName));
        if (!supplier) {
          supplier = {
            ...s.base(),
            name: input.supplierName,
            region: input.region,
            reference: input.reference,
            confidence: null,
          };
          s.repo.put("suppliers", supplier);
        }
        const { supplierName, ...fields } = input;
        const offer = {
          ...s.base(),
          ...fields,
          supplierId: supplier.id,
          currency: "INR",
        };
        s.repo.put("offers", offer);
        s.repo.put("products", {
          ...p,
          supplierIds: [...new Set([...p.supplierIds, supplier.id])],
          updatedAt: new Date().toISOString(),
        });
        s.audit("SUPPLIER_OFFER_RECORDED", offer.id, { offer, supplierName });
        return offer;
      }),
    );
  });
  app.post("/api/variants", (req, res) => {
    const input = z
      .object({
        productId: id,
        sku: text,
        attributes: z.record(text, z.string().max(500)),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      s.repo.transaction(() => {
        s.repo.get("products", input.productId);
        if (s.repo.list("variants").some((v) => v.sku === input.sku))
          throw new Error("SKU already exists");
        const variant = { ...s.base(), ...input };
        s.repo.put("variants", variant);
        s.audit("VARIANT_CREATED", variant.id, { variant });
        return variant;
      }),
    );
  });
}
