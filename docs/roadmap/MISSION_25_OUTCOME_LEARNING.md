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
| 8 | Usable import operations: CSV backfill, continuous adapter lifecycle, checkpoints, retention and deletion orchestration | In progress |
| 9 | Travel, routing, mileage and fuel estimate-versus-actual outcomes and calibration | Planned |
| 10 | Vehicle and equipment utilization, operating cost, maintenance and downtime outcomes and calibration | Planned |
| 11 | Materials, inventory, purchasing, vendor cost and waste outcomes and calibration | Planned |
| 12 | CRM, field-service, project/change-order, communications and external financial outcome reconciliation | Planned |
| 13 | Cross-source job outcome graph and explicit owner adoption into the owning business-profile or planning workflow | Planned |
| 14 | Complete demo/paid experience, recovery and migration proof, accessibility/responsive review, independent audit and mission acceptance | Planned |

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
