import { z } from "zod";
import type { Express } from "express";
import type { Service } from "./service";
import { recompute, matchProduct, ingestWikimedia } from "./intelligence";
import { identityKey } from "../shared/discovery";
import { GoogleTrendsProvider, googleTrendsInput } from "./google-trends";
import { runDiscovery } from "./discovery-engine";
import { ingestionInput } from "./wikimedia";
import { OperatorSupplierQuoteProvider, supplierOfferFromQuote } from "./supplier-quote";
import { cjSearchInput, searchCjProducts, cjIntegrationStatus } from "./cj-dropshipping";
import { supplierCatalogSearchInput, searchSupplierCatalogs } from "./supplier-catalogs";
import type { SyncJob } from "../shared/domain";

export function registerLiveRoutes(app: Express, s: Service) {
  app.get("/api/suppliers/catalogs", (_req, res) => {
    res.json({ suppliers: searchSupplierCatalogs({ query: "" }) });
  });

  app.post("/api/suppliers/catalogs/search", (req, res) => {
    const input = supplierCatalogSearchInput.parse(req.body);
    res.json({ suppliers: searchSupplierCatalogs(input) });
  });

  app.get("/api/suppliers/cj/status", (_req, res) => res.json(cjIntegrationStatus()));

  app.post("/api/suppliers/cj/search", async (req, res) => {
    if (s.repo.mode !== "LIVE") {
      res.status(409).json({ error: "CJ supplier search requires the LIVE workspace" });
      return;
    }
    const input = cjSearchInput.parse(req.body);
    const result = await searchCjProducts(input);
    res.json({
      provider: "cj-dropshipping",
      keyword: input.keyword,
      countryCode: input.countryCode,
      ...result,
      evidence: {
        source: "CJ Dropshipping catalog",
        priceCurrency: "USD",
        stock: "CJ warehouse inventory",
        purchaseEvidence: "INSUFFICIENT DATA",
      },
    });
  });

  app.post("/api/discovery/runs", async (req, res) => {
    const input = z
      .object({
        provider: z.enum(["wikimedia", "google-trends"]).optional(),
        payload: z.record(z.string(), z.unknown()).default({}),
        runs: z
          .array(
            z
              .object({
                provider: z.enum(["wikimedia", "google-trends"]),
                payload: z.record(z.string(), z.unknown()).default({}),
              })
              .strict(),
          )
          .min(1)
          .max(2)
          .optional(),
      })
      .strict()
      .refine((v) => Boolean(v.runs?.length || v.provider), "provider or runs is required")
      .parse(req.body);

    const runs = input.runs ?? [{ provider: input.provider!, payload: input.payload }];
    const jobs: SyncJob[] = [];

    for (const run of runs) {
      if (run.provider === "google-trends") googleTrendsInput.parse(run.payload);
      else ingestionInput.parse(run.payload);

      const job: SyncJob = {
        ...s.base(),
        type: "TREND_INGESTION",
        source: run.provider,
        payload: run.payload,
        status: "RUNNING",
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
        retryCount: 0,
        requestedBy: "owner",
      };
      s.repo.put("jobs", job);
      s.audit("JOB_STARTED", job.id, {
        type: job.type,
        source: job.source,
        requestBounded: true,
      });
      jobs.push(job);

      try {
        if (run.provider === "google-trends") {
          await runDiscovery(s, job, new GoogleTrendsProvider());
        } else {
          await ingestWikimedia(s, job, s.wikimedia);
        }
        s.repo.put("jobs", {
          ...job,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        s.audit("JOB_COMPLETED", job.id, {
          type: job.type,
          source: job.source,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Discovery run failed";
        s.repo.put("jobs", {
          ...job,
          status: "ERROR",
          error: message,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        s.audit("JOB_FAILED", job.id, {
          type: job.type,
          source: job.source,
          error: message,
        });
        s.audit("DISCOVERY_RUN_FAILED", job.id, {
          provider: run.provider,
          error: message,
        });
      }
    }

    const latest = jobs.map((job) => s.repo.get("jobs", job.id));
    res.status(202).json({
      jobs: latest,
      requestBounded: true,
      evidence: latest.map((job) => ({
        source: job.source,
        kind: job.source === "google-trends" ? "DEMAND/SEARCH" : "ATTENTION",
      })),
    });
  });

  app.post("/api/supplier-quotes", async (req, res) => {
    if (s.repo.mode !== "LIVE") {
      res.status(409).json({ error: "Supplier evidence requires the LIVE workspace" });
      return;
    }
    const provider = new OperatorSupplierQuoteProvider();
    const input = provider.validate(req.body);
    const product = s.repo.get("products", input.productId);
    const normalizedName = product.canonicalName ?? product.name;
    if (
      input.productName !== normalizedName &&
      !(product.aliases ?? []).includes(input.productName)
    )
      throw new Error("Quote product does not match the selected product identity");

    const observation = (await provider.fetch(input))[0];
    const offer = supplierOfferFromQuote(s, input, observation);
    const result = s.repo.transaction(() => {
      const existingObservation = s.repo
        .list("observations")
        .find(
          (item) =>
            item.sourceId === provider.id && item.externalId === observation.externalId,
        );
      if (existingObservation) {
        if (JSON.stringify(existingObservation.payload) !== JSON.stringify(observation.payload))
          throw new Error(
            "Quote reference already exists with different evidence; use a new quote reference",
          );
      } else {
        s.repo.put("observations", observation);
      }
      s.repo.put("offers", offer);
      s.audit("SUPPLIER_QUOTE_VERIFIED", offer.id, {
        productId: product.id,
        supplierId: offer.supplierId,
        observationId: observation.id,
        evidenceKinds: [...provider.evidenceKinds],
        verificationStatus: "OPERATOR_VERIFIED",
        sourceUrl: input.sourceUrl,
        observedAt: input.observedAt,
      });
      const opportunity = recompute(s, product.id, "SUPPLIER_QUOTE_VERIFIED");
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

  app.get("/api/products/:id/intelligence", (req, res) => {
    const productId = String(req.params.id);
    s.repo.get("products", productId);
    const opportunity = s.repo.list("opportunities").find((item) => item.productId === productId);
    res.json({
      opportunity: opportunity ?? null,
      scoreHistory: s.repo.list("scoreHistory").filter((item) => item.productId === productId),
      evidence: {
        observations: s.repo.list("observations").filter((item) => item.productName === s.repo.get("products", productId).name),
        signals: s.repo.list("signals").filter((item) => item.productId === productId),
      },
      supplierOffers: s.repo.list("offers").filter((item) => item.productId === productId),
    });
  });
  app.get("/api/products/:id/supplier-offers", (req, res) => {
    const product = s.repo.get("products", String(req.params.id));
    res.json({
      offers: s.repo.list("offers").filter((offer) => offer.productId === product.id),
      observations: s.repo
        .list("observations")
        .filter(
          (observation) =>
            observation.sourceId === "operator-supplier-quote" &&
            observation.payload.productId === product.id,
        ),
    });
  });
  app.post("/api/products/:id/recompute", (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      s.repo.transaction(() =>
        recompute(s, String(req.params.id), "EXPLICIT_CURRENT_MODEL", true),
      ),
    );
  });
  app.patch("/api/products/:id/identity", (req, res) => {
    const input = z
      .object({
        canonicalName: z.string().trim().min(1).max(200),
        category: z.string().trim().min(1).max(100),
        aliases: z.array(z.string().trim().min(1).max(200)).max(30),
      })
      .strict()
      .parse(req.body);
    res.json(
      s.repo.transaction(() => {
        const old = s.repo.get("products", String(req.params.id));
        for (const name of [input.canonicalName, ...input.aliases])
          if (
            matchProduct(
              s.repo.list("products").filter((p) => p.id !== old.id),
              name,
              input.category,
              null,
            )
          )
            throw new Error(
              "Alias matches another product; automatic merging is prohibited",
            );
        const next = {
          ...old,
          ...input,
          name: input.canonicalName,
          identityKey: identityKey(input.canonicalName),
          aliases: [
            ...new Set([old.name, ...(old.aliases ?? []), ...input.aliases]),
          ],
          updatedAt: new Date().toISOString(),
        };
        s.repo.put("products", next);
        s.audit("PRODUCT_IDENTITY_UPDATED", old.id, {
          before: old,
          after: next,
        });
        return next;
      }),
    );
  });
  app.patch("/api/listings/:id", (req, res) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(20000),
      })
      .strict()
      .parse(req.body);
    res.json(
      s.repo.transaction(() => {
        const prior = s.repo.get("listings", String(req.params.id));
        if (
          s.repo
            .list("jobs")
            .some(
              (j) =>
                ["QUEUED", "RUNNING"].includes(j.status) &&
                j.payload.listingId === prior.id,
            )
        )
          throw new Error("Wait for the active synchronization before editing");
        const next = {
          ...prior,
          ...input,
          status: "DRAFT" as const,
          updatedAt: new Date().toISOString(),
        };
        s.repo.put("listings", next);
        s.audit("STORE_DRAFT_UPDATED", prior.id, {
          before: { title: prior.title, description: prior.description },
          after: input,
        });
        return next;
      }),
    );
  });
  app.post("/api/listings/:id/reconcile", (req, res) => {
    const { externalId } = z
      .object({
        externalId: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
      })
      .strict()
      .parse(req.body);
    res.json(
      s.repo.transaction(() => {
        const imported = s.repo
          .list("listings")
          .find((l) => l.externalId === externalId && l.lastSyncedAt);
        if (!imported)
          throw new Error(
            "Import and inspect the Shopify product before reconciling",
          );
        const local = s.repo.get("listings", String(req.params.id));
        if (local.externalId && local.externalId !== externalId)
          throw new Error("Listing already linked to a different product");
        const next = {
          ...local,
          externalId,
          remoteVariants: imported.remoteVariants,
          status: "DRAFT" as const,
          error: null,
          updatedAt: new Date().toISOString(),
        };
        s.repo.put("listings", next);
        s.audit("SHOPIFY_CREATE_RECONCILED", local.id, {
          externalId,
          importedListingId: imported.id,
        });
        return next;
      }),
    );
  });
}
