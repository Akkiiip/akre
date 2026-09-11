import type { Experiment, ExperimentMetric } from "./domain";
import { experimentMetrics } from "./experiments";
export function experimentAnalytics(
  experiments: Experiment[],
  metrics: ExperimentMetric[],
  from: string,
  to: string,
) {
  const rows = metrics.filter((m) => m.date >= from && m.date <= to),
    totals = {
      spend: 0,
      revenue: 0,
      purchases: 0,
      clicks: 0,
      contributionProfit: 0,
    };
  for (const e of experiments) {
    const m = experimentMetrics(e, rows);
    for (const key of Object.keys(totals) as (keyof typeof totals)[])
      totals[key] += m[key];
  }
  return {
    ...totals,
    hasMetrics: rows.length > 0,
    roas: totals.spend ? totals.revenue / totals.spend : null,
    conversionRate: totals.clicks ? totals.purchases / totals.clicks : null,
    margin: totals.revenue ? totals.contributionProfit / totals.revenue : null,
  };
}
