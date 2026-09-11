import { createHash } from "node:crypto";
import { z } from "zod";
import { setInventory } from "./shopify-api";
import type {
  SourceObservation,
  SupplierOffer,
  StoreProduct,
  Order,
  ConnectionStatus,
} from "../shared/domain";
export interface Provider {
  id: string;
  status(): ConnectionStatus;
}
export interface TrendProvider extends Provider {
  observe(query: string): Promise<SourceObservation[]>;
}
export interface ProductDiscoveryProvider extends Provider {
  discover(query: string): Promise<SourceObservation[]>;
}
export interface SupplierProvider extends Provider {
  offers(productId: string): Promise<SupplierOffer[]>;
}
export interface AnalyticsProvider extends Provider {
  orders(since: string): Promise<Order[]>;
}
export interface StoreProvider extends Provider {
  createProduct(product: StoreProduct): Promise<string>;
  updateProduct(id: string, title: string, description: string): Promise<void>;
  publishProduct(id: string, publicationId: string): Promise<void>;
  unpublishProduct(id: string, publicationId: string): Promise<void>;
  syncInventory(
    inventoryItemId: string,
    locationId: string,
    quantity: number,
    changeFromQuantity: number,
    idempotencyKey: string,
  ): Promise<void>;
  syncPrice(variantId: string, productId: string, price: number): Promise<void>;
  syncOrders(since: string): Promise<unknown[]>;
}
export class NotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider}: NOT CONFIGURED`);
  }
}
export class ShopifyProvider implements StoreProvider {
  id = "shopify";
  constructor(
    private config: { shop?: string; token?: string; version?: string },
  ) {}
  status(): ConnectionStatus {
    return this.config.shop && this.config.token
      ? "UNVERIFIED"
      : "NOT CONFIGURED";
  }
  fingerprint() {
    return createHash("sha256")
      .update(JSON.stringify(this.config))
      .digest("hex");
  }
  async testConnection() {
    const result = await this.graphql<unknown>(
      "query{shop{id name myshopifyDomain currencyCode plan{partnerDevelopment}}}",
      {},
    );
    return z
      .object({
        shop: z.object({
          id: z.string().min(1),
          name: z.string(),
          myshopifyDomain: z.string(),
          currencyCode: z.literal("INR"),
          plan: z.object({ partnerDevelopment: z.literal(true) }),
        }),
      })
      .parse(result).shop;
  }
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    if (this.status() === "NOT CONFIGURED")
      throw new NotConfiguredError("Shopify");
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(this.config.shop!))
      throw new Error("Invalid Shopify shop domain");
    if (!/^\d{4}-(01|04|07|10)$/.test(this.config.version ?? ""))
      throw new Error("Shopify API version is required");
    const response = await fetch(
      `https://${this.config.shop}/admin/api/${this.config.version}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.config.token!,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error(`Shopify HTTP ${response.status}`);
    const result = (await response.json()) as { data: T; errors?: unknown[] };
    if (result.errors?.length || !result.data)
      throw new Error("Shopify rejected the GraphQL request");
    for (const value of Object.values(result.data as object))
      if (
        value &&
        typeof value === "object" &&
        "userErrors" in value &&
        (value.userErrors as unknown[])?.length
      )
        throw new Error(
          "Shopify rejected the operation; check input and granted scopes",
        );
    return result.data;
  }
  async createProduct(p: StoreProduct) {
    const d = await this.graphql<{
      productCreate: { product: { id: string } | null };
    }>(
      "mutation($product:ProductCreateInput!){productCreate(product:$product){product{id} userErrors{field message}}}",
      {
        product: {
          title: p.title,
          descriptionHtml: p.description,
          status: "DRAFT",
        },
      },
    );
    if (!d.productCreate.product?.id)
      throw new Error("Shopify returned no product ID");
    return d.productCreate.product.id;
  }
  async updateProduct(id: string, title: string, description: string) {
    await this.graphql(
      "mutation($product:ProductUpdateInput!){productUpdate(product:$product){product{id} userErrors{message}}}",
      { product: { id, title, descriptionHtml: description } },
    );
  }
  async publishProduct(id: string, publicationId: string) {
    await this.graphql(
      "mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){userErrors{message}}}",
      { id, input: [{ publicationId }] },
    );
  }
  async unpublishProduct(id: string, publicationId: string) {
    await this.graphql(
      "mutation($id:ID!,$input:[PublicationInput!]!){publishableUnpublish(id:$id,input:$input){userErrors{message}}}",
      { id, input: [{ publicationId }] },
    );
  }
  async syncInventory(
    inventoryItemId: string,
    locationId: string,
    quantity: number,
    changeFromQuantity: number,
    idempotencyKey: string,
  ) {
    await setInventory(
      this,
      { inventoryItemId, locationId, quantity, changeFromQuantity },
      idempotencyKey,
    );
  }
  async syncPrice(variantId: string, productId: string, price: number) {
    await this.graphql(
      "mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$productId,variants:$variants){userErrors{message}}}",
      { productId, variants: [{ id: variantId, price: String(price) }] },
    );
  }
  async syncOrders(since: string) {
    let cursor: string | null = null;
    const orders: unknown[] = [];
    const seen = new Set<string>();
    do {
      const d: {
        orders: {
          nodes: unknown[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      } = await this.graphql(
        "query($q:String!,$cursor:String){orders(first:100,after:$cursor,query:$q){nodes{id createdAt currencyCode currentTotalPriceSet{shopMoney{amount currencyCode}} currentTotalTaxSet{shopMoney{amount}} totalRefundedSet{shopMoney{amount}}} pageInfo{hasNextPage endCursor}}}",
        { q: `updated_at:>=${since}`, cursor },
      );
      z.object({
        orders: z.object({
          nodes: z.array(z.unknown()),
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
        }),
      }).parse(d);
      if (d.orders.pageInfo.hasNextPage) {
        const next = d.orders.pageInfo.endCursor;
        if (!next || seen.has(next))
          throw new Error("Shopify returned invalid order pagination");
        seen.add(next);
      }
      orders.push(...d.orders.nodes);
      cursor = d.orders.pageInfo.hasNextPage
        ? d.orders.pageInfo.endCursor
        : null;
    } while (cursor);
    return orders;
  }
}
// Official YouTube Data API. Video popularity is retained raw and is NOT treated as purchasing demand.
export class YouTubeProvider
  implements TrendProvider, ProductDiscoveryProvider
{
  id = "youtube";
  constructor(private key?: string) {}
  status(): ConnectionStatus {
    return this.key ? "CONNECTED" : "NOT CONFIGURED";
  }
  async discover(query: string) {
    return this.observe(query);
  }
  async observe(query: string): Promise<SourceObservation[]> {
    if (!this.key) throw new NotConfiguredError("YouTube");
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    Object.entries({
      key: this.key,
      part: "snippet",
      q: query,
      type: "video",
      maxResults: "25",
      order: "date",
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
    const body = (await response.json()) as {
      items: {
        id: { videoId: string };
        snippet: { title: string; publishedAt: string };
      }[];
    };
    const at = new Date().toISOString();
    return body.items.map((item) => ({
      id: `youtube-${item.id.videoId}`,
      workspaceId: "default",
      createdAt: at,
      updatedAt: at,
      mode: "LIVE",
      sourceId: "youtube",
      externalId: item.id.videoId,
      productName: query,
      category: "Unclassified",
      observedAt: at,
      reference: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      payload: {
        ...item.snippet,
        query,
        notice: "Raw search observation; no demand inference",
      },
    }));
  }
}
