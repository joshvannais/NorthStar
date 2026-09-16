# Mission 25 — Tenant-private outcome learning

Objective: let each business improve its own operating assumptions from authorized historical and future outcomes without converting predictions into facts or one contractor's data into another contractor's knowledge.

Mission 25 consumes exact references from accepted NorthStar authorities and authorized provider-neutral imports. It does not replace the source records. Mission 20 continues to own business profile and operating policy; Mission 21 owns reviewed shared knowledge; Mission 22 owns scheduling, dispatch, assignment, availability and route recommendations; Mission 23 owns actual field execution; Mission 24 owns estimates and customer-facing price; Mission 26 owns forward-looking business predictions; Mission 27 owns invoices, payments and collections; Mission 28 owns automation.

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

No fixed implementation-part count is declared by this package. Later packages must state the exact source class, consent, correction/deletion behavior, derived output and release evidence they add. Completion requires usable roadmap-designated historical-backfill and continuous-update integrations; placeholder connectors and sample cards are insufficient.

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
