import type { EconomicsInputs } from "./domain";
export function economics(i: EconomicsInputs) {
  for (const [k, v] of Object.entries(i))
    if (!Number.isFinite(v) || v < 0)
      throw new Error(`${k} must be finite and nonnegative`);
  const rate = i.paymentFeeRate + i.platformFeeRate;
  if (rate >= 1) throw new Error("Combined fee rate must be below 100%");
  const landedCost = i.productCost + i.shipping;
  const paymentFees = i.sellingPrice * i.paymentFeeRate + i.paymentFeeFixed;
  const platformFees = i.sellingPrice * i.platformFeeRate;
  const nonAdCosts =
    landedCost +
    paymentFees +
    platformFees +
    i.returnsAllowance +
    i.otherVariableCosts;
  const variableCost = nonAdCosts + i.advertisingCost;
  const contributionProfit = i.sellingPrice - variableCost;
  return {
    revenue: i.sellingPrice,
    landedCost,
    paymentFees,
    platformFees,
    variableCost,
    grossProfit: i.sellingPrice - landedCost,
    grossMargin: i.sellingPrice
      ? (i.sellingPrice - landedCost) / i.sellingPrice
      : null,
    contributionProfit,
    contributionMargin: i.sellingPrice
      ? contributionProfit / i.sellingPrice
      : null,
    breakEvenSellingPrice:
      (landedCost +
        i.paymentFeeFixed +
        i.advertisingCost +
        i.returnsAllowance +
        i.otherVariableCosts) /
      (1 - rate),
    maximumAllowableAcquisitionCost: i.sellingPrice - nonAdCosts,
  };
}
