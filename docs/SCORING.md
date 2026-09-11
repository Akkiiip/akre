# Explainable scoring and decisions

## IMPLEMENTED: akre-score/1.0.0

Every input is normalized to 0–100 before scoring. Invalid/nonfinite/out-of-range values are rejected. Competition and saturation risk are inverse factors: their component score is `100 − input`. All other factors retain their input. Missing values remain null.

| Factor                | Weight |
| --------------------- | -----: |
| Trend acceleration    |     15 |
| Demand strength       |     15 |
| Novelty               |      8 |
| Content potential     |     10 |
| Competition           |      8 |
| Price attractiveness  |      6 |
| Shipping suitability  |      7 |
| Margin potential      |     12 |
| Supplier availability |      7 |
| Market fit            |      7 |
| Saturation risk       |      5 |

Weights total 100. Evidence coverage = sum of available component weights. AKRE score = rounded weighted sum / available weights **only if coverage >=60 and demand strength plus trend acceleration are present**; otherwise Insufficient data. This prevents absent inputs from becoming zeros or implausibly high recommendations from one factor. Coverage is shown as confidence, explicitly described as coverage rather than statistical certainty. Source reliability and freshness are inspectable but not yet calibrated into confidence; calibration is PLANNED.

Positive explanations list component scores >=70; negative explanations list scores <50; all missing factors are shown separately. Components retain input, transformed score, weight and explanation. No language model changes scores. Margin potential is a separately sourced normalized input, not silently derived from unit economics; cost edits do not rewrite evidence scores.

## Normalization: akre-normalization/1.0.0

`clamp((value − min) / (max − min) × 100, 0, 100)` with finite bounds and max > min. Raw values/bounds/unit/source stay in the observation payload. The service stores a normalized signal per measurement and links it to its raw observation. Latest observation per source/factor wins; independent sources are equally averaged. Changing assumptions requires a new source observation/version. Google/YouTube data is not automatically interpreted as commerce demand. The six DEMO products have explicitly synthetic normalized fixtures for exercising the scoring engine.

## Contribution economics

All inputs are per order, in INR; selling price is net of collected taxes. Shipping includes allocated freight and duties. Return/refund allowance is an expected per-order variable loss; do not double-count a refund already excluded from revenue.

```
landed cost = product cost + shipping
payment fees = price × payment fee rate + fixed payment fee
platform fees = price × platform fee rate
variable cost = landed cost + payment fees + platform fees
                + advertising + returns allowance + other variable costs
gross profit = price − landed cost
gross margin = gross profit / price
contribution profit = price − variable cost
contribution margin = contribution profit / price
break-even price = (landed cost + fixed payment fee + advertising
                    + returns allowance + other costs)
                   / (1 − payment fee rate − platform fee rate)
maximum allowable CAC = price − all non-ad variable costs
```

All amounts must be finite/nonnegative and combined percentage fees <1. At zero revenue, margins are null. Negative profit and negative maximum CAC remain negative rather than being clamped into favorable results. Gross margin is not net profit. Fixed business overhead and taxes are outside contribution economics. Engines preserve precision until display.

## Experiment evaluation

Saved criteria define traffic minimums, purchase minimums, spend guardrail, target ROAS, minimum contribution profit and maximum loss. Actual metric spend replaces the cost model's ad allowance. Actual average recorded revenue per purchase determines percentage fees. The model uses the experiment's frozen cost assumptions, not today's catalogue estimate.

1. No metrics or insufficient impressions/clicks → INSUFFICIENT DATA.
2. Adequate traffic and contribution loss >= maximum loss, or spend >= max spend with ROAS below target → KILL.
3. Purchase count below minimum → INSUFFICIENT DATA.
4. Sufficient purchases, ROAS >= target and contribution >= target → SCALE.
5. Otherwise → WATCH.

CTR = clicks / impressions, CPC = spend / clicks, CVR = purchases / clicks, ROAS = revenue / spend. Zero denominators yield null. Daily metric inputs enforce a sequential funnel and experiment date bounds. These rules are deterministic operating guardrails, not a statistical significance claim. Recommendations never launch or stop external campaigns automatically.

Each persisted Decision includes the metrics, saved criteria, cost snapshot, score version, reasons and evaluation timestamp. Unit tests cover exact weighting, inverse factors, missing inputs, normalization, identity grouping, lifecycle restrictions, break-even equations, negative/zero economics, and all four decision outcomes.

## Live-workflow hardening

Wikimedia attention acceleration uses three complete seven-day windows. The change between successive weekly growth percentages is normalized from -100 to 100 into 0–100. Gaps or zero baselines produce no signal. This populates trendAcceleration only, never demandStrength. Signals expire after seven days. Model akre-score/1.0.0 has frozen registered weights; ingestion preserves the existing version. Explicit current-model recalculation appends a new immutable snapshot without modifying prior inputs, components or evidence. Air fryer therefore has a null AKRE score despite real pageview observations.
