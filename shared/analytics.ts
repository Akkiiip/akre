import type { Order, ExperimentMetric } from "./domain";
export function analytics(
  orders: Order[],
  metrics: ExperimentMetric[],
  from: string,
  to: string,
) {
  const selected = orders.filter(
    (o) => o.orderedAt.slice(0, 10) >= from && o.orderedAt.slice(0, 10) <= to,
  );
  const days = [
    ...new Set([
      ...selected.map((o) => o.orderedAt.slice(0, 10)),
      ...metrics
        .filter((m) => m.date >= from && m.date <= to)
        .map((m) => m.date),
    ]),
  ].sort();
  const series = days.map((date) => {
    const os = selected.filter((o) => o.orderedAt.slice(0, 10) === date);
    const ms = metrics.filter((m) => m.date === date);
    const revenue = os.reduce((n, o) => n + o.revenue - o.refunds, 0);
    const adSpend = ms.length ? ms.reduce((n, m) => n + m.spend, 0) : null;
    const costsKnown =
      os.length > 0 &&
      os.every((o) => o.variableCosts !== null) &&
      adSpend !== null;
    return {
      date,
      revenue,
      orders: os.length,
      adSpend,
      contributionProfit: costsKnown
        ? revenue - os.reduce((n, o) => n + o.variableCosts!, 0) - adSpend!
        : null,
    };
  });
  const revenue = series.reduce((n, s) => n + s.revenue, 0),
    adSpend =
      series.length && series.every((s) => s.adSpend !== null)
        ? series.reduce((n, s) => n + s.adSpend!, 0)
        : null;
  const contributionProfit =
    series.length && series.every((s) => s.contributionProfit !== null)
      ? series.reduce((n, s) => n + s.contributionProfit!, 0)
      : null;
  return {
    series,
    revenue,
    orders: selected.length,
    adSpend,
    contributionProfit,
    margin:
      revenue && contributionProfit !== null
        ? contributionProfit / revenue
        : null,
    roas: adSpend ? revenue / adSpend : null,
    aov: selected.length ? revenue / selected.length : null,
    cac: null,
    conversionRate: null,
  };
}
