import { z } from "zod";
import type { Service } from "./service";
import type { SyncJob, StoreProduct } from "../shared/domain";
import { identityKey } from "../shared/discovery";
import {
  importProducts,
  readProduct,
  remoteVariants,
  setInventory,
  type RemoteProduct,
} from "./shopify-api";
const shopifyTypes = [
  "SHOPIFY_CONNECT",
  "SHOPIFY_PRODUCT_IMPORT",
  "SHOPIFY_PRICE_SYNC",
  "SHOPIFY_INVENTORY_SYNC",
  "STORE_SYNC",
  "ORDER_SYNC",
];
const id = z.string().min(1).max(200),
  gid = z.string().regex(/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/);
export function integrationStates(s: Service) {
  return [
    {
      provider: "Shopify",
      source: "shopify",
      configured: s.shopify.status() !== "NOT CONFIGURED",
    },
    { provider: "Wikimedia", source: "wikimedia", configured: true },
    {
      provider: "YouTube",
      source: "youtube",
      configured: s.youtube.status() !== "NOT CONFIGURED",
    },
    ...[
      "Google Trends",
      "Meta / Instagram",
      "TikTok",
      "Reddit",
      "Search data",
      "Marketplace",
      "Supplier feeds",
    ].map((provider) => ({
      provider,
      source: provider.toLowerCase(),
      configured: false,
    })),
  ].map((p) => {
    const jobs = s.repo
      .list("jobs")
      .filter((j) => j.source === p.source)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const latest = jobs[0],
      running = jobs.some((j) => ["QUEUED", "RUNNING"].includes(j.status)),
      success = jobs.find(
        (j) =>
          j.status === "COMPLETED" &&
          j.type !== "SHOPIFY_CONNECT" &&
          (p.source !== "shopify" ||
            j.providerFingerprint === s.shopify.fingerprint()),
      );
    const verified = s.repo
      .list("connections")
      .find(
        (c) =>
          c.provider === p.source &&
          (p.source !== "shopify" || c.fingerprint === s.shopify.fingerprint()),
      );
    let status = !p.configured
      ? "NOT CONFIGURED"
      : p.source === "wikimedia"
        ? success
          ? "LIVE"
          : "NOT CONFIGURED"
        : verified?.verifiedAt
          ? "CONNECTED"
          : "UNVERIFIED";
    if (p.configured && running) status = "SYNCING";
    else if (p.configured && latest?.status === "ERROR") status = "ERROR";
    else if (p.source === "shopify" && verified?.verifiedAt && success)
      status = "SYNCED";
    if (p.source === "wikimedia" && status === "LIVE") {
      const newest = Math.max(
        ...s.repo
          .list("observations")
          .filter((o) => o.sourceId === "wikimedia")
          .map((o) => Date.parse(o.observedAt)),
      );
      if (!Number.isFinite(newest) || Date.now() - newest > 7 * 86400000)
        status = "STALE";
    }
    return {
      ...p,
      status,
      lastSyncedAt: success?.completedAt ?? null,
      verifiedAt: verified?.verifiedAt ?? null,
      error: latest?.status === "ERROR" ? latest.error : null,
      detail: verified?.detail ?? null,
    };
  });
}
export function validateShopifyJob(
  s: Service,
  j: { type: string; source: string; payload: Record<string, unknown> },
) {
  if (!shopifyTypes.includes(j.type)) {
    if (j.source === "shopify") throw new Error("Invalid Shopify job type");
    return;
  }
  if (j.source !== "shopify" || s.shopify.status() === "NOT CONFIGURED")
    throw new Error("Shopify: NOT CONFIGURED");
  if (j.type === "SHOPIFY_CONNECT" || j.type === "SHOPIFY_PRODUCT_IMPORT")
    z.object({}).strict().parse(j.payload);
  if (j.type === "STORE_SYNC") {
    z.object({ listingId: id }).strict().parse(j.payload);
    s.repo.get("listings", String(j.payload.listingId));
  }
  if (j.type === "ORDER_SYNC")
    z.object({ since: z.iso.date() }).strict().parse(j.payload);
  if (j.type === "SHOPIFY_PRICE_SYNC" || j.type === "SHOPIFY_INVENTORY_SYNC") {
    const common = { listingId: id, variantId: gid };
    const input =
      j.type === "SHOPIFY_PRICE_SYNC"
        ? z
            .object({
              ...common,
              price: z.number().finite().positive().max(1e9),
            })
            .strict()
            .parse(j.payload)
        : z
            .object({
              ...common,
              locationId: gid,
              quantity: z.number().int().min(0).max(1e9),
              changeFromQuantity: z.number().int(),
            })
            .strict()
            .parse(j.payload);
    const listing = s.repo.get("listings", input.listingId);
    if (
      !listing.externalId ||
      !listing.remoteVariants?.some((v) => v.id === input.variantId)
    )
      throw new Error(
        "Import the Shopify product and variant before synchronizing",
      );
  }
}
export function saveRemoteProduct(
  s: Service,
  remote: RemoteProduct,
  existing?: StoreProduct,
) {
  const prior =
    existing ?? s.repo.list("listings").find((l) => l.externalId === remote.id);
  let productId = prior?.productId;
  if (!productId) {
    const base = s.base();
    productId = base.id;
    s.repo.put("products", {
      ...base,
      name: remote.title,
      canonicalName: remote.title,
      category: remote.productType || "Unclassified",
      identityKey: `shopify:${remote.id}`,
      aliases: [remote.title],
      sourceReferences: [remote.id],
      firstSeen: base.createdAt,
      lastSeen: base.createdAt,
      lifecycle: "DISCOVERED",
      supplierIds: [],
    });
  }
  const variants = remoteVariants(remote);
  const listing: StoreProduct = {
    ...(prior ?? {
      ...s.base(),
      productId,
      storeId: "shopify",
      publishedAt: null,
      price: variants[0]?.price ?? 0,
    }),
    externalId: remote.id,
    title: remote.title,
    description: remote.descriptionHtml,
    remoteVariants: variants,
    remoteStatus: remote.status,
    status: "SYNCED",
    lastSyncedAt: new Date().toISOString(),
    error: null,
    updatedAt: new Date().toISOString(),
  };
  s.repo.put("listings", listing);
  for (const variant of variants) {
    const known = s.repo.list("variants").find((v) => v.id === variant.id);
    s.repo.put("variants", {
      ...(known ?? s.base(variant.id)),
      productId,
      sku: variant.sku || variant.id,
      attributes: {
        shopifyVariantId: variant.id,
        inventoryItemId: variant.inventoryItemId,
      },
    });
  }
  return listing;
}
async function verify(s: Service) {
  try {
    const shop = await s.shopify.testConnection();
    s.repo.transaction(() => {
      s.repo.put("connections", {
        ...s.base("shopify"),
        provider: "shopify",
        status: "CONNECTED",
        verifiedAt: new Date().toISOString(),
        fingerprint: s.shopify.fingerprint(),
        detail: shop,
        lastSyncedAt: null,
        error: null,
      });
      s.repo.put("stores", {
        ...s.base("shopify"),
        name: shop.name,
        provider: "shopify",
        status: "CONNECTED",
        domain: shop.myshopifyDomain,
      });
      s.audit("SHOPIFY_CONNECTION_VERIFIED", "shopify", { shop });
    });
    return shop;
  } catch (e) {
    s.repo.transaction(() => {
      s.repo.put("connections", {
        ...s.base("shopify"),
        provider: "shopify",
        status: "ERROR",
        fingerprint: s.shopify.fingerprint(),
        lastSyncedAt: null,
        error: e instanceof Error ? e.message : "Connection failed",
      });
      s.audit("SHOPIFY_CONNECTION_FAILED", "shopify", {
        error: e instanceof Error ? e.message : "Connection failed",
      });
    });
    throw e;
  }
}
export async function executeShopifyJob(
  s: Service,
  j: SyncJob,
): Promise<boolean> {
  if (!shopifyTypes.includes(j.type)) return false;
  if (s.repo.mode !== "LIVE")
    throw new Error("Shopify writes require the LIVE workspace");
  if (
    j.providerFingerprint &&
    j.providerFingerprint !== s.shopify.fingerprint()
  )
    throw new Error(
      "Shopify configuration changed; queue a new operation after reviewing the target store",
    );
  validateShopifyJob(s, j);
  await verify(s);
  if (j.type === "SHOPIFY_CONNECT") return true;
  if (j.type === "ORDER_SYNC") return false; // Existing validated order importer, after verified connection.
  if (j.type === "SHOPIFY_PRODUCT_IMPORT") {
    const rows = await importProducts(s.shopify);
    s.repo.transaction(() => {
      for (const row of rows) saveRemoteProduct(s, row);
      s.audit("SHOPIFY_PRODUCTS_IMPORTED", j.id, {
        count: rows.length,
        externalIds: rows.map((r) => r.id),
      });
    });
    return true;
  }
  let listing = s.repo.get("listings", String(j.payload.listingId));
  s.repo.put("listings", {
    ...listing,
    status: "SYNCING",
    updatedAt: new Date().toISOString(),
  });
  try {
    if (j.type === "STORE_SYNC") {
      if (!listing.externalId) {
        const externalId = await s.shopify.createProduct(listing);
        listing = { ...listing, externalId };
        s.repo.put("listings", listing);
      } else
        await s.shopify.updateProduct(
          listing.externalId,
          listing.title,
          listing.description,
        );
      const remote = await readProduct(s.shopify, listing.externalId!);
      if (
        remote.title !== listing.title ||
        remote.descriptionHtml !== listing.description
      )
        throw new Error(
          "Shopify product readback differs from requested content",
        );
      s.repo.transaction(() => {
        saveRemoteProduct(s, remote, listing);
        s.audit("SHOPIFY_PRODUCT_CONFIRMED", listing.id, {
          externalId: remote.id,
          title: remote.title,
        });
      });
      return true;
    }
    const remote = await readProduct(s.shopify, listing.externalId!);
    const variants = remoteVariants(remote),
      variant = variants.find((v) => v.id === j.payload.variantId);
    if (!variant)
      throw new Error("Variant no longer exists on this Shopify product");
    if (j.type === "SHOPIFY_PRICE_SYNC")
      await s.shopify.syncPrice(variant.id, remote.id, Number(j.payload.price));
    else {
      const location = variant.inventory.find(
        (l) => l.locationId === j.payload.locationId,
      );
      if (!location)
        throw new Error("Location is not associated with this inventory item");
      await setInventory(
        s.shopify,
        {
          inventoryItemId: variant.inventoryItemId,
          locationId: location.locationId,
          quantity: Number(j.payload.quantity),
          changeFromQuantity: Number(j.payload.changeFromQuantity),
        },
        j.id,
      );
    }
    const confirmed = await readProduct(s.shopify, remote.id),
      confirmedVariant = remoteVariants(confirmed).find(
        (v) => v.id === variant.id,
      )!;
    if (
      j.type === "SHOPIFY_PRICE_SYNC" &&
      confirmedVariant.price !== Number(j.payload.price)
    )
      throw new Error(
        "Shopify price readback did not confirm the requested value",
      );
    if (
      j.type === "SHOPIFY_INVENTORY_SYNC" &&
      confirmedVariant.inventory.find(
        (l) => l.locationId === j.payload.locationId,
      )?.quantity !== Number(j.payload.quantity)
    )
      throw new Error(
        "Shopify inventory readback did not confirm the requested value",
      );
    s.repo.transaction(() => {
      const saved = saveRemoteProduct(s, confirmed, listing);
      s.repo.put("listings", {
        ...saved,
        ...(j.type === "SHOPIFY_PRICE_SYNC"
          ? { priceSyncedAt: new Date().toISOString() }
          : { inventorySyncedAt: new Date().toISOString() }),
      });
      s.audit("SHOPIFY_SYNC_CONFIRMED", listing.id, {
        type: j.type,
        payload: j.payload,
        externalId: remote.id,
      });
    });
    return true;
  } catch (error) {
    s.repo.put("listings", {
      ...listing,
      status: "ERROR",
      error: error instanceof Error ? error.message : "Sync failed",
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
}
