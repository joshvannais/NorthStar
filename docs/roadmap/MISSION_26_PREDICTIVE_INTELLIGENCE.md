# Mission 26 — Predictive Business Intelligence

Objective: turn current authorized NorthStar facts and tenant-private Mission 25 learning into forward-looking operational forecasts that show their sources, coverage, confidence, uncertainty and limits. A prediction never becomes a fact, approved estimate, schedule, hiring decision, invoice, payment, policy or automated action.

Mission 26 is the contractor-facing predictive operating layer. It does not replace the separate investor forecast artifact, Mission 32's manual On-the-Fly Calculator, or Mission 33's private NorthStar platform analytics. Mission 20 retains business-profile and operating-policy authority; Mission 22 retains scheduling and dispatch; Mission 23 retains actual execution; Mission 24 retains estimates and customer-facing price; Mission 25 retains outcome learning; Mission 27 retains native invoices, payments and collections; Mission 28 retains automation and any authority to apply an advisory action.

The founder's [implementation-versus-live-validation clarification](../architecture/MISSION_26_IMPLEMENTATION_VS_LIVE_VALIDATION.md) keeps Mission 26 work moving with guarded synthetic evidence while public Retell calling and commercial legal review remain later gates. It does not waive any implementation acceptance check or permit a paid numerical forecast without complete, authorized, evaluated real history. The ephemeral homepage Web Call is not a retained demand-history source.

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

Part 3B's [rolling-origin backtest boundary](../architecture/MISSION_26_PART3B_ROLLING_BACKTESTS.md) is independently accepted and released as an unmounted internal contract. No saved forecast runs or authorized actual-outcome reader are yet mounted, so it does not claim production backtest or accuracy evidence.

Part 3C's [evaluation and calibration gates](../architecture/MISSION_26_PART3C_EVALUATION_GATES.md) are independently accepted and released as an unmounted descriptive-measurement contract. Descriptive error on synthetic inputs cannot claim empirical accuracy, calibrated confidence or production source authorization.

Part 3D's [algorithm identity and promotion governance](../architecture/MISSION_26_PART3D_ALGORITHM_GOVERNANCE.md) is independently accepted and released as an unmounted static candidate contract. The pure identity catalog does not register an executable algorithm, authenticate a comparison or promote/rollback a tenant's active selection.

## Part 4 — four demand and commercial slices

Part 4A's [inbound demand source and forecast boundary](../architecture/MISSION_26_PART4A_DEMAND_SOURCE_AND_FORECAST.md) is being implemented. Bounded unmounted candidates and a separate guarded Retell **call** source receipt are released. No production lead forecast is accepted. Retell call IDs deduplicate retries, not repeat calls about one lead. The source must prove reviewed distinct lead identity and complete coverage; heuristic service labels, customer addresses and unsaved historical inputs are not verified forecasts.

| Slice | Scope |
| --- | --- |
| A | Inbound lead-volume and requested-service-mix forecasts by supported time window and service area. |
| B | Qualification, estimate-request, booking and cancellation probability forecasts with source and uncertainty. |
| C | Seasonality, current backlog and pipeline-to-scheduled-work forecasts without treating customer intent as guaranteed work. |
| D | Paid and isolated-demo demand forecast UI, explanation, recovery and independent Part 4 acceptance. |

Part 4B's [transition-probability boundary](../architecture/MISSION_26_PART4B_TRANSITION_PROBABILITY_BOUNDARY.md) is a bounded unmounted descriptive candidate. It can be validated with fictional cohort data while real calling remains offline; it is not a paid probability forecast, source authentication or final Part 4B acceptance. No old setup calls are required to advance independent roadmap work.

Part 4C's [demand-to-schedule boundary](../architecture/MISSION_26_PART4C_DEMAND_TO_SCHEDULE_BOUNDARY.md) separates verified seasonality, current approved backlog and future pipeline transitions. It is architecture only; absent source coverage, approved-work linkage and calibrated outcomes keep numerical claims unavailable.

Part 4D has an interim Command Center availability state in the shared paid/demo surface. It distinguishes recorded activity from a forecast, marks demo leads as fictional, and offers a refresh recovery message when the workspace fails. It issues no forecast, does not turn current leads into a prediction, and is not final Part 4 acceptance; source-authorized forecasts, evaluated outputs and independent end-to-end evidence remain required.

## Part 5 — four workload and capacity slices

| Slice | Scope |
| --- | --- |
| A | Scheduled and unscheduled workload, required work hours and capacity forecasts. |
| B | Crew, skill, working-hours, location, travel, vehicle and equipment-constrained capacity forecasts. |
| C | Bottleneck, backlog, overtime, contractor and hiring-need advisories that never create a schedule, assignment or employment action. |
| D | Paid and isolated-demo capacity UI, explanation, recovery and independent Part 5 acceptance. |

Part 5A's [approved workload position boundary](../architecture/MISSION_26_PART5A_WORKLOAD_POSITION_BOUNDARY.md) has a bounded unmounted descriptive candidate. It separates scheduled and unscheduled remaining approved person-minutes and withholds totals for unresolved source or work status. It is neither an authenticated Mission 22/23 backlog reader nor a future workload or capacity forecast; final Part 5A acceptance remains open.

Part 5B's [dimension-scoped capacity prerequisite](../architecture/MISSION_26_PART5B_SCOPED_CAPACITY_BOUNDARY.md) has an unmounted additive output-shape candidate. It can carry exact role, crew, location, item, asset and operating-class identity without changing released output v1. It cannot authenticate owning sources, calculate capacity, issue a forecast or satisfy final Part 5B acceptance. Those gates remain open.

Part 5B also has a [declared role-time position diagnostic](../architecture/MISSION_26_PART5B_ROLE_TIME_POSITION.md). It calculates bounded overlap-free qualified person-minutes from caller-supplied working, availability, absence and commitment intervals but has no authenticated workforce/scheduling reader, travel/asset constraint proof or future forecast authority. Final Part 5B acceptance remains open.

Part 5B's [guarded declared-availability source](../architecture/MISSION_26_PART5B_DECLARED_AVAILABILITY_SOURCE.md) now reads current tenant roster, Business Profile hours, Mission 22 declared availability, and bounded approved scheduled-assignment intervals under existing scheduling access checks. Unapproved, unassigned and bounded schedule evidence withhold the source snapshot. It does not prove job-specific qualification, complete commitments or constrained capacity, and it is not mounted to a forecast. Final Part 5B acceptance remains open.

Part 5B's [company operating-window position](../architecture/MISSION_26_PART5B_OPERATING_WINDOWS.md) reuses Mission 22 time-zone rules to calculate bounded business-open minutes, including overnight and daylight-saving conditions. It is an unmounted descriptive calendar prerequisite, not worker availability or a capacity forecast.

Part 5B's [guarded operating-window bridge](../architecture/MISSION_26_PART5B_GUARDED_OPERATING_WINDOWS.md) binds that calculation to the current Mission 22-guarded Business Profile snapshot. The source is authenticated as a current read, but the exact historical cutoff, worker availability, qualifications and constrained-capacity gates remain open.

The guarded availability snapshot retains bounded Mission 22 worker skill keys and service associations from the same tenant snapshot. These are assigned records, not verified certifications or job-specific qualification. Mission 23 private certification evidence needs a separate guarded source interface before it can contribute to Part 5B.

Part 5B's [exact as-of source gate](../architecture/MISSION_26_PART5B_AS_OF_SOURCE_GATE.md) records why the guarded current MVCC snapshot and later observation clock cannot certify historical cutoff completeness. Existing revisions are useful inputs, but a source-owned visibility and coverage adapter remains required before numerical available-role capacity or backtested forecasts.

## Part 6 — four revenue and financial-boundary slices

| Slice | Scope |
| --- | --- |
| A | Authorized estimate, approved-price and booked-work revenue baselines with their commercial status retained. |
| B | Probability-weighted pipeline and forecast revenue ranges that keep estimates, booked work, earned revenue and collected cash distinct. |
| C | External financial evidence compatibility now and native invoice, payment, collection and cash forecasting only after Mission 27 supplies compatible authority. |
| D | Monthly revenue and pipeline KPI cards, graphs, drilldowns, paid/demo recovery and independent Part 6 acceptance. |

Part 6C's [financial evidence compatibility boundary](../architecture/MISSION_26_PART6C_FINANCIAL_EVIDENCE_COMPATIBILITY.md)
maps the released Mission 25 external observations to their safe Mission 26
uses. It does not issue earned-revenue or collected-cash forecasts. Native
financial records await Mission 27, and earned-revenue recognition still needs
an explicitly approved source authority.

Part 6D's [Executive Brief wording correction](../architecture/MISSION_26_PART6D_EXECUTIVE_WORDING_BOUNDARY.md)
removes revenue and confidence claims that its existing canonical summary
cannot substantiate. It is a bounded presentation correction; monthly
source-backed cards, graphs, drilldowns, recovery and Part 6 acceptance remain
open.

## Part 7 — five operating-cost, profit and margin slices

| Slice | Scope |
| --- | --- |
| A | Labor-cost forecasts from authorized rates, planned work, capacity and applicable learned outcomes. |
| B | Material, purchasing, inventory and waste-cost forecasts with vendor, availability, currency and valuation boundaries. |
| C | Vehicle, equipment, machinery, travel, fuel, maintenance and downtime-cost forecasts. |
| D | Overhead and financed-asset cash-commitment forecasts from exact owner-recorded schedules and allocation policy; no assumption that every job pays a monthly installment. |
| E | Operating-cost, forecast profit and margin ranges with monthly KPI cards, graphs, explanations, paid/demo recovery and independent Part 7 acceptance. |

Part 7A's [planned labor-cost prerequisite](../architecture/MISSION_26_PART7A_LABOR_COST_POSITION.md)
reuses Mission 24 labor-plan arithmetic under bounded claimed evidence. It
does not authenticate an as-of source, verify capacity, apply Mission 25
calibration or issue a paid forecast. Final Part 7A acceptance remains open.

Part 7B's [planned material-line cost prerequisite](../architecture/MISSION_26_PART7B_MATERIAL_COST_POSITION.md)
reuses Mission 24 material-plan quantities, waste and source-aware price and
availability records. It is unmounted claimed-input arithmetic, not verified
inventory, supplier availability, a complete purchasing cost or a forecast.
Final Part 7B acceptance remains open.

Part 7C's [equipment and travel cost boundary](../architecture/MISSION_26_PART7C_EQUIPMENT_TRAVEL_BOUNDARY.md)
preserves Mission 24's v3 composition and overlap decisions in a bounded
unmounted consistency diagnostic. It does not independently recalculate fuel,
maintenance, onsite use, transport or complete operating cost. Source
authentication and final Part 7C acceptance remain open.

Part 7D's [overhead and financed-asset cash source gate](../architecture/MISSION_26_PART7D_OVERHEAD_CASH_SOURCE_GATE.md)
distinguishes Mission 24 job allocation from dated company expense and debt
obligations. No complete owner-recorded obligation schedule exists in the
released source records inspected; a new source write authority requires
founder review where existing future authority does not explicitly cover it.
No numerical cash-commitment forecast or final Part 7D acceptance is claimed.

Part 7E's [operating profit integration gate](../architecture/MISSION_26_PART7E_OPERATING_PROFIT_INTEGRATION_GATE.md)
requires a source-authenticated adopted composition, compatible revenue and
overhead evidence, exact calendar attribution and preserved overlap before a
monthly number or chart can issue. The current A–D prerequisites do not meet
those conditions. Part 7 acceptance and its paid/demo visual journey remain open.

## Part 8 — four resource-risk slices

| Slice | Scope |
| --- | --- |
| A | Material demand, reorder timing, stockout and purchasing-risk forecasts. |
| B | Vehicle and equipment utilization, service interval, maintenance and downtime-risk forecasts. |
| C | Route load, mileage, fuel or energy use and logistics-capacity forecasts. |
| D | Paid and isolated-demo resource-risk UI, explanation, recovery and independent Part 8 acceptance. |

Part 8A has an [unmounted material demand position prerequisite](../architecture/MISSION_26_PART8A_MATERIAL_DEMAND_POSITION.md). It groups bounded caller-supplied planned quantities by exact material, location, unit and required time, but cannot verify approved-plan coverage, inventory, future receipts, reorder timing or stockout risk. Part 8A and Part 8 acceptance remain open.

Part 8B has an [unmounted claimed asset-meter position prerequisite](../architecture/MISSION_26_PART8B_ASSET_METER_POSITION.md). It can add bounded claimed operating hours to a matching hours meter and flag when the projected reading reaches a claimed absolute threshold. Asset/meter history, full approved-job coverage, maintenance due, downtime probability and final Part 8B acceptance remain open.

Part 8C has an [unmounted declared route-load prerequisite](../architecture/MISSION_26_PART8C_ROUTE_LOAD_POSITION.md). It reuses Mission 24 vehicle-leg counts to summarize caller-declared route distance by unit, while route verification, road-versus-onsite classification, fuel or energy, capacity, source authentication and final Part 8C acceptance remain open.

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
