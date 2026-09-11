import type {
  Dataset,
  Entity,
  Factor,
  Product,
  DataMode,
} from "../shared/domain";
import { scoreOpportunity } from "../shared/scoring";
import { identityKey, NORMALIZATION_VERSION } from "../shared/discovery";
export const emptyDataset = (): Dataset => ({
  scoreHistory: [],
  connections: [],
  products: [],
  opportunities: [],
  sources: [],
  observations: [],
  signals: [],
  suppliers: [],
  offers: [],
  variants: [],
  costs: [],
  stores: [],
  listings: [],
  assets: [],
  experiments: [],
  metrics: [],
  orders: [],
  orderItems: [],
  decisions: [],
  jobs: [],
  audit: [],
});
export function seed(mode: DataMode): Dataset {
  const d = emptyDataset();
  if (mode === "LIVE") return d;
  const at = "2026-09-01T00:00:00.000Z";
  const base = (id: string): Entity => ({
    id,
    workspaceId: "default",
    createdAt: at,
    updatedAt: at,
    mode: "DEMO",
  });
  d.sources.push({
    ...base("demo-source"),
    name: "Preserved MVP fixture",
    provider: "demo",
    reference: null,
    status: "DEMO",
  });
  const rows: [
    string,
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ][] = [
    [
      "Portable Pet Water Bottle",
      "Pet",
      "Dropship Hub",
      94,
      89,
      210,
      65,
      699,
      130,
      45,
      14,
    ],
    [
      "Heatless Curling Ribbon Set",
      "Beauty",
      "StyleSource",
      91,
      93,
      160,
      55,
      599,
      115,
      40,
      12,
    ],
    [
      "Car Seat Gap Organizer",
      "Automotive",
      "AutoSupply",
      88,
      82,
      180,
      70,
      649,
      120,
      55,
      13,
    ],
    [
      "Self-Cleaning Pet Grooming Brush",
      "Pet",
      "Dropship Hub",
      87,
      86,
      220,
      65,
      799,
      145,
      60,
      16,
    ],
    [
      "Foldable Travel Organizer",
      "Travel",
      "TravelCart",
      84,
      88,
      190,
      65,
      699,
      135,
      50,
      14,
    ],
    [
      "Silicone Kitchen Cleaning Tool",
      "Kitchen",
      "HomeDrop",
      81,
      84,
      80,
      50,
      349,
      85,
      25,
      7,
    ],
  ];
  rows.forEach(
    (
      [
        name,
        category,
        supplier,
        contentPotential,
        demandStrength,
        productCost,
        shipping,
        sellingPrice,
        advertisingCost,
        returnsAllowance,
        paymentFeeFixed,
      ],
      i,
    ) => {
      const id = `product-${i + 1}`,
        supplierId = identityKey(supplier).replaceAll(" ", "-");
      const p: Product = {
        ...base(id),
        name,
        category,
        identityKey: identityKey(name),
        lifecycle: "DISCOVERED",
        supplierIds: [supplierId],
      };
      d.products.push(p);
      if (!d.suppliers.some((s) => s.id === supplierId))
        d.suppliers.push({
          ...base(supplierId),
          name: supplier,
          region: "India (demo assumption)",
          reference: null,
          confidence: null,
        });
      d.offers.push({
        ...base(`offer-${id}`),
        productId: id,
        supplierId,
        variantId: null,
        moq: 1,
        unitCost: productCost,
        shippingCost: shipping,
        deliveryDays: null,
        region: "India",
        stockStatus: "UNKNOWN",
        rating: null,
        reference: null,
        lastChecked: at,
        currency: "INR",
      });
      d.costs.push({
        ...base(`cost-${id}`),
        productId: id,
        supplierOfferId: `offer-${id}`,
        currency: "INR",
        assumptions: {
          sellingPrice,
          productCost,
          shipping,
          paymentFeeRate: 0,
          paymentFeeFixed,
          platformFeeRate: 0,
          advertisingCost,
          returnsAllowance,
          otherVariableCosts: 0,
        },
      });
      const inputs = {
        contentPotential,
        demandStrength,
        trendAcceleration: 90 - i * 5,
        shippingSuitability: 80,
        marginPotential: 70,
        marketFit: 80,
      };
      d.observations.push({
        ...base(`observation-${id}`),
        sourceId: "demo-source",
        externalId: id,
        productName: name,
        category,
        observedAt: at,
        reference: null,
        payload: {
          notice:
            "Synthetic normalized scoring inputs for demonstration only; not measured market evidence",
          ...inputs,
        },
      });
      Object.entries(inputs).forEach(([factor, value]) =>
        d.signals.push({
          ...base(`signal-${id}-${factor}`),
          productId: id,
          sourceId: "demo-source",
          observationId: `observation-${id}`,
          factor: factor as Factor,
          rawValue: value,
          normalizedValue: value,
          unit: "demo index / 100",
          observedAt: at,
          normalizationVersion: NORMALIZATION_VERSION,
        }),
      );
      d.opportunities.push({
        ...base(`opportunity-${id}`),
        productId: id,
        sourceIds: ["demo-source"],
        signalIds: d.signals.filter((s) => s.productId === id).map((s) => s.id),
        inputs,
        scoring: scoreOpportunity(inputs),
        sellingPrice,
        costId: `cost-${id}`,
      });
    },
  );
  return d;
}
