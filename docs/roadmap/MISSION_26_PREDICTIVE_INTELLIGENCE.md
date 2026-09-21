# Mission 26 — Predictive Business Intelligence

Objective: turn current authorized NorthStar facts and tenant-private Mission 25 learning into forward-looking operational forecasts that show their sources, coverage, confidence, uncertainty and limits. A prediction never becomes a fact, approved estimate, schedule, hiring decision, invoice, payment, policy or automated action.

Mission 26 is the contractor-facing predictive operating layer. It does not replace the separate investor forecast artifact, Mission 32's manual On-the-Fly Calculator, or Mission 33's private NorthStar platform analytics. Mission 20 retains business-profile and operating-policy authority; Mission 22 retains scheduling and dispatch; Mission 23 retains actual execution; Mission 24 retains estimates and customer-facing price; Mission 25 retains outcome learning; Mission 27 retains native invoices, payments and collections; Mission 28 retains automation and any authority to apply an advisory action.

## Frozen implementation structure — 12 parts and 51 slices

The part and slice counts are frozen before Mission 26 implementation begins. A later change requires a documented authority or acceptance reason, the affected gates and an updated total before implementation proceeds.

| Part | Scope | Slices |
| --- | --- | ---: |
| 1 | Forecast authority, source readiness and prediction contract | 3 |
| 2 | As-of source snapshots and forecast feature lineage | 4 |
| 3 | Backtesting, calibration, drift and algorithm registry | 4 |
| 4 | Demand, lead, booking and service-mix forecasts | 4 |
| 5 | Workload, capacity, workforce and bottleneck forecasts | 4 |
| 6 | Revenue, pipeline and financial-authority forecasts | 4 |
| 7 | Operating cost, profit and margin forecasts | 5 |
| 8 | Materials, assets, maintenance, travel and logistics forecasts | 4 |
| 9 | Probability ranges, forecast scenarios, sensitivity and risk | 5 |
| 10 | Forecast Command Center, KPI cards, graphs and explanations | 4 |
| 11 | Forecast governance, versioning and explicit handoffs | 4 |
| 12 | Complete paid/demo experience and mission acceptance | 6 |

## Part 1 — three authority and contract slices

| Slice | Scope |
| --- | --- |
| A | Mission authority map, live source inventory and forecast-readiness matrix across Missions 20-25 and authorized external sources. |
| B | Canonical forecast-output contract: as-of time, horizon, target, units, currency, point estimate or range, confidence, uncertainty, evidence coverage, applicability and calculation version. |
| C | Tenant, role, privacy, audit and demo-isolation architecture with the rule that predictions remain advisory and cannot mutate an owning authority. |

Part 1A's [forecast authority and live-source readiness inventory](../architecture/MISSION_26_PART1A_SOURCE_READINESS.md) is independently accepted and released as architecture only. It does not complete Parts 1B-C or authorize a runtime forecast.

Part 1B's [forecast output contract](../architecture/MISSION_26_PART1B_FORECAST_OUTPUT_CONTRACT.md) is independently accepted and released as an internal shape only. It does not create an as-of snapshot, calibrate an interval, mount a forecast route, or complete Part 1C.

Part 1C's [forecast governance architecture](../architecture/MISSION_26_PART1C_FORECAST_GOVERNANCE.md) is independently accepted and released. It defines future tenant, role, privacy, audit and fictional-demo gates; it adds no runtime permission or route.

## Part 2 — four as-of data and feature slices

| Slice | Scope |
| --- | --- |
| A | Immutable as-of source snapshots that prevent future information from leaking into a historical forecast or backtest. |
| B | Time-series normalization for business calendars, time zones, service areas, reporting periods and comparable observation windows. |
| C | Versioned feature definitions with explicit known, missing, stale, conflicting and inapplicable states plus exact units and currency. |
| D | Correction, revocation, tombstone, retention and deletion propagation with bounded replay, restart and recovery. |

Part 2A's [immutable as-of source capture](../architecture/MISSION_26_PART2A_AS_OF_SNAPSHOTS.md) is independently accepted and released as a bounded approved-estimate decision source. It does not supply other source kinds, historical backtests or a forecast. Part 2B's [reporting-window contract](../architecture/MISSION_26_PART2B_TIME_SERIES_WINDOWS.md), Part 2C's [versioned feature-definition contract](../architecture/MISSION_26_PART2C_FEATURE_DEFINITIONS.md), and Part 2D's [bounded current-source lineage contract](../architecture/MISSION_26_PART2D_LINEAGE_RECOVERY.md) are independently accepted and released as internal projections. Part 2D covers only the registered Mission 24 decision source; it does not implement other import lifecycles, saved forecast runs or unattended recovery.

## Part 3 — four evaluation and model-governance slices

| Slice | Scope |
| --- | --- |
| A | Exact forecast targets, outcome windows and eligibility rules for every forecast family. |
| B | Rolling backtests that compare saved forecasts with later authorized actual outcomes without rewriting either record. |
| C | Error, interval coverage, calibration, drift, sample sufficiency and applicability measurements with unavailable states for weak evidence. |
| D | Versioned deterministic/statistical algorithm registry, candidate-versus-current evaluation, human-reviewed promotion and recoverable rollback. |

Part 3A's [target and outcome eligibility catalog](../architecture/MISSION_26_PART3A_TARGET_OUTCOMES.md) is independently accepted and released as architecture only. It does not activate a source reader, historical outcome, forecast, backtest or probability.

Part 3B's [rolling-origin backtest boundary](../architecture/MISSION_26_PART3B_ROLLING_BACKTESTS.md) is a design candidate. No saved forecast runs or authorized actual-outcome reader are yet mounted, so it does not claim production backtest or accuracy evidence.

## Part 4 — four demand and commercial slices

| Slice | Scope |
| --- | --- |
| A | Inbound lead-volume and requested-service-mix forecasts by supported time window and service area. |
| B | Qualification, estimate-request, booking and cancellation probability forecasts with source and uncertainty. |
| C | Seasonality, current backlog and pipeline-to-scheduled-work forecasts without treating customer intent as guaranteed work. |
| D | Paid and isolated-demo demand forecast UI, explanation, recovery and independent Part 4 acceptance. |

## Part 5 — four workload and capacity slices

| Slice | Scope |
| --- | --- |
| A | Scheduled and unscheduled workload, required work hours and capacity forecasts. |
| B | Crew, skill, working-hours, location, travel, vehicle and equipment-constrained capacity forecasts. |
| C | Bottleneck, backlog, overtime, contractor and hiring-need advisories that never create a schedule, assignment or employment action. |
| D | Paid and isolated-demo capacity UI, explanation, recovery and independent Part 5 acceptance. |

## Part 6 — four revenue and financial-boundary slices

| Slice | Scope |
| --- | --- |
| A | Authorized estimate, approved-price and booked-work revenue baselines with their commercial status retained. |
| B | Probability-weighted pipeline and forecast revenue ranges that keep estimates, booked work, earned revenue and collected cash distinct. |
| C | External financial evidence compatibility now and native invoice, payment, collection and cash forecasting only after Mission 27 supplies compatible authority. |
| D | Monthly revenue and pipeline KPI cards, graphs, drilldowns, paid/demo recovery and independent Part 6 acceptance. |

## Part 7 — five operating-cost, profit and margin slices

| Slice | Scope |
| --- | --- |
| A | Labor-cost forecasts from authorized rates, planned work, capacity and applicable learned outcomes. |
| B | Material, purchasing, inventory and waste-cost forecasts with vendor, availability, currency and valuation boundaries. |
| C | Vehicle, equipment, machinery, travel, fuel, maintenance and downtime-cost forecasts. |
| D | Overhead and financed-asset cash-commitment forecasts from exact owner-recorded schedules and allocation policy; no assumption that every job pays a monthly installment. |
| E | Operating-cost, forecast profit and margin ranges with monthly KPI cards, graphs, explanations, paid/demo recovery and independent Part 7 acceptance. |

## Part 8 — four resource-risk slices

| Slice | Scope |
| --- | --- |
| A | Material demand, reorder timing, stockout and purchasing-risk forecasts. |
| B | Vehicle and equipment utilization, service interval, maintenance and downtime-risk forecasts. |
| C | Route load, mileage, fuel or energy use and logistics-capacity forecasts. |
| D | Paid and isolated-demo resource-risk UI, explanation, recovery and independent Part 8 acceptance. |

## Part 9 — five uncertainty, scenario and sensitivity slices

| Slice | Scope |
| --- | --- |
| A | Reproducible deterministic baseline forecasts from one exact configuration and source snapshot. |
| B | Calibrated probability distributions and P10/P50/P90 ranges only where backtest evidence supports them. |
| C | Named forecast scenarios with explicit assumptions and provenance; they remain forecast variations rather than alternative facts. |
| D | Sensitivity, reverse-sensitivity and binding-constraint analysis that returns unavailable when the requested target is unsupported or impossible. |
| E | Paid and isolated-demo risk-range UI, explanation, recovery and independent Part 9 acceptance. |

## Part 10 — four Forecast Command Center slices

| Slice | Scope |
| --- | --- |
| A | Weekly, monthly and quarterly forecast timelines with current-versus-prior-versus-actual comparison. |
| B | Monthly revenue, operating cost, profit, margin, demand and capacity KPI cards and graphs from the same forecast run. |
| C | Drilldowns showing source coverage, assumptions, confidence, uncertainty, stale inputs, forecast error and why a value changed. |
| D | Owner-visible alerts, recommended next moves, exportable evidence and complete paid/demo Command Center behavior without automatic action. |

## Part 11 — four forecast-governance and handoff slices

| Slice | Scope |
| --- | --- |
| A | Owner forecast settings, horizons and policies with explicit defaults, versioning and validation. |
| B | Immutable forecast runs, freeze, compare, supersede and reproducible rerun behavior. |
| C | Correction, revocation, deletion and algorithm-version propagation through saved forecasts and displayed advice. |
| D | Explicit reviewed handoffs to the owning Mission 20, 22, 24, 27, 28 or 32 workflow; Mission 26 never applies the change itself. |

## Part 12 — six mission-acceptance slices

| Slice | Scope |
| --- | --- |
| A | Complete paid-tenant source-to-forecast-to-explanation-to-reviewed-handoff journey. |
| B | Complete resettable fictional demo journey with strict paid/demo isolation. |
| C | Migration, restart, replay, concurrency, performance, bounds, failure recovery and operational-observability proof. |
| D | Mission-wide accessibility, keyboard, responsive, light/dark theme and five-layout-per-page review. |
| E | Independent exact-head authority, privacy, security, mathematical, data-quality and regression audit. |
| F | Normal merge, deployment, production health, founder visual verdict and final Mission 26 acceptance. |

## Non-negotiable evidence boundaries

- A forecast carries its as-of source snapshot, algorithm version, evidence coverage and uncertainty. It is never displayed as a known future fact.
- Actual records remain owned by their source mission. Backtesting appends evaluation evidence and never edits the original forecast or actual.
- Missing financial, workforce, asset or operating-policy authority remains unavailable rather than silently becoming zero or an industry average.
- Tenant-private features, forecasts, prices, workforce information and outcomes never cross tenants. Demo data never contributes to paid forecasts.
- Confidence is not price accuracy, safety certification, customer intent, employee performance or legal/tax advice.
- Mission 26 may recommend a reviewed next step. Mission 28 owns any later automatic execution.
