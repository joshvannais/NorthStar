# Mission 25 — Tenant-private outcome learning

Objective: let each business improve its own operating assumptions from authorized historical and future outcomes without converting predictions into facts or one contractor's data into another contractor's knowledge.

Mission 25 consumes exact references from accepted NorthStar authorities and authorized provider-neutral imports. It does not replace the source records. Mission 20 continues to own business profile and operating policy; Mission 21 owns reviewed shared knowledge; Mission 22 owns scheduling, dispatch, assignment, availability and route recommendations; Mission 23 owns actual field execution; Mission 24 owns estimates and customer-facing price; Mission 26 owns forward-looking business predictions; Mission 27 owns invoices, payments and collections; Mission 28 owns automation.

## Current implementation structure — 14 parts

Mission 25 currently has fourteen top-level parts. A part may use bounded slices when its implementation or release evidence must be serialized. This structure keeps the work measurable without preventing founder-authorized additions, corrections or newly discovered requirements. Any change to the top-level count must be recorded here with its reason and affected completion gates.

| Part | Scope | Status |
| --- | --- | --- |
| 1 | Learning authority, privacy boundaries and live source inventory | Released |
| 2 | Native planned-versus-actual labor-duration observations | Released |
| 3 | Provider-neutral external labor import authority for backfill and continuing updates | Released |
| 4 | Reviewed external worker and job reconciliation | Released |
| 5 | Imported labor-duration outcomes with complete matched lineage | Released |
| 6 | Multi-job imported labor calibration with robust sample statistics | Released |
| 7 | Owner Learning Center: source, consent, freshness, conflict and calibration review interface | Released |
| 8 | Usable import operations: CSV backfill, continuous adapter lifecycle, checkpoints, retention and deletion orchestration | Released |
| 9 | Travel, routing, mileage and fuel estimate-versus-actual outcomes and calibration | Released — Slices A-F accepted |
| 10 | Vehicle and equipment utilization, operating cost, maintenance and downtime outcomes and calibration | Released — Slices A-H independently accepted |
| 11 | Materials, inventory, purchasing, vendor cost and waste outcomes and calibration | In progress — Slices A-G accepted; Slice H candidate |
| 12 | CRM, field-service, project/change-order, communications and external financial outcome reconciliation | Planned |
| 13 | Cross-source job outcome graph and explicit owner adoption into the owning business-profile or planning workflow | Planned |
| 14 | Complete demo/paid experience, recovery and migration proof, accessibility/responsive review, independent audit and mission acceptance | Planned |

## Frozen slice structure for Parts 9-14

Parts 1-8 were released as one bounded package each and do not have retroactive lettered slices. Parts 9-14 contain 48 slices. This count and ordering are frozen before Part 9 Slice D begins. A later change requires a documented authority or acceptance reason, the affected gates and an updated total before implementation proceeds.

### Part 9 — six travel, mileage and fuel slices

| Slice | Scope |
| --- | --- |
| A | Provider-neutral historical and continuous travel, mileage and fuel import authority. |
| B | Explicit reviewed job and vehicle reconciliation. |
| C | Single-job adopted-plan versus imported-actual travel observations. |
| D | Robust multi-job travel calibration with pinned samples and advisory output. |
| E | Adapter lifecycle, checkpoints, retention, revocation and bounded deletion operations. |
| F | Paid and isolated-demo Learning Center travel experience, recovery, accessibility, responsive review and independent Part 9 acceptance. |

### Part 10 — eight vehicle and equipment slices

| Slice | Scope |
| --- | --- |
| A | Native vehicle and equipment utilization outcome authority from current NorthStar operational evidence. |
| B | Provider-neutral external utilization, operating-cost, maintenance and downtime import authority. |
| C | Explicit reviewed job, vehicle and equipment reconciliation. |
| D | Single-job utilization and operating-cost observations against adopted Mission 24 equipment plans. |
| E | Maintenance, downtime, condition and availability outcomes with exact asset lineage. |
| F | Robust multi-job vehicle and equipment calibration with advisory output. |
| G | Source lifecycle, checkpoints, retention, revocation and bounded deletion operations. |
| H | Paid and isolated-demo Learning Center experience, recovery, accessibility, responsive review and independent Part 10 acceptance. |

### Part 11 — eight materials, inventory and purchasing slices

| Slice | Scope |
| --- | --- |
| A | Native planned-versus-used material outcome authority from current NorthStar movement evidence. |
| B | Provider-neutral external inventory, purchasing and vendor-cost import authority. |
| C | Explicit reviewed job, material, vendor and inventory-location reconciliation. |
| D | Single-job quantity, consumption and waste observations. |
| E | Unit-cost, vendor, availability and purchasing observations with explicit currency and valuation boundaries. |
| F | Robust multi-job materials and purchasing calibration with advisory output. |
| G | Source lifecycle, checkpoints, retention, revocation and bounded deletion operations. |
| H | Paid and isolated-demo Learning Center experience, recovery, accessibility, responsive review and independent Part 11 acceptance. |

### Part 12 — eleven external business-system slices

| Slice | Scope |
| --- | --- |
| A | Provider-neutral CRM and field-service import authority. |
| B | Provider-neutral project and change-order import authority. |
| C | Provider-neutral communications evidence import with strict intent, delivery and satisfaction-label boundaries. |
| D | Provider-neutral external invoice, payment, collection and accounting evidence import with the Mission 27 compatibility boundary. |
| E | Explicit reviewed customer, job, estimate, execution, project, change-order and financial reconciliation. |
| F | Lead, appointment, issued-estimate and customer-response outcome observations. |
| G | Scope, change-order and project-delivery outcome observations. |
| H | External revenue, collection, realized-cost and margin observations; native equivalents remain unavailable until Mission 27 releases them. |
| I | Source-specific multi-record calibration with pinned samples, applicability limits and advisory output. |
| J | Source lifecycle, checkpoints, retention, revocation and bounded deletion operations across the Part 12 source classes. |
| K | Paid and isolated-demo Learning Center experience, recovery, accessibility, responsive review and independent Part 12 acceptance. |

### Part 13 — eight cross-source graph and adoption slices

| Slice | Scope |
| --- | --- |
| A | Canonical tenant-private cross-source job and outcome graph authority. |
| B | Deterministic freshness, conflict, completeness and evidence-coverage evaluation. |
| C | Complete per-job outcome summaries across labor, travel, equipment, materials, scope and available financial evidence. |
| D | Cross-job proposal generation with pinned cohorts, dispersion, applicability and uncertainty. |
| E | Versioned proposal registry and owner-readable impact preview. |
| F | Explicit owner adoption through the authority that owns the affected business-profile or planning value. |
| G | Correction, revocation, deletion, proposal supersession and adoption-lineage propagation. |
| H | Paid and isolated-demo graph and adoption experience, recovery, accessibility, responsive review and independent Part 13 acceptance. |

### Part 14 — seven mission acceptance slices

| Slice | Scope |
| --- | --- |
| A | Complete paid-tenant source-to-observation-to-calibration-to-adoption journey. |
| B | Complete resettable fictional demo journey with strict paid/demo isolation. |
| C | Migration, restart, replay, resume, correction, revocation, retention and deletion recovery proof. |
| D | Bounds, performance, concurrency, failure recovery and operational observability proof. |
| E | Mission-wide accessibility, keyboard, responsive, light/dark theme and five-layout-per-page review. |
| F | Independent exact-head authority, privacy, security and regression audit across the complete mission. |
| G | Normal merge, deployment, production health, founder visual verdict and final Mission 25 acceptance. |

Part 12 may consume authorized external invoice, payment and collection evidence. Native NorthStar invoice/payment/collection records remain unavailable until Mission 27 creates that authority; Mission 25 records the compatibility boundary and must not invent those records early. Part 14 cannot pass with placeholder connectors, sample-only cards, an API-only owner workflow, fabricated outcomes or unresolved tenant/deletion boundaries.

## First bounded package — root authority and live-state inventory

The first package is the [learning architecture](../architecture/MISSION_25_LEARNING_ARCHITECTURE.md) and [source inventory](../architecture/MISSION_25_LEARNING_SOURCE_INVENTORY.md). It establishes the contract that later runtime packages must satisfy. It adds no learning table, model, connector, provider call, route, UI, production configuration or data consumption.

The existing `/polaris/learning` compatibility route returns current Polaris snapshot projections. Its name does not make it a Mission 25 learning engine, training corpus or outcome graph.

## Second bounded package — labor duration observations

The first runtime source adoption compares the worker hours in one explicitly adopted Mission 24 labor plan with accepted, non-break Mission 23 labor intervals for the same completed paid-tenant job. An owner or administrator must grant current `labor_duration_variance_v1` purpose consent and explicitly confirm each observation. The confirmation and contract version are enforced and retained at the database boundary. The result is a deterministic variance advisory with exact estimate, revision, plan, execution, completion, labor-record, consent and algorithm lineage.

Source corrections make the current advisory stale until it is deliberately refreshed. Consent revocation immediately blocks new observations and hides derived values from the runtime projection. The immutable audit rows remain governed records; the runtime role can use only guarded entry functions. The package does not train a model, pool tenants, read demo activity, infer employee performance, change a rate, revise an estimate, alter a schedule or update a business policy.

This is one source class and one advisory comparison. Historical imports, continuous external updates, deletion/tombstone orchestration, multi-job calibration, owner-facing adoption UI and the other source classes below remain required before Mission 25 completion.

## Third bounded package — external labor import authority

Migration `084_canonical_external_labor_import_authority.sql` and the guarded external-labor routes under `/api/v1/learning` establish the first provider-neutral historical-backfill and continuous-update envelope. An owner or administrator explicitly grants consent to one named source. Each bounded batch then pins that consent, its schema version, mode, before/after cursor, explicit confirmation, normalized records, request identity and source versions. A repeated record version is deduplicated only when its normalized digest is identical. A conflicting same version, stale cursor or out-of-order version fails closed. Higher versions form immutable correction chains; source tombstones remove work details from the current projection.

This package deliberately stages normalized external labor evidence. It does not insert Mission 23 labor intervals, match opaque worker or job references, calculate a labor outcome, update an estimate, infer payroll, or change a schedule or policy. Revocation blocks imports and hides the source projection. Durable audit rows remain governed evidence. A future reconciliation package must require reviewed entity matches before these records can support a tenant-private observation.

This is the adapter-facing runtime foundation, not a completed vendor connector or owner import experience. CSV ingestion, provider authorization, provider-specific adapters, reviewed job/worker matching, retention and deletion orchestration, and the remaining integration categories are still required before Mission 25 completion.

## Fourth bounded package — reviewed external labor reconciliation

Migration `085_canonical_external_labor_reconciliation.sql` and the guarded `matches` routes add reviewed worker and job reference reconciliation for a consented external labor source. An owner or administrator explicitly links one opaque external worker reference to a current active workforce profile, or one opaque external job reference to a same-tenant canonical estimate. Every link pins the current consent, complete current imported-record manifest and current target basis. A source correction or tombstone makes a saved link stale, as does a worker profile, membership or consent revision change. Revocation hides matching projections and blocks writes. Re-granting consent does not revive an earlier match. Unlinking creates an immutable revision.

The package does not infer a match, mutate either source authority, or silently replace a stale link. No imported record supports an outcome observation yet; the later observation package must require a current reviewed match and pin that match in its own lineage. No rendered owner interface is included; this API-only package documents the later wording, focus, mobile and theme review gate.

## Fifth bounded package — imported labor-duration outcomes

Migration `086_canonical_imported_labor_outcomes.sql` and guarded external-labor outcome routes allow a current reviewed external job to be compared with its adopted Mission 24 labor plan. A separate purpose consent is required in addition to source consent. Every opaque worker reference and the job reference must have a current owner-reviewed same-tenant match. The observation pins the estimate, adopted revision and labor plan, source consent, job match, worker matches, all current imported intervals and calculation version. Overlapping intervals fail closed.

The output is a deterministic advisory variance. Source corrections, tombstones, target changes, match changes and consent changes make prior advice stale; revocation hides derived results. The package does not alter an estimate, rate, schedule, payroll record, workforce profile or policy. No rendered owner interface is included; the future interface must separately pass wording, focus, keyboard, mobile, theme and founder visual review.

Mission 25 currently has fourteen top-level parts under the structure above. Later parts must state the exact source class, consent, correction/deletion behavior, derived output and release evidence they add. Completion requires usable roadmap-designated historical-backfill and continuous-update integrations; placeholder connectors and sample cards are insufficient.

## Required direction

- Learn only inside the contractor's tenant from exact permitted source versions.
- Reconcile authorized records into one provenance-cited job and outcome graph; do not copy unrelated raw payloads into a parallel authority.
- Preserve known, inferred, conflicting, stale, missing and human-confirmed states.
- Propagate source corrections, revocations, tombstones, retention decisions and deletion authority into every dependent derived result.
- Keep imports permissioned, minimized, schema/version pinned, bounded, resumable, idempotent, deduplicated, freshness-aware and reversible.
- Fail closed when conflicts, gaps, stale telemetry or uncertain entity matches could materially distort an estimate or recommendation.
- Calibrate business assumptions from verified estimate-versus-actual evidence; never rewrite historical estimates or operational facts to match a learned result.
- Keep learning advisory. Applying a changed rate, productivity assumption, price or schedule policy requires the separately authorized human workflow.
- Keep simulations isolated. Fictional demo activity may demonstrate the experience but cannot train or alter paid-tenant parameters.
- Disable cross-tenant aggregation and model improvement unless a later separately authorized privacy-preserving design is approved and audited.

## Integration coverage required before completion

Provider-neutral coverage must include the applicable authorized historical and future sources across CRM/field service, fleet/GPS, equipment/maintenance, inventory/materials, ERP/accounting, payroll/timekeeping, fuel/expense, routing, procurement/vendor, project/construction and communications systems. A business may use only a subset, but the integration contract cannot assume that NorthStar-created jobs are the only outcomes.

The learning inputs include verified labor/time, travel/routes/fuel, vehicle and equipment utilization/downtime, materials, purchasing cost, change orders, invoices/collections, customer price, direct and operating cost, margin and estimate-versus-actual variance. Mission 27 must first provide invoice/payment authority before those financial outcomes can become NorthStar-native learning evidence.

## Evidence boundaries

Architecture acceptance is not runtime completion. Each source adoption needs mounted tenant and role isolation, consent/currentness, provenance, correction/tombstone, replay/deduplication, limit, recovery and deletion/retention tests. Production-provider readiness, private production data, cross-tenant aggregation, physical-device coverage and founder visual approval remain separate gates.

## Sixth bounded package — multi-job imported labor calibration

Migration `087_canonical_imported_labor_calibration.sql` and guarded calibration routes summarize five to 100 current reviewed imported labor-duration outcomes for one exact service key. The latest reviewed observation for each estimate and external-job-reference pair is a distinct candidate. Freshness is evaluated before the deterministic 100-outcome cap, with a fail-closed 10,000-chain review bound. Separate calibration consent pins current imported-outcome consent. Each immutable proposal pins its complete sample and reports a deterministic median recorded-to-planned worker-hour ratio with lower and upper quartiles. A fixed five-percent band produces only an advisory to keep, increase or decrease planned hours. Exact-key retries resolve the saved immutable request before requiring a new sample and mask stale advice.

Source corrections, reviewed-match changes, adopted-plan changes, observation refreshes and consent changes make the saved proposal stale and mask its recommendation. Nothing automatically changes an estimate, labor plan, rate, schedule, payroll record, worker profile or business policy. No rendered owner interface is included; later adoption UI must separately pass wording, focus, keyboard, mobile, theme and founder visual review.

## Seventh bounded package — Owner Learning Center

The Learning Center is a separate owner and administrator destination that inventories tenant-private learning sources and opens the already governed consent, evidence, reference-match and calibration authorities in one review flow. The paid page reads PostgreSQL through a bounded security-definer projection. Members and viewers have no Learning Center permission. The isolated demo page uses explicit read-only fictional records and cannot contribute to paid learning.

Controls use current revision and digest pins, explicit confirmation versions, idempotency keys and fixed action-specific audit reasons. The interface does not ask an owner to invent a human-approval explanation. It reports stale and unmatched references, keeps calibration proposals advisory, and applies no estimate, rate, schedule, payroll, workforce or policy change. Part 8 still owns usable CSV backfill, continuous adapter lifecycle, checkpoints, retention and deletion orchestration; Part 14 owns complete paid/demo parity and mission-wide visual acceptance.

## Eighth bounded package — usable import operations

Migration `089_canonical_external_labor_import_operations.sql` and the Learning Center source-operation workflow add exact-schema CSV historical backfill, provider-neutral adapter lifecycle state, historical and continuous checkpoints, source retention policy and bounded retention or deletion cleanup. CSV pages still pass through the guarded Part 3 batch authority. Adapter state stores no credential and does not claim a provider-specific connection.

Every lifecycle and policy change is an immutable revision pinned by expected revision and digest. Cleanup processes at most 100 current records, appends detail-free tombstone revisions and returns a resumable checkpoint. A deletion request immediately appends a source-consent revocation so new imports and derived reads stop before the cleanup finishes. Corrections and tombstones continue to stale downstream reviewed matches, observations and calibration proposals. These operations do not apply a learned value or change an estimate, rate, labor plan, schedule, payroll record, workforce profile or business policy.

## Ninth bounded package — travel, mileage and fuel outcomes

Part 9 is serialized because the accepted source inventory does not contain a native GPS or fuel-purchase authority. Slice A adds a provider-neutral normalized travel evidence envelope for historical backfill and continuous updates. Every record pins one opaque job and vehicle reference, a completed route interval with an explicit IANA time zone, exact distance and fuel units when present, an evidence class, source version and update time. Fuel cost uses one of NorthStar's supported currencies (`USD`, `CAD` or `EUR`) or remains unavailable. A record must contain measured distance or fuel; modeled MPG, straight-line geometry, future route intervals and estimate-plan values cannot enter as actuals.

The import is tenant-private, consented, bounded to 100 records, cursor checked, idempotent, correction aware and tombstone aware. Revocation hides current evidence and blocks further imports. It stages evidence only: opaque job and vehicle references are not yet reconciled, and no record changes an estimate, route, schedule, reimbursement, payroll, asset, price or business policy.

Slice B adds explicit owner-reviewed reconciliation from each opaque job reference to a same-tenant canonical estimate and from each opaque vehicle reference to a current active reviewed vehicle asset version. A link pins the current source consent, complete current source-record manifest and exact target basis. Route corrections, tombstones, vehicle identity or operating-ledger changes, target removal and consent changes make saved links stale. Re-granting consent does not revive links approved under an earlier consent revision. Unlinks append another immutable revision. The service never guesses by name and never changes a job, vehicle, estimate, route, schedule or policy.

Slice C adds separately consented observations between one exact adopted Mission 24 travel plan and the current reconciled imported route records for that job. Route duration, driving distance, fuel or energy quantity and fuel cost are evaluated independently. Distance is normalized to miles only when every record and plan leg provides comparable driving distance. Liquid fuel is normalized to US gallons; electric energy remains kilowatt-hours and is never mixed with liquid fuel. Fuel cost is compared only when every current record carries the adopted plan currency. Each unavailable dimension remains explicit rather than borrowing a modeled value or exchange rate. Corrections, tombstones, adopted-plan changes, reviewed-match changes and consent changes stale prior advice. The observation never changes an estimate, route, schedule, reimbursement, payroll, asset or policy.

Slice D adds separately consented, tenant-private multi-job travel calibration for five to 100 current reviewed same-service outcomes. Route duration, distance, fuel or energy quantity and fuel cost are calibrated independently. Each compatible dimension reports deterministic median and quartile actual-to-planned ratios and an advisory multiplier; mixed units, mixed currencies or incomplete evidence make only that dimension unavailable. The proposal pins its full sample, source and outcome consent, calculation version and immutable request identity. Corrections, match changes, adopted-plan changes and consent changes stale the proposal and mask its advice without changing any operational authority.

Slice E adds provider-neutral travel-source adapter lifecycle, historical and continuous checkpoints, retention policy, deletion requests and bounded resumable cleanup. It stores no provider credentials. Retention and deletion append minimized source tombstones in batches of at most 100; a deletion request also revokes source consent immediately.

Slice F extends the paid and isolated-demo Learning Center with one typed labor-and-travel source inventory. Owners can add a tenant-private travel source, review source and purpose consent, inspect route, mileage and fuel evidence, reconcile job and vehicle references, operate provider-neutral lifecycle and cleanup controls, and review route duration, distance, fuel quantity and fuel cost calibration separately. The demo uses explicit fictional read-only records. Page-entry loads disable browser scroll restoration, recover at the top and expose busy and live status semantics. Installed Chrome at 390 by 844 and Playwright WebKit at 1440 by 900 exercise the paid and demo routes against disposable PostgreSQL with no page errors or horizontal overflow. Playwright WebKit is not physical Safari evidence. Independent exact-head acceptance passed for the complete six-slice package with no actionable correctness, security, privacy or regression finding.

## Part 10 Slice A — native equipment checkout-duration outcomes

Migration `096_canonical_native_equipment_utilization.sql` and guarded native-equipment utilization routes add one narrow tenant-private observation from current NorthStar evidence. An owner or administrator separately consents to `native_equipment_checkout_variance_v1`. One explicitly adopted Mission 24 equipment-cost plan is then compared with the complete effective `check_out` through `check_in` event chains for the exact reviewed native assets on the linked completed Mission 23 execution. Every planned-hours line must resolve to one current reviewed asset; duplicate asset allocation, missing pairs, overlapping checkout chains, event corrections, stale asset versions and changed plan lineage fail closed.

The immutable observation pins the estimate, adopted estimate revision, equipment plan, equipment-cost plan, execution, completion, exact asset versions and every effective checkout/use/check-in event. It reports planned hours, recorded checkout hours and a deterministic variance advisory. Recorded checkout duration is deliberately not described as engine-on time, productive utilization, fuel burn, operating cost, maintenance cost, condition or availability. Source corrections make earlier advice stale and mask its recommendation until the owner records a new observation. Consent revocation blocks writes and hides derived history. The runtime role has guarded entry-function access only, and no estimate, schedule, asset, allocation, price or business policy changes automatically.

Independent exact-head acceptance passed at `e62a248cd0a3bbbde3495d921171c60e2921a9ee` after the first audit rejected null consent pins and delayed replay ordering. The corrected database boundary rejects missing or malformed pins without a write, replays an exact committed request after source correction with stale advice masked, returns only a minimal consent-safe receipt after revocation, and still rejects changed request content under the same key. The acceptance report SHA-256 is `976f367c6c7321e497f84ec7181034c6d9c320093e1334d3862f38dae0c220c9`. Slices B-H remain required for Part 10 completion.

## Part 10 Slice B — external vehicle and equipment evidence

Migration `097_canonical_external_asset_import_authority.sql` and guarded external-asset routes stage provider-neutral historical and continuous records for vehicle or equipment utilization, operating cost, maintenance and downtime. A current owner or administrator must grant explicit source consent. Batches pin the exact current consent, schema version, independent backfill or continuing-update cursor, confirmation, actor/session authority and immutable request identity.

Each active record carries an opaque source record, optional opaque job reference, required opaque asset reference, vehicle/equipment category, exact period and time zone, one typed evidence claim, evidence class, source update time and an opaque provider-evidence digest. Utilization retains an explicit unit and basis. Operating cost retains amount, currency, cost class and basis. Maintenance retains service class, status, optional opaque work-order reference and optional meter. Downtime retains reason class and whether it was scheduled. The import does not treat an estimate, modeled amount or unknown unit as an actual.

Exact duplicate versions are counted without another record. A same-version payload conflict or older version fails closed. Higher versions append immutable corrections; tombstones retain no operational detail. Revocation blocks writes and hides current source evidence, while an exact delayed retry still receives its original immutable receipt. Protected tables and projection/validation helpers are withheld from the runtime role; only guarded entry functions are executable.

This is staging authority only. It does not reconcile opaque references, create Mission 23 events, calculate an estimate-versus-actual outcome, allocate a monthly payment to a job, or change a job, estimate, schedule, asset, cost allocation or policy. Provider credentials, provider-specific adapters, reviewed reconciliation, outcomes, calibration, retention/deletion operations and Learning Center experience remain Slices C-H.

## Part 10 Slice C — reviewed external asset reconciliation

Migration `098_canonical_external_asset_reconciliation.sql` records explicit owner or administrator links from current opaque job, vehicle and equipment references to a same-tenant estimate or current active reviewed asset version of the matching category. Each link pins current source consent, all current imported records carrying the reference, and the current target basis, including the asset version and equipment-ledger revision and digest when present. No fuzzy matching is permitted. Corrections, tombstones, consent, target, asset-version or ledger changes make earlier links stale; revocation hides and blocks them, and re-granting cannot revive them. The links remain lineage only and do not change operational authority.

## Part 10 Slice D — imported utilization and operating-cost outcomes

Migration `099_canonical_imported_asset_outcomes.sql` adds separate purpose consent and immutable single-job observations against the exact adopted Mission 24 equipment plan and equipment-cost plan. Every current job, vehicle and equipment reference used by the observation must retain an exact current owner-reviewed match. The observation pins the adopted revision, both plans, source consent, reviewed reconciliation revisions, asset versions and ledger bases, and every current utilization or operating-cost record used.

Machine-hour utilization and same-currency job operating costs are evaluated independently. Each dimension requires its distinct current reconciled target-asset set to equal the adopted plan-asset set exactly; missing targets, extra targets and duplicate external-reference coverage remain unavailable. Engine hours, distance, cycles and job counts are not converted to planned equipment hours. Financing, insurance, rental and unspecified charges are not relabeled as job operating cost, and no exchange rate is inferred. Missing or incompatible dimensions remain explicitly unavailable without suppressing a compatible dimension. Corrections, tombstones, consent, reconciliation, plan, asset-version or ledger changes stale and mask prior advice. Revocation hides and blocks derived work, and re-granting does not revive old consent or matches. The result remains advisory and cannot change an estimate, price, schedule, job, asset, allocation, reimbursement, payroll record or policy. Maintenance-event, downtime, condition and availability outcomes remain Slice E.

## Part 10 Slice E — exact-lineage asset health outcomes

Migration `100_canonical_imported_asset_health_outcomes.sql` adds separate purpose consent and immutable observations for one exact reviewed vehicle or equipment reference. Every observation pins current source consent, the complete current source-reference manifest, the exact reviewed match revision, current asset version and equipment-ledger basis, and every current maintenance or downtime record used.

Maintenance status counts and non-overlapping downtime duration are summarized independently. Overlapping downtime remains unavailable pending source review. Condition remains unavailable because maintenance and downtime do not establish current condition. Availability remains unavailable because recorded downtime without a complete observation window does not establish an availability percentage. No absence of evidence, unit conversion, engine-on time, productivity, maintenance requirement, condition, availability or cost is inferred. Corrections, tombstones, consent, reconciliation, asset-version or ledger changes stale and mask earlier advice; revocation hides and blocks it, and re-granting cannot revive old consent or matches. The result remains advisory and cannot change any operational record or policy. Calibration, source lifecycle operations and the rendered Learning Center remain Slices F-H.

## Part 10 Slice F candidate — robust multi-job vehicle and equipment calibration

Migration `101_canonical_imported_asset_calibration.sql` adds separate purpose consent and immutable advisory calibration proposals from five to 100 current reviewed same-service Slice D observations. The sample pins current source and outcome consent plus each observation's exact adopted plan, reviewed reconciliation, asset-version, equipment-ledger and imported-record lineage through its immutable observation and source digests.

Machine-hour utilization and same-currency job operating cost are calibrated independently with deterministic median and quartile actual-to-planned ratios. A dimension needs at least five compatible current outcomes. Raw statistics are preserved, while a multiplier is offered only inside the inclusive reciprocal `0.25` to `4.00` review-step range. An outlier retains its evidence but withholds advice pending baseline and source review. Incomplete or mixed-unit dimensions remain explicitly unavailable. Maintenance, downtime, condition and availability are not calibrated because current authority has no adopted baseline for those dimensions. Corrections, tombstones, consent, reconciliation, plan, asset-version or ledger changes stale the sample and mask prior advice; revocation hides and blocks it, and re-granting does not revive an old consent period. The proposal remains advisory and cannot change an estimate, price, plan, schedule, job, vehicle, equipment, allocation, reimbursement, payroll record or policy. Source lifecycle operations and the rendered Learning Center remain Slices G-H.

## Part 10 Slice G candidate — source lifecycle and bounded cleanup

Migration `102_canonical_external_asset_import_operations.sql` adds provider-neutral adapter lifecycle, historical and continuous checkpoints, retention policy, deletion requests and bounded resumable cleanup for external vehicle and equipment evidence. It stores no provider credentials or provider account identity and does not claim a live provider connection.

Every lifecycle, retention and deletion change is an immutable revision pinned to the exact prior revision and digest. Cleanup processes no more than 100 current records, appends detail-free tombstone revisions and returns an exact resumable checkpoint. A retention-policy change starts a new cleanup chain. A deletion request immediately revokes source consent, so new imports and derived reads stop before cleanup finishes. Source permission cannot be re-granted while deletion remains active. Recovery requires explicit deletion cancellation and a new consent period, which cannot revive tombstoned evidence or prior reconciliation, outcome or calibration authority.

Cleanup remains tenant private and owner or administrator controlled. It does not create Mission 23 events, connect to a provider, apply a learned value or change an estimate, price, plan, schedule, job, vehicle, equipment, assignment, allocation, reimbursement, payroll record or policy. The paid and isolated-demo Learning Center, recovery and responsive acceptance remain Slice H.

## Part 10 Slice H candidate — paid and isolated-demo Learning Center

Migration `103_canonical_learning_center_assets.sql` extends the bounded tenant-private Learning Center inventory with a distinct vehicle-and-equipment source category and native equipment comparison consent. Identical source labels remain separate across labor, travel and asset categories. The paid page composes only the accepted guarded Part 10 authorities for source consent, staged evidence, explicit job/vehicle/equipment matching, source operations, separately consented asset-health summaries and utilization/operating-cost calibration.

The isolated demo adds fictional, read-only vehicle and equipment records without calling a paid mutation or entering paid learning authority. Maintenance and downtime are shown independently; condition and availability remain explicitly unavailable. A current deletion request blocks the source-grant control and explains the required cancellation and new-consent recovery without implying that deleted detail, reviewed matches, observations or calibration can revive.

The experience uses plain business language, live loading and error status, labeled controls, skip navigation, keyboard focus styles, responsive cards and bounded tables. Request-generation guards prevent delayed source, health or calibration reads from replacing a newer selection. It changes no estimate, price, plan, route, schedule, job, vehicle, equipment, maintenance plan, allocation, reimbursement, payroll record or policy. Physical-device review, manual assistive-technology review and the founder's visual verdict remain separate unavailable evidence until performed.

Part 10 passed independent exact-head acceptance at `8f6af4c2a3654d2e1b9a1e2246d35b6933838cad` with no P0-P3 findings. Production migration and deployment, provider credentials and private production data remained outside that acceptance package.

## Part 11 Slice A accepted — native planned-versus-used material outcomes

Migration `105_canonical_native_material_outcomes.sql` adds separate purpose consent and an immutable advisory comparison between one exact adopted Mission 24 multi-line material plan and one explicitly selected completed Mission 23 execution. Every planned line must have one owner-supplied exact item reference. The exact plan-line set and binding set must match, and one recorded item cannot ambiguously represent multiple planned lines.

The comparison pins the estimate, current adopted estimate revision, exact material plan, selected execution, current completion record, sorted bindings and the complete current movement set for every bound item. It compares waste-inclusive planned quantity with accepted consumption plus accepted waste only when the recorded unit already matches the planned unit. Unreviewed evidence, incomplete line coverage, missing accepted use, conflicting units, changed completion, changed adoption or changed movement evidence fails closed or makes prior advice stale. Returns, transfers and adjustments remain in provenance but do not establish use. No names are matched and no units, stock, purchases, vendor facts, costs, availability or valuation are inferred.

Revocation hides saved observations and blocks new ones. A later grant begins a distinct consent period and does not revive earlier observations. The runtime role receives only guarded owner/administrator entry functions; storage and basis helpers remain withheld. The output is advisory and changes no estimate, price, job, material movement, inventory balance, purchase, vendor record or business policy. External sources, reconciliation, quantity/waste expansion, unit cost, vendor and availability outcomes, calibration, lifecycle cleanup and the rendered Learning Center remain mandatory Slices B-H.

Slice A passed independent exact-head acceptance at `82ceac0be5ca4169a5bbd5dcf681a498a3ad5415` with no P0-P3 findings.

## Part 11 Slice B accepted — external material, inventory, purchasing and vendor-cost evidence

Migration `106_canonical_external_material_import_authority.sql` adds a provider-neutral staging boundary for separately consented inventory balances, inventory movements, purchases and vendor costs. Each immutable normalized record preserves its opaque source and record identity, source version, event and source-update times, IANA time zone, opaque job/material/vendor/location references when applicable, exact quantity and unit, exact amount/currency/valuation when applicable, evidence class and provider evidence digest. Pages are bounded, cursor-pinned and deterministic under replay and concurrency.

The four record classes are validated independently. Inventory balances require an explicit location and may record zero quantity. Movements require a declared movement class and positive quantity. Purchases require positive quantity, vendor identity and an explicit unit or line-total cost. Vendor costs require positive quantity, vendor identity and an explicit valuation and source basis. Unsupported units, currencies, conversions and incomplete values fail closed. Corrections require a higher source version; tombstones retain no business detail.

Source permission is current-period specific. Revocation hides all staged detail and blocks new imports. A later grant starts a new permission period and does not revive records from an earlier period. Runtime receives only guarded owner/administrator entry functions and cannot read protected tables or call validation/projection helpers. This slice does not reconcile opaque references, infer stock or value, calculate outcomes, connect to a provider, or change estimates, jobs, material plans, inventory, purchases, vendors, costs or policy. Reconciliation, quantity/waste observations, cost/vendor/availability observations, calibration, lifecycle cleanup and the Learning Center remain mandatory Slices C-H.

Slice B passed independent exact-head acceptance at `a06968bad9620de8199286d7011bce511ea43a39` with no P0-P3 findings.

## Part 11 Slice C accepted — reviewed external material reconciliation

Migration `107_canonical_external_material_reconciliation.sql` adds explicit owner or administrator links from opaque current-period external job, material, vendor and inventory-location references to exact same-tenant current targets. Job links use canonical estimates. Material and location links require accepted Mission 23 movement evidence under the exact item or location key. Vendor links require the exact supplier label from a currently adopted Mission 24 material-plan line whose reviewed evidence type is `supplier_quote`; this remains company-recorded evidence and is not supplier verification.

Every immutable link pins the current source permission, complete current source-record manifest and complete current target manifest. The service never guesses by name, converts a unit or currency, creates a target, or changes an operational record. Source corrections and tombstones, accepted movement or location changes, estimate or adopted-plan changes, match changes and permission changes make earlier lineage stale or unavailable. Revocation hides and blocks reconciliation. A later permission period revives neither prior imported evidence nor prior matches. Quantity and waste observations, cost, vendor and availability outcomes, calibration, lifecycle cleanup and the rendered Learning Center remain mandatory Slices D-H.

Slice C passed independent exact-head acceptance at `5befa1351f0b64e46e028dcdb5f6ce1f0c41f005` with no P0-P3 findings.

## Part 11 Slice D accepted — imported material quantity, consumption and waste outcomes

Migration `108_canonical_imported_material_quantity_outcomes.sql` adds separate current-source-period purpose consent and an immutable advisory observation for one exact imported job and one exact adopted Mission 24 material plan. Every job and material reference requires a current owner-reviewed Part 11C link. The owner supplies one exact opaque material reference for every plan line; the plan lines, bindings and current recorded material references must have equal coverage, and one reconciled target item cannot stand for multiple plan lines.

Recorded consumption and recorded waste are evaluated independently from current imported inventory-movement evidence. Missing evidence remains unavailable rather than becoming zero. A unit conflict makes only that dimension unavailable. Total recorded use and plan variance require both compatible dimensions, and the overall advisory is withheld unless every planned line is comparable. Purchases, vendor costs, balances, returns, transfers and adjustments do not establish job use in this slice.

Every observation pins the estimate, adopted revision and plan, current source permission, exact job and material matches, sorted bindings and complete current job-record manifest. Corrections, tombstones, link or target changes, plan changes and consent changes stale and mask prior advice. Revocation hides derived history, and later grants revive neither earlier evidence nor observations. The output is advisory and changes no estimate, price, job, plan, material movement, inventory balance, purchase, vendor record, cost or policy. Cost, vendor, purchasing and availability observations, calibration, lifecycle cleanup and the rendered Learning Center remain mandatory Slices E-H.

Slice D passed independent exact-head acceptance at `b0f859aa2b96a75721f207925e8e58cf85655c13` with no P0-P3 findings.

## Part 11 Slice E accepted — imported material cost, purchasing, vendor and recorded-balance observations

Migration `109_canonical_imported_material_cost_observations.sql` adds separate current-source-period purpose consent and immutable advisory observations for one exact imported job and one exact adopted Mission 24 material plan. Every job and material reference needs a current owner-reviewed Part 11C link. Vendor and inventory-location references are explicit per-line bindings and require their own current reviewed links when used.

Unit cost, job purchasing quantity and line total, reviewed vendor lineage, and recorded inventory balance are evaluated independently. A unit cost requires exactly one compatible current record in the planned unit and estimate currency; equal numeric amounts never collapse separate provenance chains. A purchase line total remains a line total and is never divided into a fabricated unit price. Vendor lineage reflects company-reviewed supplier evidence without independently verifying or rating the supplier. One exact recorded balance can be compared with the waste-inclusive planned quantity at its source timestamp, but it never confirms present availability. Mixed units, currencies, valuations, missing evidence, duplicate or conflicting price records and multiple balance records make only the affected dimension unavailable.

The observation pins the estimate, adopted revision and plan, current source permission, exact reviewed reconciliation revisions, sorted bindings and the complete relevant current imported-record manifest. Corrections, tombstones, source or purpose consent changes, plan changes, target changes and reviewed-link changes stale and mask prior output. Revocation hides derived history, and later grants revive neither earlier evidence nor observations. No unit, currency, valuation, cost allocation, vendor selection, purchase need or availability is inferred. The result is advisory and changes no estimate, price, plan, job, purchase, vendor, inventory record, reservation, schedule or policy. Calibration, lifecycle cleanup and the rendered Learning Center remain mandatory Slices F-H.

Slice E passed independent exact-head acceptance at `1effdbc5768efe091d788dda544a37084f65cd7c` with no P0-P3 findings.

## Part 11 Slice F accepted — robust multi-job material and purchasing calibration

Migration `110_canonical_imported_material_calibration.sql` adds separate current-period calibration consent and immutable advisory proposals for five to 100 fresh same-service jobs. Every job must have one current Part 11D quantity observation and one current Part 11E cost observation for the same canonical estimate, imported job and exact adopted Mission 24 material plan. A separately reviewed imported job linked to the same estimate remains a distinct equal-weight sample; only later revisions of the same exact estimate-and-imported-job pair replace its earlier observation. The sample pins all four consent periods, both observation identities, revisions, digests and source digests, the normalized service, calculation version and request identity.

Each job has equal weight. Complete compatible plan lines first reduce to one per-job median for total use, waste, unit cost, purchased quantity and purchase cost. The cross-job sample then reports median and lower and upper quartile actual-to-planned ratios for each dimension independently. A dimension needs five jobs on one exact unit, plan-shape and currency basis. Missing, ambiguous or incompatible evidence does not become zero and does not suppress a different compatible dimension.

Raw robust statistics are retained. Only an inclusive `0.25` to `4.00` median may produce an advisory multiplier. Vendor lineage and recorded inventory balance remain uncalibrated because the accepted sources provide neither a numeric future baseline nor proof of current availability. Corrections, tombstones, reconciliation or target changes, adopted-plan changes, observation revisions and consent changes stale and mask prior advice. Revocation hides history and later grants revive no prior proposal. No estimate, price, plan, job, purchase, vendor, inventory record, balance, reservation, schedule or policy is changed. Lifecycle cleanup and the rendered Learning Center remain mandatory Slices G-H.

Slice F passed independent exact-head acceptance at `410c7c5ddaf73a6962c0f2d44e64fb6d1b5a1ff3` with no P0-P3 findings.

## Part 11 Slice G accepted — material source lifecycle and bounded cleanup

Migration `111_canonical_external_material_import_operations.sql` adds provider-neutral adapter lifecycle, historical and continuous checkpoints, retention policy, deletion requests, legal and audit holds, and bounded resumable cleanup for external material, inventory, purchasing and vendor-cost evidence. It stores no provider credential or provider account identity and does not claim a live connection.

Every lifecycle, retention, deletion and hold change is an immutable revision pinned to the exact prior revision and digest. Cleanup processes at most 100 current records, appends detail-free tombstone revisions and returns an exact resumable checkpoint. A policy change starts a new cleanup chain. A current legal or audit hold blocks cleanup; a deletion request can still revoke source permission immediately, so imports and derived reads stop without destroying held evidence. Source permission cannot be re-granted while deletion remains active. Recovery requires explicit hold release when applicable, deletion cancellation and a new source consent period. None of those actions revives tombstoned evidence or prior reconciliation, observation or calibration authority.

Cleanup remains tenant private, owner or administrator controlled, narrowly scoped, idempotent and observable. It never connects to a provider or changes an estimate, price, material plan, job, purchase, vendor, inventory balance, reservation, schedule or policy. The paid and isolated-demo Learning Center and complete Part 11 acceptance remain Slice H.

## Part 11 Slice H accepted — material Learning Center and Part 11 acceptance

Migration `112_canonical_learning_center_materials.sql` extends the bounded tenant-private Learning Center inventory with native material permission and external material sources while preserving separate labor, travel, vehicle and equipment categories. The owner-facing paid and isolated-demo page exposes source permission, imported evidence, exact reviewed links, independent quantity, cost and planning permissions, material planning suggestions and explicit unavailable reasons.

Material lifecycle controls show connection progress, retention, deletion and active legal or audit holds in plain business language. An irreversible deletion batch requires a separate consequence confirmation. Holds disable cleanup. Deletion cancellation and a new permission period do not revive deleted details, comparisons or earlier planning authority. The surface remains advisory and never changes estimates, material plans, inventory, purchases, vendors, schedules, jobs or policy.

Part 11 passed independent exact-head acceptance at `97a08a9733a3f7f0fb19465f418a58a927c2158d` with no P0-P3 findings. Production migration and deployment, provider credentials, physical-device review, manual assistive-technology review and the founder's visual verdict remained outside that acceptance package.

## Part 12 Slice A candidate — provider-neutral CRM and field-service import authority

Migration `113_canonical_external_crm_field_service_import_authority.sql` adds a provider-neutral staging boundary for separately consented customer, lead, job, appointment and issued-estimate evidence. It supports bounded historical backfill and continuous updates through independent cursor chains. Every immutable page pins the exact schema, source, source-permission revision and digest, cursor, request identity and normalized record versions. Pages contain at most 100 records and validate each distinct IANA time zone once before storage.

Every active record preserves an opaque external identity, exact source version, record class, explicit type-appropriate state, opaque related references, event and source-update times, evidence class and provider evidence digest. `unknown` is a valid recorded state and never becomes a guessed outcome. Records remain visibly `unmatched` until the separate Part 12E reviewed reconciliation authority exists. Higher source versions append corrections. Same-version content conflicts fail closed. Tombstones retain only identity, version, removal state and source-update time.

Source permission is owner or administrator controlled and current-period specific. Revocation hides all staged detail and blocks new imports. A later grant starts empty cursor and record lineage and cannot revive records from an earlier period; the same provider version appears only after an explicit new-period import. Runtime receives only four guarded entry functions; protected tables and projection helpers remain withheld. This slice stores no provider credentials or provider account identity, calls no provider, performs no fuzzy matching and changes no customer, lead, job, appointment, estimate, dispatch, schedule, invoice, payment, provider record or company policy. Project/change-order, communication, finance, reconciliation, outcome, calibration, lifecycle and Learning Center work remain mandatory Slices B-K.

Slice A passed independent exact-head acceptance at `1be699f1fc855d2570df9f9930d3a78667a1990e` with no P0-P3 findings.

## Part 12 Slice B candidate — provider-neutral project and change-order imports

Migration `114_canonical_external_project_change_order_import_authority.sql` adds separately consented, tenant-private staging for external project and change-order evidence. Exact immutable pages support historical backfill and continuing updates with independent cursor chains, a 100-record maximum, deterministic replay and source-scoped concurrency serialization.

Every project retains its original contract and current contract as independent evidence. Every change order retains a separate change-order value, explicit increase/decrease/no-change effect and exact project lineage. A value is recorded with its exact decimal string and currency or explicitly unavailable. The importer does not derive a contract delta, sum change orders, convert currency, infer approval, or replace a missing value. Project and change-order lifecycle states are validated independently and retain explicit `unknown`.

Corrections require a higher provider version and append history; tombstones retain no contract or business detail. Revocation hides the current permission period and blocks imports. Regrant starts empty cursors and record lineage and cannot revive earlier evidence. Runtime can call only four guarded owner/administrator entries. The slice calls no provider, performs no reconciliation or learning, and changes no NorthStar operating or financial record. Communications, finance, reviewed reconciliation, outcomes, calibration, lifecycle and Learning Center work remain mandatory Slices C-K.

Slice B passed independent exact-head acceptance at `ff26d626b0ac111d93ed43fb641465cd4d0995c2` with no P0-P3 findings.

## Part 12 Slice C candidate — provider-neutral communication evidence imports

Migration `115_canonical_external_communication_import_authority.sql` adds separately consented, tenant-private staging for external communication, delivery and satisfaction evidence. Historical and continuing pages preserve exact source, permission period, cursor, request, record version, event time, time zone and provider evidence lineage with a 100-record maximum and deterministic replay under concurrency.

Communication records retain channel, direction and an explicit intent claim. Delivery records retain a delivery state without becoming proof of intent, satisfaction, estimate acceptance, completion or payment. Satisfaction records require explicit customer feedback or human review of explicit customer feedback; provider sentiment classifications are rejected as satisfaction evidence. Provider-classified intent remains clearly sourced and does not become a verified customer outcome. Missing evidence stays unavailable or unknown. The schema retains no message content or customer contact details. All external identities and relationship references must be source-scoped, non-reversible tokens in the exact shared `ref_` plus 64-lowercase-hex representation; cursors use `cur_` plus 64 lowercase hexadecimal characters. Node and PostgreSQL both reject raw or content-bearing values before immutable storage. Claim objects use an exact allowlisted shape, and stored time zones must match the PostgreSQL 17 catalog captured during the unreleased authority migration, including for direct table writes.

Corrections require a higher provider version and append immutable history. Tombstones retain no communication or relationship detail. Revocation hides the current period and blocks imports; regrant starts empty cursors and record lineage and cannot revive earlier evidence. Runtime can call only four guarded owner/administrator entries. This slice calls no provider, reconciles no reference, calculates no customer-response outcome and changes no NorthStar operating, communication or financial record. Finance imports, reviewed reconciliation, observations, calibration, lifecycle and Learning Center work remain mandatory Slices D-K.

Slice C passed independent exact-head acceptance at `8a238ba1f0f95fbcee44ae9cedcaabe6d8edbe2a` with no P0-P3 findings.

## Part 12 Slice D candidate — provider-neutral external financial evidence imports

Migration `116_canonical_external_financial_import_authority.sql` adds a separate tenant-private staging boundary for external invoice, payment, collection and accounting-entry evidence. Historical and continuing pages preserve the exact source, current permission period, cursor, request identity, provider record version, event time, time zone and evidence digest. Pages are capped at 100 records, exact request replay is deterministic, and one source-scoped transaction lock serializes permission and import changes.

The four record classes remain independent. A paid invoice state does not create a payment record; a payment does not prove collection status or accounting treatment; a collection event does not create revenue; and an accounting entry does not become an invoice, payment or collection. Every amount claim is either explicitly unavailable or records one exact nonnegative decimal string, three-letter currency and class-specific basis. The authority does not calculate balances, tax, revenue, costs, profit, margin or exchange rates and performs no aggregation or currency conversion.

Every external identity and relationship reference uses the shared source-scoped `ref_` plus 64-lowercase-hex representation, cursors use `cur_` plus 64 lowercase hexadecimal characters, and direct table constraints preserve the same rules. No customer name, contact detail, memo, description, line item, account number, routing number, card number or message content is retained. Records remain visibly unmatched until Slice E. Corrections require a higher external version; tombstones retain no financial detail. Revocation hides a permission period, and regrant cannot revive its records.

Runtime receives only four guarded owner or administrator entries. This slice calls no provider, uses no credentials, reconciles no reference, calculates no outcome and changes no customer, lead, job, appointment, estimate, dispatch, schedule, invoice, payment, collection, accounting record, provider record or company policy. Native NorthStar billing and accounting records remain unavailable until Mission 27. Reviewed reconciliation, observations, calibration, lifecycle and Learning Center work remain mandatory Slices E-K.

Slice D passed independent exact-head acceptance at `ffd9b73cc377daa2f1daf1dbc510adf4caa356a5` with no P0-P3 findings.

## Part 12 Slice E candidate — reviewed external business reference reconciliation

Migration `117_canonical_external_business_reconciliation.sql` adds immutable owner or administrator reviewed links for the current permission period of each accepted Part 12 source class. Customer references link only to a same-tenant canonical customer. Job, estimate, project, change-order, invoice, payment, collection and accounting-entry references link only to the exact owning canonical estimate. Execution references link only to a same-tenant field execution. Linking external financial references to an estimate supplies job lineage; it does not create a NorthStar invoice, payment, collection or accounting record, which remain unavailable until Mission 27.

Every link pins its source class and key, current consent identity, revision and digest, the complete current record manifest for the exact external reference, and the current target manifest and digest. Corrections, tombstones, source-permission changes and target changes make a prior link stale. Revocation hides the projection and blocks writes. A later grant begins an empty source period and cannot revive imported evidence or links from an earlier period. Unlinking appends an immutable revision.

The guarded API exposes only safe, distinct company labels for customers, estimates and current work. Ambiguous or unsafe labels are unavailable until company records are clearer; opaque target identities remain submission values. The service never guesses from names or similar text, calls no provider and changes no customer, job, estimate, execution, project, change order, financial record, schedule, price or policy. Outcome observations, calibration, lifecycle and the rendered Learning Center remain mandatory Slices F-K.

## Part 12 Slice F candidate — reviewed customer outcomes

Migration `118_canonical_external_customer_outcomes.sql` adds separate current-period permission and immutable observations for one exact canonical estimate using one current reviewed CRM estimate reference and one current reviewed communication estimate reference. Every observation pins both source-permission periods, both current Part 12E reviewed links, the current NorthStar estimate basis, the complete relevant CRM and communication record manifests, calculation version and request identity.

Lead, appointment, issued-estimate and customer-response outcomes are evaluated independently. The single current issued-estimate record is the exact source anchor for its recorded lead and appointment references. Missing references, no current record, duplicate current records or an ambiguous latest customer response make only that dimension unavailable. A customer response requires current inbound customer-explicit or human-reviewed intent, or explicit customer satisfaction evidence. Delivery state and provider-classified intent remain evidence but never become a verified customer response. Recorded `unknown` remains `unknown`.

Corrections, tombstones, source-permission changes, purpose-permission changes, reviewed-link changes and NorthStar target changes stale and mask prior advice. Revocation hides and blocks derived history, and granting either source again does not revive earlier observations or purpose permission. The result is advisory and changes no customer, lead, appointment, estimate, schedule, price, message, imported source record or company policy. Scope, project, financial, calibration, lifecycle and Learning Center work remain mandatory Slices G-K.
