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

Part 2A's [immutable as-of source capture](../architecture/MISSION_26_PART2A_AS_OF_SNAPSHOTS.md) is independently accepted and released for the scoped NorthStar Mission 24 `pipeline.approved_estimates` authority. Its target-complete v2 path freezes a migration-fenced coverage epoch, the genuine tenant decision order and the exact active approved-estimate cutoff; later approval, correction or withdrawal makes the receipt stale, and any ordering gap leaves coverage unavailable. Exact head `cd931a2e63b2b3582dd18b8ef1b1090783bf7e34` passed 20 focused checks, genuinely independent exact-head audit and fresh GitHub review with no P0-P3 findings; PR #409 merged as `20bec05c49e69235a584fe22139017de2bf17c37`, and Railway deployment `7fa732f3-b33e-4492-bc4e-0151d098f84e` applied only migration 211 with dependencies ready, HTTP 200, healthy persistence and public render verified. This scoped acceptance does not reconstruct uncertain pre-epoch history, supply other targets or source kinds, prove provider/off-platform/whole-business coverage, establish natural outcomes or calibration, run a historical backtest, issue a forecast or enable paid numeric forecast serving.

Part 2B's [reporting-window contract](../architecture/MISSION_26_PART2B_TIME_SERIES_WINDOWS.md) is independently accepted and released for two completed comparable local months over the selected NorthStar Mission 24 approved-estimate decision source. Migration 212 combines migration 211's exact coverage epoch and genuine tenant decision order with a prospective Business Profile anchor, same-tenant writer fences and an immutable bounded exact-cutoff receipt. It pins the same authenticated profile, calendar, time zone and explicit scope across both windows, normalizes elapsed and open minutes, accepts complete selected-source zero, and reports later Mission 24 or profile changes as stale. Exact head `250c2c5b340535918941bc9bd20938595d1adf4f` passed 16 suites/75 tests, final mounted authority evidence 8/8, genuinely independent exact-head audit and fresh GitHub review with no P0-P3 findings; PR #411 merged as `09a977943e97c365246cf182f16e6e4dcf3ab2c5`, and Railway deployment `292b5345-1863-4801-a9b5-d75b1d15e93d` applied only migration 212 with dependencies ready, HTTP 200, healthy persistence and public render verified. The scoped acceptance deliberately withholds `profile_area` observation coverage because Mission 24 decisions have no verified area attribution. It does not claim provider/off-platform/whole-business coverage, arbitrary old-cutoff reconstruction, uncertain pre-epoch history, natural outcomes, calibration, forecast issuance or paid numeric forecast serving.

Part 2C's [versioned feature-definition contract](../architecture/MISSION_26_PART2C_FEATURE_DEFINITIONS.md) and [guarded approved-estimate stock authority](../architecture/MISSION_26_PART2C_GUARDED_APPROVED_ESTIMATE_STOCK.md) are independently accepted and released for registered `pipeline.approved_estimate_stock` values over migration 211's exact post-installation NorthStar Mission 24 receipt. Exact head `b4076143e4447ebe97ac5cd1c4d41442dc1ca6af` passed 7 focused suites/37 tests, fresh full-migration PostgreSQL through 212, genuinely independent exact-head audit and fresh clean GitHub review; PR #413 merged as `33d020194ad03457cca98529c5e5a5b96f9ca08f`, and Railway deployment `b5be44c7-fdd6-4e8b-8840-d870b516afec` ran no migration beyond 212 with dependencies ready, HTTP 200, healthy persistence and public render verified. Authenticated complete zero is distinct from missing evidence; stale values are withheld; the v2 contract binds source counts to the registered active-decision value. This scoped acceptance does not cover other targets or source kinds, broader pipeline or conversion semantics, provider/off-platform/whole-business coverage, arbitrary pre-epoch history, natural outcomes, calibration, forecast issuance or paid numeric forecast serving.

Part 2D's [bounded current-source lineage contract](../architecture/MISSION_26_PART2D_LINEAGE_RECOVERY.md) is independently accepted and released for bounded replay and explicit restart over the registered Mission 24 approved-estimate source. Migration 213 accepts one to 100 tenant-owned immutable migration 211 snapshot IDs, returns at most 25 per page, binds continuations to the exact ordered request and current source generation under the genuine tenant writer fence, and validates the complete requested set before returning any page. Later approval, correction or withdrawal invalidates an old cursor; explicit restart withholds stale amounts. Exact head `f75d3e450231193ec44135f39b04103fa56ec32a` passed 8 focused suites/31 tests including fresh full-migration PostgreSQL through 213, genuinely independent exact-head audit and fresh clean GitHub review with no P0-P3 findings; PR #415 merged as `61f6e5d230ec128a75dd900c496054127b88519d`, and Railway deployment `e8045bba-4404-4070-bfa5-acb8b0eab683` applied only migration 213 with PostgreSQL, Retell and Twilio ready, HTTP 200, healthy database and canonical persistence, and public Command Center render verified. This scoped acceptance does not cover other targets or source kinds, provider/off-platform/whole-business coverage, arbitrary old cutoffs, uncertain pre-epoch history, Mission 24 retention-expiry or legal-deletion events, saved forecast runs, durable worker checkpoints, unattended recovery, natural outcomes, calibration, forecast issuance or paid numeric forecast serving.

## Part 3 — four evaluation and model-governance slices

| Slice | Scope |
| --- | --- |
| A | Exact forecast targets, outcome windows and eligibility rules for every forecast family. |
| B | Rolling backtests that compare saved forecasts with later authorized actual outcomes without rewriting either record. |
| C | Error, interval coverage, calibration, drift, sample sufficiency and applicability measurements with unavailable states for weak evidence. |
| D | Versioned deterministic/statistical algorithm registry, candidate-versus-current evaluation, human-reviewed promotion and recoverable rollback. |

Part 3A's [target and outcome eligibility catalog](../architecture/MISSION_26_PART3A_TARGET_OUTCOMES.md) is independently accepted and released as architecture only. It does not activate a source reader, historical outcome, forecast, backtest or probability.

Part 3B's [rolling-origin backtest boundary](../architecture/MISSION_26_PART3B_ROLLING_BACKTESTS.md) is independently accepted and released for a bounded server-selected trailing 60-day registered NorthStar M24 saved-origin evidence receipt. Migration 214 persists the complete one-to-100-origin inventory with no caller-selected origins, truncation or supplied evidence; pins paired, missing, revoked and excluded denominators plus private immutable actual-generation identities; and makes correction, withdrawal, profile, source or newly completed origin changes stale. A table-boundary tenant inventory fence and final fenced re-read prevent partial-population persistence. Exact head `4e96eb4e510aee79c404fa11f0c7fcf9120619c0` passed 8 focused suites/40 tests including fresh full-migration PostgreSQL through 214 and migration 213-to-214 rolling upgrade, genuinely independent exact-head audit and fresh clean GitHub review with no P0-P3 findings. PR #417 merged as `fc7a049aa73864c13740f8058e02b97677cc0b10`; Railway deployment `3b9bff67-7f33-47b8-9f72-57628634600b` applied only migration 214 with PostgreSQL, Retell and Twilio ready, HTTP 200, healthy database and canonical persistence, and public Command Center render verified. Guarded fictional PostgreSQL evidence establishes this scoped implementation behavior, not natural production history, provider/off-platform/whole-business completeness, unsaved-origin coverage, empirical accuracy, calibration, drift verdicts, forecast issuance or real paid numeric serving.

Part 3C's [evaluation and calibration gates](../architecture/MISSION_26_PART3C_EVALUATION_GATES.md) are independently accepted and released for a purpose-fixed read-only measurement over one exact current immutable migration 214 complete-window receipt. Migration 215 binds authenticated target/version, unit/currency, fixed NorthStar M24 source applicability, algorithm/calculation identity, exact 60-day window and horizon, recency, observation lag and excluded conditions; missing or changed context fails closed. Additive migration 216 ensures descriptive drift rules and human-review actions appear only when that same cohort is sample-supported and both nonoverlapping halves contain exactly 30 paired outcomes. Additive migration 217 binds the authenticated tenant `organizationId` into the signed result and deterministic digest while leaving migrations 215-216 immutable. The read returns aggregate descriptive error and registered-origin denominators, fixed source-specific sufficiency, point-only interval and calibration unavailable states, no empirical drift verdict, and no individual forecast or actual values. Initial head `9fe9b4b2206496f56d73f834a9a1f7334cec87ce` shipped through PR #419 as `47e2748e628876183d9ecfdc49c774007e772795`; its GitHub/post-release review found the drift-action gate P2. Correction head `7290c45828222d28e9b9a9f16b173aa25363cff9` passed 8 suites/29 tests, independent audit and fresh clean GitHub review; PR #420 merged as `e06a37eec367914e087f3ac8f487cdf648e800c9`, and Railway deployment `1d46a0c7-f20b-45a7-89ce-7c15ddb79153` applied only migration 216. The first acceptance-refresh review then found the tenant-identity P2, so PR #421 was closed without merge. Identity-correction head `b8ff5817f278287f4ffef117916132976e853364` passed 8 focused suites/31 tests including fresh PostgreSQL through 217 and migration 216-to-217 rolling upgrade, genuinely independent audit and fresh clean GitHub review. PR #422 merged as `4b18031d71b493f1523fdaf2d2c06044eec64816`; Railway deployment `844d30d6-80c2-4913-8b42-2245efda9dff` applied only migration 217 with PostgreSQL, Retell and Twilio ready, HTTP 200, healthy database and canonical persistence, and public Command Center render verified. Guarded fictional evidence establishes the corrected scoped implementation contract, not natural production history, provider/off-platform/whole-business or unsaved-origin coverage, empirical accuracy, real calibration, empirical drift verdicts, forecast issuance or paid numeric serving.

Part 3D's [algorithm identity and promotion governance](../architecture/MISSION_26_PART3D_ALGORITHM_GOVERNANCE.md) is independently accepted and released for bounded deterministic internal-experiment review, promote and rollback events over the complete server-selected migration 214 population and current tenant-bound migration 217 measurement. Migration 218 binds exact target, source, profile, horizon, unit, currency, method/dependency and paired/missing/revoked/excluded population identities, with append-only human decisions and currentness checks. Its first post-release refresh PR #425 was closed unmerged after GitHub review found that the receipt lacked candidate-versus-current error measures. Additive migration 219 leaves migration 218 immutable and binds paired-origin mean absolute errors, better/equal/worse counts, comparison direction and `human_review_required_no_automatic_winner` plus their digest into the immutable review and selection. Exact correction head `b844696d85d3ff1dc0b223f525fc30aedd6a5c96` passed six focused suites/31 tests through migration 219, genuinely independent audit and fresh clean GitHub review; PR #426 merged as `63d7f8206e62f8841a949adf198aed71af4503cc`, and Railway deployment `1c71b8c6-4741-469e-af2e-68f2a821e675` applied only migration 219 with healthy dependencies, HTTP 200 persistence and public render verified. Every result remains ineligible for production promotion, paid numeric serving and real forecasting, and fictional evidence establishes neither empirical fitness, natural production history, real calibration nor an empirical drift verdict.

## Part 4 — four demand and commercial slices

Part 4A's [inbound demand source and forecast boundary](../architecture/MISSION_26_PART4A_DEMAND_SOURCE_AND_FORECAST.md) is independently accepted and released for a bounded Retell-only completed-period authority and genuinely future-facing private research origin. Migration 220 server-selects three fully completed tenant-local months; requires current company permission, complete reviewed dispositions, exact Business Profile month pins, matching bounded provider scans and explicit owner attestations; supports authenticated complete zero; and pins integration, agent, source, review, scan and certification identity. The next-month `demand.inbound_leads.v1` research origin binds those three months but withholds its numeric amount and output digest. Exact head `cee5696688cfc8c9cb01c12069928af5961fcaae` passed nine focused suites/58 tests through migration 220 and a genuinely independent exact-head audit with no P0-P3 findings. PR #428 merged as `8e82d54f04b846ad6e83fee9b9c11cfd28f1f980`; Railway deployment `4f5fa9e0-6313-40c2-ba59-0dca2b84e751` applied only migration 220 with PostgreSQL, Retell and Twilio ready, HTTP 200 healthy persistence and public render verified. Owner attestations are not independent legal/provider verification, and the receipt remains research-only with real forecasting and paid numeric serving disabled. Other channels, whole-business completeness, requested-service mix, service-area demand, natural production history, calibration and public forecast issuance remain unavailable.

| Slice | Scope |
| --- | --- |
| A | Inbound lead-volume and requested-service-mix forecasts by supported time window and service area. |
| B | Qualification, estimate-request, booking and cancellation probability forecasts with source and uncertainty. |
| C | Seasonality, current backlog and pipeline-to-scheduled-work forecasts without treating customer intent as guaranteed work. |
| D | Paid and isolated-demo demand forecast UI, explanation, recovery and independent Part 4 acceptance. |

Part 4B's [transition-probability boundary](../architecture/MISSION_26_PART4B_TRANSITION_PROBABILITY_BOUNDARY.md) now separates five guarded source-owned histories. The owner-reviewed commercial-withdrawal cohort remains a narrow commercial diagnostic. The booking-cancellation cohort authenticates bounded history from immutable Mission 22 human approvals. The first-booking cohort combines that schedule history with new canonical lead, Retell or voice graph completions that receive a separate post-commit visibility activation; it does not backfill legacy opportunities. Explicit operational cancellations count while reschedules do not, first accepted bookings count once, later entrants are excluded and uncertain legacy schedule lineage fails closed. The human-reviewed lead authority records versioned open/qualified/unqualified/closed state, corrections and explicit source finalization, then freezes an ended-horizon `demand.qualification_transition.v1` cohort. A separate human-reviewed estimate-request authority records open/requested/withdrawn/closed state, corrections and explicit source finalization, then freezes an ended-horizon `demand.estimate_request_transition.v1` cohort without accepting caller intent, AI suggestions, preliminary estimates or issued quotes as proof. These paths can be validated with fictional mounted PostgreSQL data while real calling remains offline. They are descriptive internal evidence, not calibrated paid probability forecasts or final Part 4B acceptance. Complete business history, natural evidence, calibration and saved forecast runs remain unavailable, and no old setup calls are required to advance independent roadmap work.

Part 4C's [demand-to-schedule boundary](../architecture/MISSION_26_PART4C_DEMAND_TO_SCHEDULE_BOUNDARY.md) separates verified seasonality, current approved backlog and future pipeline transitions. Migration 207 mounts only a bounded current-position subset from authenticated NorthStar accepted bookings, exact approved schedule revisions and Mission 23 execution/completion state. Migration 208 adds tenant-private owner/admin review binding one current booking to one current Mission 24 approved decision and saved labor plan; changed source pins invalidate the review. The bounded backlog snapshot still withholds person-hours until every counted active booking can be composed at one cutoff. Complete reviewed-plan coverage, legacy/off-platform backlog, seasonality, future transitions, saved forecasts and calibrated outcomes remain unavailable.

Part 4D's [bounded demand UI boundary](../architecture/MISSION_26_PART4D_DEMAND_UI_BOUNDARY.md) is released through PR #407 in the shared paid/demo Command Center. Paid owners/admins must explicitly capture or load an exact migration 209/210-compatible receipt; page load and workspace refresh never create one. The component shows bounded current approved-work counts and reviewed planned-person-minute availability, with explicit missing, noncurrent, stale, oversized, restricted and workspace-recovery states. The isolated demo renders frozen fiction without calling the paid endpoint or production tenant tables. A separate demand-forecast state remains unavailable: backlog is never blended with leads, pipeline, seasonality or predicted work. This bounded release does not issue a forecast or establish final Part 4 acceptance; source-authorized future forecasts, evaluated outputs and end-to-end evidence remain required.

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

Part 8D has an [interim paid/demo Resource outlook availability state](../architecture/MISSION_26_PART8D_RESOURCE_AVAILABILITY_UI.md). It explains that no resource forecast has been issued and recovers from workspace errors without presenting fictional or incomplete records as a risk forecast. Source-backed resource-risk UI and independent Part 8 acceptance remain open.

## Part 9 — five uncertainty, scenario and sensitivity slices

| Slice | Scope |
| --- | --- |
| A | Reproducible deterministic baseline forecasts from one exact configuration and source snapshot. |
| B | Calibrated probability distributions and P10/P50/P90 ranges only where backtest evidence supports them. |
| C | Named forecast scenarios with explicit assumptions and provenance; they remain forecast variations rather than alternative facts. |
| D | Sensitivity, reverse-sensitivity and binding-constraint analysis that returns unavailable when the requested target is unsupported or impossible. |
| E | Paid and isolated-demo risk-range UI, explanation, recovery and independent Part 9 acceptance. |

Part 9A has an [unmounted deterministic baseline reproducibility prerequisite](../architecture/MISSION_26_PART9A_DETERMINISTIC_BASELINE.md) over the existing Part 4A Retell-only arithmetic candidate. It does not authenticate a caller's source snapshot, issue a paid forecast, or close final Part 9A acceptance.

Part 9B's [calibrated-range boundary](../architecture/MISSION_26_PART9B_CALIBRATED_RANGE_BOUNDARY.md) identifies the source, complete saved-run inventory, held-out outcomes, quantile policy and evaluation evidence required before P10/P50/P90 can be issued. Current descriptive evaluation cannot establish calibration, so final Part 9B acceptance remains open.

Part 9C has an [unmounted named open-pipeline scenario prerequisite](../architecture/MISSION_26_PART9C_NAMED_SCENARIO_CANDIDATE.md). It attributes per-estimate adverse/base/favorable assumption weights and reuses Part 6B arithmetic; claimed provenance and source coverage are not authenticated, no forecast is issued, and final Part 9C acceptance remains open.

Part 9D has a [bounded open-pipeline sensitivity prerequisite](../architecture/MISSION_26_PART9D_PIPELINE_SENSITIVITY_CANDIDATE.md). It reuses Part 6B arithmetic for one declared base-weight change and reverse minimum target, returning unavailable for incomplete coverage or an impossible target. Other constraint classes and final Part 9D acceptance remain open.

Part 9E has an [interim paid/demo forecast-range availability state](../architecture/MISSION_26_PART9E_RANGE_AVAILABILITY_UI.md), including workspace failure and recovery. No calibrated range or risk score is issued. Source-backed risk UI and independent final Part 9 acceptance remain open.

## Part 10 — four Forecast Command Center slices

| Slice | Scope |
| --- | --- |
| A | Weekly, monthly and quarterly forecast timelines with current-versus-prior-versus-actual comparison. |
| B | Monthly revenue, operating cost, profit, margin, demand and capacity KPI cards and graphs from the same forecast run. |
| C | Drilldowns showing source coverage, assumptions, confidence, uncertainty, stale inputs, forecast error and why a value changed. |
| D | Owner-visible alerts, recommended next moves, exportable evidence and complete paid/demo Command Center behavior without automatic action. |

Part 10A has an [unmounted weekly/monthly/quarterly timeline projection prerequisite](../architecture/MISSION_26_PART10A_TIMELINE_POSITION.md) over supplied Part 3B receipts. Complete run inventory, authorized actuals, paid/demo comparison UI and final Part 10A acceptance remain open.

Part 10B has a [monthly KPI coherence gate](../architecture/MISSION_26_PART10B_MONTHLY_KPI_GATE.md). The six cards and graphs require one authenticated run manifest, compatible source and calculation bases, and explicit unavailable states; no numeric monthly KPI is issued by this prerequisite and final Part 10B acceptance remains open.

Part 10C has an [unmounted supplied drilldown prerequisite](../architecture/MISSION_26_PART10C_DRILLDOWN_POSITION.md) for coverage, uncertainty tokens, exact point deltas and supplied-outcome error. It does not prove source authority, cause attribution or calibration, and final Part 10C acceptance remains open.

Part 10D has an [owner alert, advice and export gate](../architecture/MISSION_26_PART10D_ALERT_EXPORT_GATE.md). It separates existing record-based Coach advice from future forecast alerts, requires reviewed handoffs and authorized minimized exports, and leaves final Part 10D and Part 10 acceptance open.

## Part 11 — four forecast-governance and handoff slices

| Slice | Scope |
| --- | --- |
| A | Owner forecast settings, horizons and policies with explicit defaults, versioning and validation. |
| B | Immutable forecast runs, freeze, compare, supersede and reproducible rerun behavior. |
| C | Correction, revocation, deletion and algorithm-version propagation through saved forecasts and displayed advice. |
| D | Explicit reviewed handoffs to the owning Mission 20, 22, 24, 27, 28 or 32 workflow; Mission 26 never applies the change itself. |

Part 11A has an [unmounted forecast settings contract](../architecture/MISSION_26_PART11A_FORECAST_SETTINGS_CONTRACT.md) with a disabled system default, explicit owner-reviewed target/horizon preferences, immutable candidate revision linkage and mandatory human review. It grants no source, calibration, actor or persistence authority, and final Part 11A acceptance remains open.

Part 11B has an [unmounted forecast run receipt prerequisite](../architecture/MISSION_26_PART11B_FORECAST_RUN_RECEIPT.md) that pins supplied input/result identities and distinguishes reproduced receipts, changed inputs and result mismatches without rewriting an earlier run. It does not execute or persist a forecast, authenticate its pins or close final Part 11B acceptance.

Part 11C has an [unmounted saved-run currentness prerequisite](../architecture/MISSION_26_PART11C_RUN_CURRENTNESS_PREREQUISITE.md) that conservatively withholds current advice after supplied correction, revocation, deletion, retention or algorithm-version changes. It does not authenticate those states, mount saved-run propagation or close final Part 11C acceptance.

Part 11D has a [reviewed handoff gate](../architecture/MISSION_26_PART11D_REVIEWED_HANDOFF_GATE.md) that assigns action decisions to the owning Mission 20, 22, 24, 27, 28 or 32 workflow. It creates no handoff endpoint or cross-mission mutation, and final Part 11D and Part 11 acceptance remain open.

## Part 12 — six mission-acceptance slices

| Slice | Scope |
| --- | --- |
| A | Complete paid-tenant source-to-forecast-to-explanation-to-reviewed-handoff journey. |
| B | Complete resettable fictional demo journey with strict paid/demo isolation. |
| C | Migration, restart, replay, concurrency, performance, bounds, failure recovery and operational-observability proof. |
| D | Mission-wide accessibility, keyboard, responsive, light/dark theme and five-layout-per-page review. |
| E | Independent exact-head authority, privacy, security, mathematical, data-quality and regression audit. |
| F | Normal merge, deployment, production health, founder visual verdict and final Mission 26 acceptance. |

Part 12A has a [paid-journey readiness audit](../architecture/MISSION_26_PART12A_PAID_JOURNEY_READINESS.md). It selects Mission 26's `revenue.approved_price_flow.v1` target backed by Mission 24 decisions and identifies its first missing guarded event-flow/as-of reader; Part 12A acceptance remains open, and synthetic paid-tenant implementation proof and live tenant forecast validation remain separate.

The first Part 6A source extension is a [guarded approved-price decision event receipt](../architecture/MISSION_26_PART6A_PRICE_EVENT_SOURCE.md). It preserves bounded all-event Mission 24 approval/amendment/withdrawal history without issuing a forecast or closing Part 6A or Part 12A acceptance.

The follow-on [price-decision lineage adapter](../architecture/MISSION_26_PART6A_PRICE_LINEAGE.md) derives first approval and later decision status from that receipt through an internal guarded read. It remains historical source evidence, not a current or future forecast; final Part 6A and Part 12A acceptance remain open.

The [mounted private price-history review](../architecture/MISSION_26_PART6A_MOUNTED_PRICE_HISTORY.md) exposes a guarded, current-source historical position to paid owners/admins without event rows or a forecast claim. Booked-work linkage, future method, immutable run, demo journey and final acceptance remain open.

The [approved-price period coverage anchor](../architecture/MISSION_26_PART6A_PRICE_PERIOD_COVERAGE.md) starts a source-owned provisional observation boundary only from a new guarded capture. Earlier windows remain unverified even when their observed event sum is zero. Because capture and concurrent decisions do not yet share a commit-order fence, later windows also remain provisional rather than source-complete. This covers only canonical NorthStar price decisions, not off-platform business or a sufficient forecast sample; future method and Part 6A acceptance remain open.

The [price-event currentness comparison](../architecture/MISSION_26_PART6A_PRICE_CURRENTNESS.md) can distinguish an unchanged historical receipt from one superseded by later Mission 24 decisions under current tenant and account authority. It does not yet invalidate a saved forecast run because no such run is mounted.

## Non-negotiable evidence boundaries

- A forecast carries its as-of source snapshot, algorithm version, evidence coverage and uncertainty. It is never displayed as a known future fact.
- Actual records remain owned by their source mission. Backtesting appends evaluation evidence and never edits the original forecast or actual.
- Missing financial, workforce, asset or operating-policy authority remains unavailable rather than silently becoming zero or an industry average.
- Tenant-private features, forecasts, prices, workforce information and outcomes never cross tenants. Demo data never contributes to paid forecasts.
- Confidence is not price accuracy, safety certification, customer intent, employee performance or legal/tax advice.
- Mission 26 may recommend a reviewed next step. Mission 28 owns any later automatic execution.
