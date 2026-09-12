import { createHash } from "node:crypto";
import { z } from "zod";

export type SupplierCatalog = {
  id: string;
  name: string;
  region: string;
  categories: string[];
  capabilities: string[];
  evidence: {
    reviewSource: string;
    reviewSummary: string;
    rating?: number;
    reviewCount?: number;
  };
  integration: "API" | "FEED" | "MANUAL" | "SHOPIFY";
  status: "RESEARCHED" | "CONNECTED";
  sourceUrl: string;
};

export const supplierCatalogs: SupplierCatalog[] = [
  {
    id: "vfulfill",
    name: "vFulfill",
    region: "India",
    categories: ["general", "home", "beauty", "gadgets", "fashion"],
    capabilities: ["product research", "sourcing", "COD", "fulfillment", "Shopify"],
    evidence: {
      reviewSource: "Shopify App Store",
      reviewSummary: "4.7/5 from 11 reviews; 10 five-star and 1 one-star review.",
      rating: 4.7,
      reviewCount: 11,
    },
    integration: "SHOPIFY",
    status: "RESEARCHED",
    sourceUrl: "https://apps.shopify.com/vfulfill-cod-dropshipping/reviews",
  },
  {
    id: "qikink",
    name: "Qikink",
    region: "India",
    categories: ["print-on-demand", "fashion", "accessories"],
    capabilities: ["zero inventory", "printing", "branding", "COD", "fulfillment"],
    evidence: {
      reviewSource: "Qikink published operating metrics",
      reviewSummary: "Claims 25,000+ sellers and 7M+ orders shipped since 2016.",
    },
    integration: "API",
    status: "RESEARCHED",
    sourceUrl: "https://qikink.com/dropshipping-india/",
  },
  {
    id: "wholesalebox",
    name: "WholesaleBox",
    region: "India",
    categories: ["fashion", "women", "wholesale"],
    capabilities: ["dropshipping", "single-order fulfillment", "product feed", "API subject to approval"],
    evidence: {
      reviewSource: "Official dropshipper program",
      reviewSummary: "Offers dropshipping; product feed/API access is subject to store, sales and traffic criteria.",
    },
    integration: "FEED",
    status: "RESEARCHED",
    sourceUrl: "https://www.wholesalebox.in/dropshipper",
  },
  {
    id: "seasonsway",
    name: "Seasonsway",
    region: "India",
    categories: ["fashion", "women", "kids", "men"],
    capabilities: ["5000+ references", "inventory", "dropshipping", "API", "auto inventory updates"],
    evidence: {
      reviewSource: "Official dropshipping documentation",
      reviewSummary: "Documents KYC onboarding, direct delivery, API integration and automated inventory updates.",
    },
    integration: "API",
    status: "RESEARCHED",
    sourceUrl: "https://www.seasonsway.com/india/dropshipping-india.php",
  },
];

export const supplierCatalogSearchInput = z.object({
  query: z.string().trim().min(1).max(100),
  category: z.string().trim().max(100).optional(),
}).strict();

export function searchSupplierCatalogs(input: z.infer<typeof supplierCatalogSearchInput>) {
  const q = input.query.toLocaleLowerCase("en-IN");
  const category = input.category?.toLocaleLowerCase("en-IN");
  return supplierCatalogs
    .filter((supplier) => {
      const haystack = [supplier.name, ...supplier.categories, ...supplier.capabilities].join(" ").toLocaleLowerCase("en-IN");
      return haystack.includes(q) || !q;
    })
    .filter((supplier) => !category || supplier.categories.includes(category))
    .map((supplier) => ({
      ...supplier,
      matchId: createHash("sha256").update(`${supplier.id}:${q}:${category ?? ""}`).digest("hex").slice(0, 16),
    }));
}
