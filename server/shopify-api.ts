import { z } from "zod";
import type { ShopifyProvider } from "./providers";
const gid = z.string().regex(/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/);
const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable().optional(),
});
const variant = z.object({
  id: gid,
  sku: z.string().nullable(),
  price: z.string().regex(/^\d+(\.\d+)?$/),
  inventoryItem: z.object({
    id: gid,
    inventoryLevels: z.object({
      nodes: z.array(
        z.object({
          location: z.object({ id: gid, name: z.string() }),
          quantities: z.array(
            z.object({ name: z.string(), quantity: z.number().int() }),
          ),
        }),
      ),
      pageInfo,
    }),
  }),
});
export const productSchema = z.object({
  id: gid,
  title: z.string().min(1),
  productType: z.string(),
  descriptionHtml: z.string(),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
  variants: z.object({ nodes: z.array(variant), pageInfo }),
});
export type RemoteProduct = z.infer<typeof productSchema>;
const fields =
  'id title productType descriptionHtml status variants(first:100){nodes{id sku price inventoryItem{id inventoryLevels(first:50){nodes{location{id name} quantities(names:["available"]){name quantity}} pageInfo{hasNextPage}}}} pageInfo{hasNextPage}}';
export function validateProduct(raw: unknown) {
  const product = productSchema.parse(raw);
  if (
    product.variants.pageInfo.hasNextPage ||
    product.variants.nodes.some(
      (v) => v.inventoryItem.inventoryLevels.pageInfo.hasNextPage,
    )
  )
    throw new Error(
      "Product exceeds import capacity (100 variants / 50 locations); no partial import was saved",
    );
  return product;
}
export async function importProducts(provider: ShopifyProvider) {
  let cursor: string | null = null;
  const products: RemoteProduct[] = [];
  const seen = new Set<string>();
  do {
    const response: unknown = await provider.graphql<unknown>(
      `query($cursor:String){products(first:50,after:$cursor){nodes{${fields}} pageInfo{hasNextPage endCursor}}}`,
      { cursor },
    );
    const page: { nodes: unknown[]; pageInfo: z.infer<typeof pageInfo> } = z
      .object({ products: z.object({ nodes: z.array(z.unknown()), pageInfo }) })
      .parse(response).products;
    products.push(...page.nodes.map(validateProduct));
    if (page.pageInfo.hasNextPage) {
      const next: string | null | undefined = page.pageInfo.endCursor;
      if (!next || seen.has(next))
        throw new Error(
          "Shopify returned a missing or repeated pagination cursor",
        );
      seen.add(next);
      cursor = next;
    } else cursor = null;
  } while (cursor);
  return products;
}
export async function readProduct(provider: ShopifyProvider, id: string) {
  const response = await provider.graphql<{ product: unknown }>(
    `query($id:ID!){product(id:$id){${fields}}}`,
    { id },
  );
  return validateProduct(response.product);
}
export function remoteVariants(product: RemoteProduct) {
  return product.variants.nodes.map((v) => ({
    id: v.id,
    sku: v.sku ?? "",
    price: Number(v.price),
    inventoryItemId: v.inventoryItem.id,
    inventory: v.inventoryItem.inventoryLevels.nodes.map((level) => {
      const available = level.quantities.find((q) => q.name === "available");
      if (!available) throw new Error("Shopify omitted available inventory");
      return {
        locationId: level.location.id,
        locationName: level.location.name,
        quantity: available.quantity,
      };
    }),
  }));
}
export async function setInventory(
  provider: ShopifyProvider,
  input: {
    inventoryItemId: string;
    locationId: string;
    quantity: number;
    changeFromQuantity: number;
  },
  key: string,
) {
  const response = await provider.graphql<unknown>(
    "mutation($input:InventorySetQuantitiesInput!,$key:String!){inventorySetQuantities(input:$input) @idempotent(key:$key){inventoryAdjustmentGroup{changes{name quantityAfterChange}} userErrors{code field message}}}",
    {
      key,
      input: { name: "available", reason: "correction", quantities: [input] },
    },
  );
  z.object({
    inventorySetQuantities: z.object({
      inventoryAdjustmentGroup: z.object({
        changes: z.array(
          z.object({
            name: z.string(),
            quantityAfterChange: z.number().nullable(),
          }),
        ),
      }),
    }),
  }).parse(response);
}
