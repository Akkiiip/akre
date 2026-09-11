import type { Experiment, ExperimentMetric, Verdict } from "./domain";
import { economics } from "./economics";
export function experimentMetrics(
  experiment: Experiment,
  rows: ExperimentMetric[],
) {
  const t = rows
    .filter((m) => m.experimentId === experiment.id)
    .reduce(
      (a, m) => ({
        spend: a.spend + m.spend,
        impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks,
        addToCart: a.addToCart + m.addToCart,
        checkout: a.checkout + m.checkout,
        purchases: a.purchases + m.purchases,
        revenue: a.revenue + m.revenue,
      }),
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        addToCart: 0,
        checkout: 0,
        purchases: 0,
        revenue: 0,
      },
    );
  const e = economics({
    ...experiment.costSnapshot,
    sellingPrice: t.purchases
      ? t.revenue / t.purchases
      : experiment.sellingPrice,
    advertisingCost: 0,
  });
  return {
    ...t,
    ctr: t.impressions ? t.clicks / t.impressions : null,
    cpc: t.clicks ? t.spend / t.clicks : null,
    conversionRate: t.clicks ? t.purchases / t.clicks : null,
    roas: t.spend ? t.revenue / t.spend : null,
    contributionProfit: t.revenue - e.variableCost * t.purchases - t.spend,
  };
}
export function evaluateExperiment(
  experiment: Experiment,
  rows: ExperimentMetric[],
): {
  verdict: Verdict;
  reasons: string[];
  metrics: ReturnType<typeof experimentMetrics>;
} {
  const m = experimentMetrics(experiment, rows),
    c = experiment.successCriteria;
  if (
    !rows.some((r) => r.experimentId === experiment.id) ||
    m.impressions < c.minImpressions ||
    m.clicks < c.minClicks
  )
    return {
      verdict: "INSUFFICIENT DATA",
      reasons: [
        `Need at least ${c.minImpressions} impressions and ${c.minClicks} clicks.`,
      ],
      metrics: m,
    };
  if (
    m.contributionProfit <= -experiment.killCriteria.maxLoss ||
    (m.spend >= c.maxSpend && (m.roas ?? 0) < c.targetRoas)
  )
    return {
      verdict: "KILL",
      reasons: ["Adequate traffic sample; loss or spend guardrail breached."],
      metrics: m,
    };
  if (m.purchases < c.minPurchases)
    return {
      verdict: "INSUFFICIENT DATA",
      reasons: [
        `Need ${c.minPurchases} purchases to assess scale; guardrails have not been breached.`,
      ],
      metrics: m,
    };
  if (
    m.roas !== null &&
    m.roas >= c.targetRoas &&
    m.contributionProfit >= c.minContributionProfit
  )
    return {
      verdict: "SCALE",
      reasons: [
        "Purchase sample, ROAS and contribution profit meet the saved success criteria.",
      ],
      metrics: m,
    };
  return {
    verdict: "WATCH",
    reasons: [
      "Adequate sample; success criteria not met and loss guardrails not breached.",
    ],
    metrics: m,
  };
}
