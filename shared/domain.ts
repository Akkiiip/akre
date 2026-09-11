export type ID = string;
export type DataMode = "DEMO" | "LIVE";
export type ConnectionStatus =
  | "DEMO"
  | "LIVE"
  | "CONNECTED"
  | "NOT CONFIGURED"
  | "ERROR"
  | "UNVERIFIED"
  | "SYNCING"
  | "SYNCED"
  | "STALE";
export const lifecycles = [
  "DISCOVERED",
  "SHORTLISTED",
  "APPROVED",
  "TESTING",
  "WINNER",
  "SCALING",
  "KILLED",
  "ARCHIVED",
] as const;
export type Lifecycle = (typeof lifecycles)[number];
export interface Entity {
  id: ID;
  workspaceId: ID;
  createdAt: string;
  updatedAt: string;
  mode: DataMode;
}
export interface User extends Entity {
  email: string;
  name: string;
  role: "OWNER" | "ANALYST";
}
export interface Workspace extends Entity {
  name: string;
  currency: string;
}
export interface Product extends Entity {
  canonicalName?: string;
  aliases?: string[];
  sourceReferences?: string[];
  firstSeen?: string;
  lastSeen?: string;
  name: string;
  category: string;
  identityKey: string;
  lifecycle: Lifecycle;
  supplierIds: ID[];
}
export const factors = [
  "trendAcceleration",
  "demandStrength",
  "novelty",
  "contentPotential",
  "competition",
  "priceAttractiveness",
  "shippingSuitability",
  "marginPotential",
  "supplierAvailability",
  "marketFit",
  "saturationRisk",
] as const;
export type Factor = (typeof factors)[number];
export type ScoringInputs = Partial<Record<Factor, number | null>>;
export interface ScoreComponent {
  factor: Factor;
  input: number | null;
  score: number | null;
  weight: number;
  explanation: string;
}
export interface ScoreResult {
  version: string;
  score: number | null;
  confidence: number;
  components: ScoreComponent[];
  positive: string[];
  negative: string[];
  missing: Factor[];
}
export interface ProductOpportunity extends Entity {
  scoreVersion?: string;
  scoredAt?: string;
  productId: ID;
  sourceIds: ID[];
  signalIds: ID[];
  inputs: ScoringInputs;
  scoring: ScoreResult;
  sellingPrice: number | null;
  costId: ID | null;
}
export interface TrendSource extends Entity {
  name: string;
  provider: string;
  reference: string | null;
  status: ConnectionStatus;
}
export interface SourceObservation extends Entity {
  region?: string;
  signalType?: string;
  signalValue?: number;
  confidence?: number;
  fetchedAt?: string;
  providerVersion?: string;
  sourceUrl?: string;
  sourceId: ID;
  externalId: string;
  productName: string;
  category: string;
  observedAt: string;
  reference: string | null;
  payload: Record<string, unknown>;
}
export interface TrendSignal extends Entity {
  validUntil?: string;
  evidence?: Record<string, unknown>;
  productId: ID;
  sourceId: ID;
  observationId: ID;
  factor: Factor;
  rawValue: number;
  normalizedValue: number;
  unit: string;
  observedAt: string;
  normalizationVersion: string;
}
export interface Supplier extends Entity {
  name: string;
  region: string;
  reference: string | null;
  confidence: number | null;
}
export interface SupplierOffer extends Entity {
  source?: string;
  sku?: string;
  supplierId: ID;
  productId: ID;
  variantId: ID | null;
  moq: number;
  unitCost: number;
  shippingCost: number | null;
  deliveryDays: number | null;
  region: string;
  stockStatus: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  rating: number | null;
  reference: string | null;
  lastChecked: string;
  currency: string;
}
export interface ProductVariant extends Entity {
  productId: ID;
  sku: string;
  attributes: Record<string, string>;
}
export interface EconomicsInputs {
  sellingPrice: number;
  productCost: number;
  shipping: number;
  paymentFeeRate: number;
  paymentFeeFixed: number;
  platformFeeRate: number;
  advertisingCost: number;
  returnsAllowance: number;
  otherVariableCosts: number;
}
export interface ProductCost extends Entity {
  productId: ID;
  supplierOfferId: ID | null;
  currency: string;
  assumptions: EconomicsInputs;
}
export interface Store extends Entity {
  name: string;
  provider: "shopify";
  status: ConnectionStatus;
  domain: string | null;
}
export interface StoreProduct extends Entity {
  remoteVariants?: {
    id: string;
    sku: string;
    price: number;
    inventoryItemId: string;
    inventory: { locationId: string; locationName: string; quantity: number }[];
  }[];
  remoteStatus?: string;
  priceSyncedAt?: string;
  inventorySyncedAt?: string;
  storeId: ID;
  productId: ID;
  externalId: string | null;
  title: string;
  description: string;
  price: number;
  status: "DRAFT" | "SYNCING" | "SYNCED" | "ERROR";
  publishedAt: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}
export interface ContentAsset extends Entity {
  productId: ID;
  type:
    | "HOOK"
    | "VIDEO"
    | "UGC"
    | "REELS"
    | "CAPTION"
    | "AD_ANGLE"
    | "BRIEF"
    | "VARIANT";
  title: string;
  body: string;
  status: "DRAFT" | "APPROVED" | "PUBLISHED";
  externalPublicationId: string | null;
}
export interface ExperimentCriteria {
  minImpressions: number;
  minClicks: number;
  minPurchases: number;
  maxSpend: number;
  targetRoas: number;
  minContributionProfit: number;
}
export interface Experiment extends Entity {
  productId: ID;
  channel: string;
  sellingPrice: number;
  creativeId: ID;
  budget: number;
  startDate: string;
  endDate: string;
  successCriteria: ExperimentCriteria;
  killCriteria: { maxLoss: number };
  status: "DRAFT" | "RUNNING" | "COMPLETED";
  costSnapshot: EconomicsInputs;
}
export interface ExperimentMetric extends Entity {
  experimentId: ID;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  addToCart: number;
  checkout: number;
  purchases: number;
  revenue: number;
  reference: string;
}
export interface Order extends Entity {
  storeId: ID;
  externalId: string;
  orderedAt: string;
  currency: string;
  revenue: number;
  refunds: number;
  variableCosts: number | null;
  acquisitionCost: number | null;
  customerId: string | null;
}
export interface OrderItem extends Entity {
  orderId: ID;
  productId: ID;
  variantId: ID | null;
  quantity: number;
  revenue: number;
  costSnapshot: EconomicsInputs | null;
}
export interface RevenueMetric extends Entity {
  date: string;
  revenue: number;
  orders: number;
  adSpend: number | null;
  sessions: number | null;
  newCustomers: number | null;
}
export interface ProfitMetric extends Entity {
  date: string;
  contributionProfit: number | null;
  contributionMargin: number | null;
  assumptions: string[];
}
export type Verdict = "SCALE" | "WATCH" | "KILL" | "INSUFFICIENT DATA";
export interface Decision extends Entity {
  productId: ID;
  experimentId: ID | null;
  verdict: Verdict;
  reasons: string[];
  scoringVersion: string;
  evidence: Record<string, unknown>;
}
export interface Integration extends Entity {
  verifiedAt?: string;
  fingerprint?: string;
  detail?: Record<string, unknown>;
  provider: string;
  status: ConnectionStatus;
  lastSyncedAt: string | null;
  error: string | null;
}
export const jobTypes = [
  "SHOPIFY_CONNECT",
  "SHOPIFY_PRODUCT_IMPORT",
  "SHOPIFY_PRICE_SYNC",
  "SHOPIFY_INVENTORY_SYNC",
  "TREND_INGESTION",
  "PRODUCT_DISCOVERY",
  "SUPPLIER_REFRESH",
  "ECONOMICS_RECALCULATION",
  "STORE_SYNC",
  "ORDER_SYNC",
  "EXPERIMENT_EVALUATION",
  "WINNER_DETECTION",
] as const;
export type JobType = (typeof jobTypes)[number];
export interface SyncJob extends Entity {
  providerFingerprint?: string;
  type: JobType;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "ERROR";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  retryCount: number;
  source: string;
  payload: Record<string, unknown>;
  requestedBy: string;
}
export interface AuditEvent extends Entity {
  actorId: string;
  action: string;
  entityId: ID;
  evidence: Record<string, unknown>;
}
export interface ScoreSnapshot extends Entity {
  productId: ID;
  opportunityId: ID;
  reason: string;
  scoreVersion: string;
  inputs: ScoringInputs;
  scoring: ScoreResult;
  signalIds: ID[];
  evidence: Record<string, unknown>;
}
export interface Dataset {
  scoreHistory: ScoreSnapshot[];
  connections: Integration[];
  products: Product[];
  opportunities: ProductOpportunity[];
  sources: TrendSource[];
  observations: SourceObservation[];
  signals: TrendSignal[];
  suppliers: Supplier[];
  offers: SupplierOffer[];
  variants: ProductVariant[];
  costs: ProductCost[];
  stores: Store[];
  listings: StoreProduct[];
  assets: ContentAsset[];
  experiments: Experiment[];
  metrics: ExperimentMetric[];
  orders: Order[];
  orderItems: OrderItem[];
  decisions: Decision[];
  jobs: SyncJob[];
  audit: AuditEvent[];
}
