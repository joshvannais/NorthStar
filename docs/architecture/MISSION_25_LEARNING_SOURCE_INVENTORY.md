# Mission 25 learning source inventory

This inventory distinguishes released source authority from future learning consumption. Table and route names identify implementation evidence; they do not grant learning permission.

| Source class | Released authority | What it may eventually support | Current Mission 25 disposition |
| --- | --- | --- | --- |
| Business profile and policies | Mission 20 organization profile, workforce, locations and assets | Baseline hours, rates, capacity, crew and asset policies | Source owner only; no automatic learning update. |
| Reviewed shared knowledge | Mission 21 registry/publication/provenance/sync | External capability and terminology context | Shared knowledge is not tenant outcome evidence. |
| Native customer and call graph | `canonical_customers`, transcripts, facts, communications, opportunities, appointments and voice sessions | Customer intent, requested scope, evidence provenance, lead disposition and call-to-job reconciliation | Transcript/fact confidence and exact source spans remain distinct from verified onsite or outcome facts; communications do not become satisfaction labels by default. |
| Schedule, assignment and dispatch | `canonical_schedule_assignments`, approvals, revisions, audit events and human approvals | Planned start/end, crew assignment, dispatch and schedule-versus-actual comparisons | Mission 22 retains authority; availability/conflict and route recommendation evidence must stay distinct from actual arrival, travel and work time. |
| Labor/time | `canonical_labor_intervals`, events and revisions | Planned-versus-actual labor and duration | First runtime source released for completed paid-tenant jobs: accepted non-break intervals may be compared with one adopted labor plan under current explicit purpose consent. Corrections stale the advice; revocation hides it. Worker privacy and employment conclusions remain bounded. |
| Materials/inventory | `canonical_material_movements`, events and revisions | Planned-versus-used quantity, waste and cost | Movements are evidence, not procurement price or stock valuation unless the exact source says so. |
| Equipment/vehicles | equipment asset versions, ledgers and events | Utilization, downtime, condition and operating variance | Private tenant evidence; shared equipment research remains separate. |
| Field progress/evidence | Mission 23 progress, field evidence and change facts | Scope change and execution-context variance | Preserve evidence type and source; never infer compliance or quality from activity alone. |
| Completion/reopening | `canonical_completion_records` and events | Outcome window and final operational state | Completion is not payment, profit, satisfaction or absence of later correction. |
| Downstream handoffs | `canonical_handoff_receipts` | Exact source-set discovery | Receipt is not learning access; current source permission and Mission 25 purpose consent are still required. |
| Estimate lineage and costs | canonical estimates, revisions, material/labor/equipment/travel/cost plans | Prediction baseline and cost-component variance | Historical estimates stay immutable; calibration produces a separate proposal. |
| Human price and commercial approval | estimate decisions, pricing policy, commercial terms/approvals | Approved scope/price/policy baseline | Human approval remains Mission 24 authority. |
| Issued estimate and customer response | customer estimate versions, delivery links/events | Exact quote accepted, questioned, revoked or expired | Acceptance is not job completion or collection. Questions are communications, not training labels by default. |
| Native invoice/payment/collection | Mission 27 future authority | Revenue, collections and realized margin evidence | Unavailable until Mission 27 supplies explicit compatible authority. |
| Compatibility `/polaris/learning` | Current Polaris snapshot projection | Read compatibility only | No outcome learning, training or calibration claim. |
| Demo workspace | Isolated fictional session state | Product demonstration | Never contributes to paid-tenant or aggregate learning. |
| External historical and continuous sources | `canonical_external_labor_import_consents`, `canonical_external_labor_import_runs`, `canonical_external_labor_import_records`, `canonical_external_labor_import_reference_matches`, `canonical_external_labor_import_learning_consents`, `canonical_external_labor_import_outcome_observations`, source-operation revisions and guarded external-labor routes | Older and ongoing CRM, fleet, accounting, payroll, fuel, routing, procurement and communications outcomes | Provider-neutral normalized labor/time envelope, reviewed worker/job reconciliation, separately consented imported labor-duration outcomes and multi-job calibration are released. The Owner Learning Center adds CSV backfill, provider-neutral adapter lifecycle, checkpoints, retention and bounded deletion cleanup. Corrections, tombstones, match changes and revocation stale or hide derived advice. Provider-specific adapters and other source classes remain unimplemented. |
| External travel evidence | `canonical_external_travel_import_consents`, `canonical_external_travel_import_runs`, `canonical_external_travel_import_records` and guarded external-travel routes | Route duration, mileage, fuel quantity and fuel cost estimate-versus-actual outcomes | Part 9 Slice A candidate stages normalized, consented evidence with explicit units, currency, time zone and evidence class. Missing dimensions remain unavailable. Job/vehicle reconciliation, observations, calibration, source operations and owner UI remain required before Part 9 release. |

## First runtime adoption criteria

The first runtime package should choose one narrow, already released, outcome-bearing source set with an exact business decision it can improve. It must include both its estimate/baseline side and actual/outcome side, current purpose consent, immutable observation lineage, correction/tombstone propagation, a deterministic advisory comparison and a human adoption boundary. It must not begin with a generic score, opaque model, dashboard-only mockup or cross-tenant corpus.

## Released labor-duration contract

Migration `083_canonical_labor_outcome_learning.sql` and `/api/v1/learning` implement that first narrow adoption. The baseline is the current adopted Mission 24 labor plan. The outcome is the complete set of current Mission 23 labor intervals for the linked completed execution; every non-break interval must be accepted, and breaks are retained in lineage but excluded from worker-hour totals. `canonical_labor_outcome_observations.source_manifest` pins every source identity, revision and digest used by algorithm `labor_duration_variance_v1`.

The comparison reports planned worker hours, recorded worker hours excluding breaks, absolute and percentage variance, and one deterministic advisory band. It is available only to current owners and administrators with active consent, and each observation retains an explicit confirmation and confirmation-contract version. A later source correction changes the live source digest and makes earlier advice unavailable until a new observation revision is recorded. Consent revocation prevents observation and suppresses derived history from runtime reads. A later re-grant can produce a new consent-bound observation from otherwise unchanged sources. No result is automatically adopted by estimating, scheduling, workforce or business-profile authority.

## Released external-labor import contract

Migration `084_canonical_external_labor_import_authority.sql` accepts only schema `m25-external-labor-time-v1`. A source is a tenant-owned opaque key rather than a vendor name baked into the schema. Historical pages and continuous updates use separate cursor chains. Batches contain at most 100 normalized records and preserve source record identity, version, source update time, work interval, category, opaque worker/job references, consent and immutable run lineage. Exact duplicate versions are counted without creating another record. A same-version payload conflict or older version fails closed. A newer version creates an immutable correction; a tombstone creates a detail-free current record.

The current projection is available only while that source's consent is active. It masks tombstoned work details and labels the records as staged evidence. No current record becomes a Mission 23 labor interval and no labor-duration advisory consumes it. Reviewed worker/job matching, retention/deletion execution, provider credentials, CSV/browser experience and source-specific adapters remain later work.

## Released external-labor reconciliation contract

Migration `085_canonical_external_labor_reconciliation.sql` provides reviewed worker and job reference reconciliation by recording explicit owner or administrator links from current external worker and job references to current same-tenant workforce profiles and estimates. The current imported-record manifest and target basis are digested independently. Corrections, tombstones, profile changes and membership status changes therefore make a prior link stale instead of silently changing its meaning. Consent revocation hides the projection and blocks writes. These links are advisory lineage only; no imported record is yet eligible for an outcome observation.

## Released imported labor-duration outcome contract

Migration `086_canonical_imported_labor_outcomes.sql` makes current matched external labor records eligible for one narrow planned-versus-recorded worker-hour comparison. The business must grant a separate purpose consent while source consent is current. The job match must point to the estimate and every current worker reference must have a current match. The immutable observation pins all source records and reviewed links. It reports a deterministic variance advisory and never adopts a changed rate, plan, price, schedule or policy.

## Released multi-job imported labor calibration contract

Migration `087_canonical_imported_labor_calibration.sql` adds separately consented, tenant-private multi-job imported labor calibration proposals. Five to 100 current reviewed estimate-and-external-job outcome chains for one normalized service key form a pinned sample. Freshness precedes the sample cap, and candidate evaluation fails closed beyond a documented 10,000-chain bound. The deterministic median and quartiles describe recorded-to-planned worker-hour ratios, while a fixed five-percent band produces an advisory only. Corrections or consent changes stale the proposal and mask its recommendation; delayed exact-key retries retain that masking. No operational authority is mutated.

## Released Owner Learning Center projection

Migration `088_canonical_learning_center.sql`, `/api/v1/learning/center`, and the paid and isolated-demo Learning Center routes give owners and administrators one bounded inventory of native comparison consent and external source/service identities. The paid interface composes existing guarded source-detail, consent, reference-match and calibration reads and mutations; it does not select protected tables or copy their data into a parallel browser authority. The demo uses explicit read-only fictional records. Every calibration remains advisory and every operational adoption remains outside this interface.

## Released import operations contract

Migration `089_canonical_external_labor_import_operations.sql` adds immutable adapter, retention, deletion and cleanup-run lineage. The Learning Center accepts an exact bounded CSV page through the existing import authority and exposes provider-neutral lifecycle and checkpoints without retaining provider credentials. Retention and deletion append minimized tombstones in resumable batches. A deletion request revokes source consent immediately; no later import or derived read remains available unless the owner cancels the request and separately grants new consent.

## Part 9 Slice A candidate — normalized travel evidence

Migration `090_canonical_external_travel_import_authority.sql` accepts only `m25-external-travel-actual-v1`. Active records identify one opaque job and vehicle, exact route timestamps, an IANA time zone, evidence class and at least measured distance or fuel. Every present amount carries an explicit unit; fuel cost carries a currency or remains unavailable. This is staged source evidence. It is not a reconciled NorthStar job, asset, route, operating cost or estimate outcome until later reviewed authorities pin those links.
