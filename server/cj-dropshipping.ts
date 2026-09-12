import { z } from "zod";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
const tokenCache = new Map<string, { accessToken: string; refreshToken: string; expiresAt: number }>();

export const cjSearchInput = z.object({
  keyword: z.string().trim().min(2).max(200),
  countryCode: z.string().regex(/^[A-Z]{2}$/).default("IN"),
  page: z.number().int().min(1).max(10).default(1),
  size: z.number().int().min(1).max(50).default(20),
}).strict();
export type CjSearchInput = z.infer<typeof cjSearchInput>;

export type CjProduct = {
  id: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  sellPriceUsd: number | null;
  inventory: number | null;
  verifiedInventory: number | null;
  deliveryCycle: string | null;
  listedCount: number | null;
  category: string | null;
  saleStatus: string | null;
  sourceUrl: string;
};

function apiKey() {
  const key = process.env.CJ_API_KEY?.trim();
  if (!key) throw new Error("CJ Dropshipping is NOT CONFIGURED: add CJ_API_KEY to the server environment");
  return key;
}

async function parseJson(response: Response) {
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { throw new Error(`CJ API returned non-JSON response (${response.status})`); }
  if (!response.ok || body?.success === false || body?.code && body.code !== 200) {
    throw new Error(`CJ API error: ${body?.message || response.statusText || response.status}`);
  }
  return body;
}

async function getToken(): Promise<string> {
  const key = apiKey();
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;
  const response = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: key }),
  });
  const body = await parseJson(response);
  const data = body?.data;
  if (!data?.accessToken) throw new Error("CJ API authentication succeeded without an access token");
  tokenCache.set(key, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? "",
    expiresAt: Date.parse(data.accessTokenExpiryDate ?? "") || Date.now() + 14 * 86400_000,
  });
  return data.accessToken;
}

export async function searchCjProducts(input: CjSearchInput): Promise<{ products: CjProduct[]; total: number; requestId: string | null }> {
  const token = await getToken();
  const params = new URLSearchParams({
    page: String(input.page),
    size: String(input.size),
    keyWord: input.keyword,
    countryCode: input.countryCode,
    features: "enable_category",
    sort: "desc",
    orderBy: "0",
  });
  const response = await fetch(`${CJ_BASE}/product/listV2?${params.toString()}`, {
    headers: { "CJ-Access-Token": token },
  });
  const body = await parseJson(response);
  const data = body?.data ?? {};
  const groups = Array.isArray(data.content) ? data.content : [];
  const raw = groups.flatMap((group: any) => Array.isArray(group?.productList) ? group.productList : []);
  const products: CjProduct[] = raw.map((p: any) => ({
    id: String(p.id),
    name: String(p.nameEn || p.name || "Unnamed CJ product"),
    sku: p.sku || p.spu || null,
    imageUrl: p.bigImage || null,
    sellPriceUsd: Number.isFinite(Number(p.discountPrice ?? p.nowPrice ?? p.sellPrice)) ? Number(p.discountPrice ?? p.nowPrice ?? p.sellPrice) : null,
    inventory: Number.isFinite(Number(p.warehouseInventoryNum)) ? Number(p.warehouseInventoryNum) : null,
    verifiedInventory: Number.isFinite(Number(p.totalVerifiedInventory)) ? Number(p.totalVerifiedInventory) : null,
    deliveryCycle: p.deliveryCycle == null ? null : String(p.deliveryCycle),
    listedCount: Number.isFinite(Number(p.listedNum)) ? Number(p.listedNum) : null,
    category: p.threeCategoryName || p.categoryName || null,
    saleStatus: p.saleStatus == null ? null : String(p.saleStatus),
    sourceUrl: `https://cjdropshipping.com/product/${encodeURIComponent(String(p.id))}.html`,
  }));
  return { products, total: Number(data.totalRecords ?? products.length), requestId: body?.requestId ?? null };
}

export function cjIntegrationStatus() {
  return {
    provider: "cj-dropshipping",
    configured: Boolean(process.env.CJ_API_KEY?.trim()),
    capabilities: ["SUPPLIER", "PRICE", "SHIPPING", "STOCK"],
    evidence: "REAL_CJ_CATALOG",
    note: "Catalog and inventory evidence come from CJ Dropshipping. Purchase demand is not inferred from supplier availability.",
  };
}
