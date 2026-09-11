import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RepositoryContract } from "./repository";
import { economics } from "../shared/economics";
import { assertTransition } from "../shared/lifecycle";
import { discover, identityKey, deduplicate } from "../shared/discovery";
import { evaluateExperiment } from "../shared/experiments";
import { SCORING_VERSION } from "../shared/scoring";
import {
  jobTypes,
  lifecycles,
  type Entity,
  type Dataset,
  type SyncJob,
} from "../shared/domain";
import {
  ShopifyProvider,
  YouTubeProvider,
  NotConfiguredError,
} from "./providers";
import { WikimediaProvider, ingestionInput } from "./wikimedia";
import { ingestWikimedia, recompute, upsertIdentity } from "./intelligence";
import {
  integrationStates,
  validateShopifyJob,
  executeShopifyJob,
} from "./shopify-workflow";
const amount = z.number().finite().nonnegative().max(1e9),
  count = amount.int();
const date = z.iso.date();
const text = z.string().trim().min(1).max(200),
  id = z.string().min(1).max(150);
export const costSchema = z
  .object({
    sellingPrice: amount,
    productCost: amount,
    shipping: amount,
    paymentFeeRate: z.number().min(0).lt(1),
    paymentFeeFixed: amount,
    platformFeeRate: z.number().min(0).lt(1),
    advertisingCost: amount,
    returnsAllowance: amount,
    otherVariableCosts: amount,
  })
  .strict()
  .refine(
    (i) => i.paymentFeeRate + i.platformFeeRate < 1,
    "Combined fees must be below 100%",
  );
const criteria = z
  .object({
    minImpressions: count.min(1),
    minClicks: count.min(1),
    minPurchases: count.min(1),
    maxSpend: amount.positive(),
    targetRoas: amount,
    minContributionProfit: amount,
  })
  .strict();
export class Service {
  constructor(
    public repo: RepositoryContract,
    public shopify: ShopifyProvider,
    public youtube: YouTubeProvider,
    public wikimedia = new WikimediaProvider(),
  ) {}
  base(id: string = randomUUID()): Entity {
    const at = new Date().toISOString();
    return {
      id,
      workspaceId: "default",
      createdAt: at,
      updatedAt: at,
      mode: this.repo.mode,
    };
  }
  audit(action: string, entityId: string, evidence: Record<string, unknown>) {
    this.repo.put("audit", {
      ...this.base(),
      actorId: "owner",
      action,
      entityId,
      evidence,
    });
  }
  integrations() {
    return integrationStates(this);
  }
  transition(productId: string, body: unknown) {
    const { lifecycle } = z
      .object({ lifecycle: z.enum(lifecycles) })
      .strict()
      .parse(body);
    return this.repo.transaction(() => {
      const p = this.repo.get("products", productId);
      assertTransition(p.lifecycle, lifecycle);
      if (
        lifecycle === "TESTING" &&
        !this.repo.list("experiments").some((e) => e.productId === productId)
      )
        throw new Error("Create an experiment before testing");
      if (
        ["WINNER", "SCALING"].includes(lifecycle) &&
        !this.repo
          .list("decisions")
          .filter((d) => d.productId === productId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 1)
          .some((d) => d.verdict === "SCALE")
      )
        throw new Error("A current SCALE evaluation is required");
      const next = { ...p, lifecycle, updatedAt: new Date().toISOString() };
      this.repo.put("products", next);
      this.audit("LIFECYCLE_TRANSITION", p.id, {
        from: p.lifecycle,
        to: lifecycle,
      });
      return next;
    });
  }
  saveCosts(productId: string, body: unknown) {
    const { supplierOfferId, ...fields } = z
      .object({ supplierOfferId: z.string().nullable().optional() })
      .passthrough()
      .parse(body);
    const assumptions = costSchema.parse(fields);
    economics(assumptions);
    return this.repo.transaction(() => {
      this.repo.get("products", productId);
      if (supplierOfferId) {
        const offer = this.repo.get("offers", supplierOfferId);
        if (
          offer.productId !== productId ||
          offer.shippingCost === null ||
          offer.unitCost !== assumptions.productCost ||
          offer.shippingCost !== assumptions.shipping
        )
          throw new Error(
            "Offer costs must match the selected quote; choose manual assumptions to override",
          );
      }
      const current = this.repo
        .list("costs")
        .find((c) => c.productId === productId);
      const cost = {
        ...(current ?? {
          ...this.base(`cost-${productId}`),
          productId,
          supplierOfferId: null,
          currency: "INR",
        }),
        assumptions,
        supplierOfferId: supplierOfferId ?? null,
        updatedAt: new Date().toISOString(),
      };
      this.repo.put("costs", cost);
      const opportunity = this.repo
        .list("opportunities")
        .find((o) => o.productId === productId);
      if (opportunity)
        this.repo.put("opportunities", {
          ...opportunity,
          costId: cost.id,
          sellingPrice: assumptions.sellingPrice,
          updatedAt: cost.updatedAt,
        });
      this.audit("ECONOMICS_UPDATED", productId, {
        assumptions,
        result: economics(assumptions),
      });
      return cost;
    });
  }
  createAsset(body: unknown) {
    const input = z
      .object({
        productId: id,
        type: z.enum([
          "HOOK",
          "VIDEO",
          "UGC",
          "REELS",
          "CAPTION",
          "AD_ANGLE",
          "BRIEF",
          "VARIANT",
        ]),
        title: text,
        body: z.string().trim().min(1).max(20000),
      })
      .strict()
      .parse(body);
    return this.repo.transaction(() => {
      this.repo.get("products", input.productId);
      const asset = {
        ...this.base(),
        ...input,
        status: "DRAFT" as const,
        externalPublicationId: null,
      };
      this.repo.put("assets", asset);
      this.audit("CONTENT_DRAFT_CREATED", asset.id, {
        productId: input.productId,
      });
      return asset;
    });
  }
  createExperiment(body: unknown) {
    const input = z
      .object({
        productId: id,
        channel: text,
        sellingPrice: amount.positive(),
        creativeId: id,
        budget: amount.positive(),
        startDate: date,
        endDate: date,
        successCriteria: criteria,
        killCriteria: z.object({ maxLoss: amount.positive() }).strict(),
      })
      .strict()
      .refine(
        (i) => i.endDate >= i.startDate,
        "End date must follow start date",
      )
      .refine(
        (i) => i.successCriteria.maxSpend <= i.budget,
        "Spend guardrail must not exceed budget",
      )
      .parse(body);
    return this.repo.transaction(() => {
      const p = this.repo.get("products", input.productId);
      if (!["APPROVED", "TESTING"].includes(p.lifecycle))
        throw new Error("Approve this product before creating a test");
      const asset = this.repo.get("assets", input.creativeId);
      if (asset.productId !== p.id)
        throw new Error("Creative belongs to another product");
      const cost = this.repo.list("costs").find((c) => c.productId === p.id);
      if (!cost)
        throw new Error("Save economics before creating an experiment");
      const experiment = {
        ...this.base(),
        ...input,
        status: "DRAFT" as const,
        costSnapshot: { ...cost.assumptions, sellingPrice: input.sellingPrice },
      };
      this.repo.put("experiments", experiment);
      this.audit("EXPERIMENT_CREATED", experiment.id, {
        input,
        costSnapshot: experiment.costSnapshot,
      });
      return experiment;
    });
  }
  saveMetrics(experimentId: string, body: unknown) {
    const input = z
      .object({
        date,
        spend: amount,
        impressions: count,
        clicks: count,
        addToCart: count,
        checkout: count,
        purchases: count,
        revenue: amount,
        reference: z.string().trim().min(3).max(2000),
      })
      .strict()
      .refine(
        (m) =>
          m.clicks <= m.impressions &&
          m.addToCart <= m.clicks &&
          m.checkout <= m.addToCart &&
          m.purchases <= m.checkout,
        "Funnel counts must be sequential",
      )
      .refine(
        (m) => m.purchases > 0 || m.revenue === 0,
        "Revenue requires purchases",
      )
      .parse(body);
    return this.repo.transaction(() => {
      const e = this.repo.get("experiments", experimentId);
      if (input.date < e.startDate || input.date > e.endDate)
        throw new Error("Metric date outside experiment period");
      const previous = this.repo
        .list("metrics")
        .find((m) => m.experimentId === experimentId && m.date === input.date);
      const metric = {
        ...(previous ?? this.base()),
        ...input,
        experimentId,
        updatedAt: new Date().toISOString(),
      };
      this.repo.put("metrics", metric);
      this.audit("EXPERIMENT_METRICS_SAVED", experimentId, {
        metric,
        previous: previous ?? null,
      });
      this.evaluate(experimentId);
      return metric;
    });
  }
  evaluate(experimentId: string) {
    const e = this.repo.get("experiments", experimentId),
      metrics = this.repo
        .list("metrics")
        .filter((m) => m.experimentId === experimentId);
    const result = evaluateExperiment(e, metrics);
    const decision = {
      ...this.base(),
      productId: e.productId,
      experimentId,
      verdict: result.verdict,
      reasons: result.reasons,
      scoringVersion: SCORING_VERSION,
      evidence: {
        experiment: e,
        metrics,
        result,
        supplierOffers: this.repo
          .list("offers")
          .filter((o) => o.productId === e.productId),
        signals: this.repo
          .list("signals")
          .filter((s) => s.productId === e.productId),
        observations: this.repo
          .list("observations")
          .filter(
            (o) =>
              identityKey(o.productName) ===
              this.repo.get("products", e.productId).identityKey,
          ),
        opportunity:
          this.repo
            .list("opportunities")
            .find((o) => o.productId === e.productId) ?? null,
      },
    };
    this.repo.put("decisions", decision);
    this.audit("EXPERIMENT_EVALUATED", experimentId, { decision });
    return decision;
  }
  createListing(body: unknown) {
    const input = z
      .object({
        productId: id,
        title: text,
        description: z.string().trim().min(1).max(20000),
        price: amount.positive(),
      })
      .strict()
      .parse(body);
    return this.repo.transaction(() => {
      this.repo.get("products", input.productId);
      const stores = this.repo.list("stores");
      if (!stores.length)
        this.repo.put("stores", {
          ...this.base("shopify"),
          name: "Shopify",
          provider: "shopify",
          status: this.shopify.status(),
          domain: null,
        });
      const listing = {
        ...this.base(),
        ...input,
        storeId: "shopify",
        externalId: null,
        status: "DRAFT" as const,
        publishedAt: null,
        lastSyncedAt: null,
        error: null,
      };
      this.repo.put("listings", listing);
      this.audit("STORE_DRAFT_CREATED", listing.id, {
        productId: input.productId,
      });
      return listing;
    });
  }
  enqueue(body: unknown) {
    const input = z
      .object({
        type: z.enum(jobTypes),
        source: z.enum([
          "demo",
          "youtube",
          "shopify",
          "internal",
          "supplier",
          "wikimedia",
        ]),
        payload: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(body);
    if (
      this.repo.mode === "DEMO" &&
      ["youtube", "shopify", "supplier", "wikimedia"].includes(input.source)
    )
      throw new Error("External operations are disabled in DEMO mode");
    if (
      input.type === "TREND_INGESTION" &&
      input.source !== "wikimedia" &&
      (input.source !== "youtube" || this.youtube.status() === "NOT CONFIGURED")
    )
      throw new NotConfiguredError("YouTube");
    if (
      ["STORE_SYNC", "ORDER_SYNC"].includes(input.type) &&
      (input.source !== "shopify" || this.shopify.status() === "NOT CONFIGURED")
    )
      throw new NotConfiguredError("Shopify");
    if (input.type === "SUPPLIER_REFRESH")
      throw new NotConfiguredError("Supplier feed");
    if (input.type === "TREND_INGESTION") {
      if (input.source === "wikimedia") ingestionInput.parse(input.payload);
      else text.parse(input.payload.query);
    }
    validateShopifyJob(this, input);
    if (input.type === "STORE_SYNC") {
      id.parse(input.payload.listingId);
      this.repo.get("listings", String(input.payload.listingId));
    }
    return this.repo.transaction(() => {
      const job: SyncJob = {
        ...this.base(),
        ...input,
        status: "QUEUED",
        startedAt: null,
        completedAt: null,
        error: null,
        retryCount: 0,
        requestedBy: "owner",
        ...(input.source === "shopify"
          ? { providerFingerprint: this.shopify.fingerprint() }
          : {}),
      };
      this.repo.put("jobs", job);
      this.audit("JOB_QUEUED", job.id, { type: job.type, source: job.source });
      return job;
    });
  }
  retry(jobId: string) {
    return this.repo.transaction(() => {
      const j = this.repo.get("jobs", jobId);
      if (j.status !== "ERROR" || j.retryCount >= 3)
        throw new Error(
          "Only failed jobs with fewer than three retries can be retried",
        );
      if (
        j.type === "STORE_SYNC" &&
        !this.repo.get("listings", String(j.payload.listingId)).externalId
      )
        throw new Error(
          "Reconcile the remote Shopify product before retrying a potentially completed create",
        );
      const next = {
        ...j,
        status: "QUEUED" as const,
        retryCount: j.retryCount + 1,
        error: null,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date().toISOString(),
      };
      this.repo.put("jobs", next);
      this.audit("JOB_RETRIED", j.id, { retryCount: next.retryCount });
      return next;
    });
  }
  async runNext() {
    let job: SyncJob | undefined;
    this.repo.transaction(() => {
      job = this.repo.list("jobs").find((j) => j.status === "QUEUED");
      if (job) {
        job = {
          ...job,
          status: "RUNNING",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.repo.put("jobs", job);
        this.audit("JOB_STARTED", job.id, { type: job.type });
      }
    });
    if (!job) return false;
    try {
      await this.execute(job);
      this.repo.transaction(() => {
        this.repo.put("jobs", {
          ...job!,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.audit("JOB_COMPLETED", job!.id, { type: job!.type });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      this.repo.transaction(() => {
        this.repo.put("jobs", {
          ...job!,
          status: "ERROR",
          error: message,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.audit("JOB_FAILED", job!.id, { error: message });
        if (job!.type === "STORE_SYNC") {
          const listing = this.repo.get(
            "listings",
            String(job!.payload.listingId),
          );
          this.repo.put("listings", {
            ...listing,
            status: "ERROR",
            error: message,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }
    return true;
  }
  async execute(job: SyncJob) {
    if (await executeShopifyJob(this, job)) return;
    if (job.type === "TREND_INGESTION" && job.source === "wikimedia") {
      await ingestWikimedia(this, job, this.wikimedia);
      return;
    }
    if (job.type === "TREND_INGESTION") {
      const observations = await this.youtube.observe(
        String(job.payload.query),
      );
      this.repo.transaction(() => {
        this.repo.put("sources", {
          ...this.base("youtube"),
          name: "YouTube Data API",
          provider: "youtube",
          reference:
            "https://developers.google.com/youtube/v3/docs/search/list",
          status: "CONNECTED",
        });
        for (const o of deduplicate(observations))
          this.repo.put("observations", o);
      });
      return;
    }
    if (job.type === "PRODUCT_DISCOVERY") {
      this.repo.transaction(() => {
        for (const o of deduplicate(this.repo.list("observations")))
          upsertIdentity(this, o);
        for (const p of this.repo.list("products"))
          recompute(this, p.id, "EXPLICIT_RECALCULATION", true);
      });
      return;
    }
    if (job.type === "ECONOMICS_RECALCULATION") {
      this.repo.transaction(() => {
        for (const cost of this.repo.list("costs"))
          this.audit("ECONOMICS_RECALCULATED", cost.productId, {
            assumptions: cost.assumptions,
            result: economics(cost.assumptions),
          });
      });
      return;
    }
    if (
      job.type === "EXPERIMENT_EVALUATION" ||
      job.type === "WINNER_DETECTION"
    ) {
      this.repo.transaction(() => {
        for (const e of this.repo.list("experiments")) this.evaluate(e.id);
      });
      return;
    }
    if (job.type === "STORE_SYNC") {
      let listing = this.repo.get("listings", String(job.payload.listingId));
      this.repo.put("listings", {
        ...listing,
        status: "SYNCING",
        updatedAt: new Date().toISOString(),
      });
      if (!listing.externalId) {
        const externalId = await this.shopify.createProduct(listing);
        listing = { ...listing, externalId };
        this.repo.put("listings", listing);
      } else
        await this.shopify.updateProduct(
          listing.externalId,
          listing.title,
          listing.description,
        );
      // Draft content only: price/inventory/publishing require explicit remote variant/publication IDs.
      this.repo.put("listings", {
        ...listing,
        status: "SYNCED",
        lastSyncedAt: new Date().toISOString(),
        error: null,
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if (job.type === "ORDER_SYNC") {
      const since = z.iso.date().parse(job.payload.since ?? "2026-01-01");
      const raw = await this.shopify.syncOrders(since);
      const orderSchema = z.object({
        id: z.string(),
        createdAt: z.iso.datetime(),
        currencyCode: z.literal("INR"),
        currentTotalPriceSet: z.object({
          shopMoney: z.object({ amount: z.string() }),
        }),
        currentTotalTaxSet: z.object({
          shopMoney: z.object({ amount: z.string() }),
        }),
        totalRefundedSet: z.object({
          shopMoney: z.object({ amount: z.string() }),
        }),
      });
      this.repo.transaction(() => {
        if (!this.repo.list("stores").length)
          this.repo.put("stores", {
            ...this.base("shopify"),
            name: "Shopify",
            provider: "shopify",
            status: this.shopify.status(),
            domain: null,
          });
        for (const item of raw) {
          const o = orderSchema.parse(item);
          const tax = Number(o.currentTotalTaxSet.shopMoney.amount);
          if (!Number.isFinite(tax) || tax < 0)
            throw new Error("Invalid order tax");
          const revenue = Number(o.currentTotalPriceSet.shopMoney.amount) - tax;
          if (!Number.isFinite(revenue) || revenue < 0)
            throw new Error("Invalid order amount");
          this.repo.put("orders", {
            ...this.base(o.id),
            storeId: "shopify",
            externalId: o.id,
            orderedAt: o.createdAt,
            currency: o.currencyCode,
            revenue,
            refunds: 0,
            variableCosts: null,
            acquisitionCost: null,
            customerId: null,
          });
        }
        this.audit("ORDERS_IMPORTED", job.id, {
          count: raw.length,
          notice:
            "Shopify current total less current tax; refunds already reflected. Costs and attribution unavailable.",
        });
      });
      return;
    }
    throw new Error(`${job.type}: NOT CONFIGURED`);
  }
}
