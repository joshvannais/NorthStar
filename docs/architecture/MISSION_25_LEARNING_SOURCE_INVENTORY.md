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
| External historical and continuous sources | Future provider-neutral connectors | Older and ongoing CRM, fleet, accounting, payroll, fuel, routing, procurement and communications outcomes | Not implemented. Requires source-specific consent, schema/version, cursors, dedupe, provenance, freshness, reversibility and deletion. |

## First runtime adoption criteria

The first runtime package should choose one narrow, already released, outcome-bearing source set with an exact business decision it can improve. It must include both its estimate/baseline side and actual/outcome side, current purpose consent, immutable observation lineage, correction/tombstone propagation, a deterministic advisory comparison and a human adoption boundary. It must not begin with a generic score, opaque model, dashboard-only mockup or cross-tenant corpus.

## Released labor-duration contract

Migration `083_canonical_labor_outcome_learning.sql` and `/api/v1/learning` implement that first narrow adoption. The baseline is the current adopted Mission 24 labor plan. The outcome is the complete set of current Mission 23 labor intervals for the linked completed execution; every non-break interval must be accepted, and breaks are retained in lineage but excluded from worker-hour totals. `canonical_labor_outcome_observations.source_manifest` pins every source identity, revision and digest used by algorithm `labor_duration_variance_v1`.

The comparison reports planned worker hours, recorded worker hours excluding breaks, absolute and percentage variance, and one deterministic advisory band. It is available only to current owners and administrators with active consent. A later source correction changes the live source digest and makes earlier advice unavailable until a new observation revision is recorded. Consent revocation prevents observation and suppresses derived history from runtime reads. No result is automatically adopted by estimating, scheduling, workforce or business-profile authority.
