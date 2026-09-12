import type { Express } from "express";
import type { Service } from "./service";
import { recompute } from "./intelligence";
import {
  OperatorSupplierQuoteProvider,
  supplierOfferFromQuote,
  supplierQuoteInput,
} from "./supplier-quote";

export function registerSupplierRoutes(app: Express, service: Service) {
  app.post("/api/supplier-quotes", async (req, res) => {
    if (service.repo.mode !== "LIVE") {
      res.status(409).json({ error: "Supplier evidence requires the LIVE workspace" });
      return;
    }

    const input = new OperatorSupplierQuoteProvider().validate(req.body);
    const product = service.repo.get("products", input.productId);
    const normalizedName = product.canonicalName ?? product.name;
    if (input.productName !== normalizedName && !(product.aliases ?? []).includes(input.productName))
      throw new Error("Quote product does not match the selected product identity");
    if (input.currency !== productWorkspaceCurrency(service))
      throw new Error(`Quote currency must match workspace currency (${productWorkspaceCurrency(service)})`);

    const provider = new OperatorSupplierQuoteProvider();
    const observation = (await provider.fetch(input))[0];
    const offer = supplierOfferFromQuote(service, input, observation);

    const result = service.repo.transaction(() => {
      const existingObservation = service.repo
        .list("observations")
        .find(
          (item) =>
            item.sourceId === provider.id && item.externalId === observation.externalId,
        );
      if (existingObservation) {
        if (JSON.stringify(existingObservation.payload) !== JSON.stringify(observation.payload))
          throw new Error("Quote reference already exists with different evidence; use a new quote reference");
      } else {
        service.repo.put("observations", observation);
      }
      service.repo.put("offers", offer);
      service.audit("SUPPLIER_QUOTE_VERIFIED", offer.id, {
        productId: product.id,
        supplierId: offer.supplierId,
        observationId: observation.id,
        evidenceKinds: [...provider.evidenceKinds],
        verificationStatus: "OPERATOR_VERIFIED",
        sourceUrl: input.sourceUrl,
        observedAt: input.observedAt,
      });
      const opportunity = recompute(service, product.id, "SUPPLIER_QUOTE_VERIFIED");
      return { observation, offer, opportunity };
    });

    res.status(201).json({
      ...result,
      evidence: {
        source: provider.id,
        kinds: [...provider.evidenceKinds],
        verification: "OPERATOR_VERIFIED",
        purchaseEvidence: "INSUFFICIENT DATA",
      },
    });
  });

  app.get("/api/products/:id/supplier-offers", (req, res) => {
    const product = service.repo.get("products", String(req.params.id));
    const supplierIds = new Set(product.supplierIds);
    res.json({
      offers: service.repo
        .list("offers")
        .filter((offer) => offer.productId === product.id || supplierIds.has(offer.supplierId)),
      observations: service.repo
        .list("observations")
        .filter(
          (observation) =>
            observation.sourceId === "operator-supplier-quote" &&
            (observation.payload.productId === product.id || observation.productName === product.name),
        ),
    });
  });
}

function productWorkspaceCurrency(service: Service) {
  return service.repo.list("workspaces" as never)[0]?.currency ?? "INR";
}
