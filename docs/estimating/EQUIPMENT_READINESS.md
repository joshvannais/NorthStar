# Equipment readiness — Mission 24 Part 4 Slice 3

This is the final of three planned equipment slices. Candidate behavior below is not a production-release or independent-acceptance claim.

## Contract and authority

EquipmentReadinessPlan v1 records up to 12 equipment lines and 12 proposed alternatives in total. Each save binds the current Equipment Plan identity/revision/digest, selected estimate and original source pins, global human-decision write basis, preceding readiness revision/digest, exact assessment and explicit acknowledgment. History is immutable and capped at 20 entries. A withdrawal preserves all earlier evidence. Current owner/admin membership, session, tenant and CSRF remain mandatory before replay and after waits. The demo has separately bounded identity/history and uses the same validation/assessment.

The approved source contract is `m24-equipment-readiness-contract-a2f1de8/IMPLEMENTATION_CONTRACT.md` in the external writer evidence workspace (SHA256 c923d15268cb8c0a0d71f16f9350fbd5be7324e862697bb330da4158324b5fb0). Its source map is SHA256 465b2ebf41757bf963acb3ceb7cece81fca67bb103ab09c49a7a484461c94e99. These authorities remain immutable; the following are additive implementation clarifications approved in `M24_PART4_SLICE3_IMPLEMENTATION_DISPOSITION.md`.

## Meaning of the result

Quantity counts equipment items, never cost-allocation hours. Required and reported windows contain explicit instants and a timezone. Sources are human-recorded observation, company record or supplier/rental statement; none implies provider verification, reservation, certification or safety clearance. Unknown end dates remain unresolved. Reported lead time is measured from the source observation, with a day defined as 24 hours; it is not a delivery promise. Different location text requires confirmation rather than inferred geographic equivalence.

The complete effective 046 event fold supplies recorded checkout, downtime, fault, maintenance and meter evidence. Missing or incomplete history remains unknown. Maintenance does not clear a recorded fault. A reset affects only the same meter and makes a threshold comparison unresolved until a later reviewed observation. Same-unit decimal comparison is exact. Two overlapping requirements cannot each consume one identified physical asset; adjacent windows may use the same asset. Missing windows require review.

Open downtime, other-work or wrong-target checkout, stated out-of-service status, known quantity/window shortfall and supported requirement mismatch block the affected scheduling action. Missing facts require explicit review. The most positive result is **No Recorded Conflict For This Plan**, not available, safe or reserved. Saving a blocked planning record is allowed; it does not authorize scheduling or dispatch. Current published-private-source filtering applies to every projection; immutable stored evidence is not copied to ordinary responses after publication withdrawal.

## Alternatives and selected estimates

The drawer compares original and proposed identity, requirements, current reference, dates, condition/history, quantities/windows/restrictions and recorded cost before the action. An unknown proposed cost or difference is not zero. Replacement uses two deliberate saves: first an existing Equipment Plan revision, then a source-bound readiness review identifying the earlier readiness record, line and alternative. A reload between them shows Replacement Pending. No cost, approval or compatibility transfers automatically. Equipment Cost Plan/composer v2 remain the only equipment-cost adoption mechanism; changing a cost component requires renewed human review. The selected estimate keeps its existing source, material, labor and original travel components.

Polaris/saved estimate review and CAPELLA show current readiness context separately from adopted cost arithmetic. This slice does not implement travel pricing, customer quotes, external reservations, provider lookup, connected-call reasoning or outcome learning.

## Shared consumers and recovery

- `src/estimating/equipmentReadinessContract.js`: shared validation and deterministic assessment; SQL 069 mirrors the supported comparisons.
- `src/estimating/equipmentReadinessRepository.js`: protected paid snapshots, immutable writes and current projection.
- `src/commandCenter/demoEquipmentReadiness.js`: isolated demo evidence and history, with no paid impersonation.
- `src/scheduling/{conflictRepository,recommendationRepository,approvalRepository,equipmentReadiness}.js`: real conflict/candidate/preview/approval integration.
- `src/commandCenter/demoScheduling.js`: shared demo evaluator and current consent/pin behavior.
- `public/js/{customer-detail,saved-material-review,scheduling-approval-ui}.js`: human labels, current selected review and scheduling consequences.

069 adds an immutable readiness ledger and an internal organization/asset fence, extends the existing demo operation CHECK, and wraps the trusted scheduling review helper. All 66 previously applied migration files are unchanged. The 046 operational mutation successor has only a fence touch under its existing asset key and current actor/expiry rechecks after waits before replay/event. The existing 035 preview routine also receives exactly one actor-authority recheck immediately before its INSERT, after equipment waits. Its signature, grants, timestamps and consent semantics are unchanged. Approval already performs that post-review check. Exact body comparisons are required source checks. Ordinary read-only discovery does not touch the persistent fence. Actual scheduling mutation transactions and 046 writers serialize through it, including an absent-row fence insertion. The cleanup exemption requires current assigned to proposed unassigned with unchanged schedule state and null-safe start/end equality; scheduling or rescheduling already-unassigned work still checks readiness. Existing transition validation remains authoritative. Bounded transaction retries do not renew human consent or silently retry an uncertain HTTP action.

A source-controlled recovery build disables readiness, adoption and both paid/demo scheduling mutations; a combined build also disables human-decision mutations. Paid scheduling checks current actor/session/role/CSRF before its paused response. Both mounted scheduling POST routes use the gated shared repository; no other runtime caller invokes the protected SQL mutation entries. Paused mutation replay is rejected, with outcome-neutral guidance, while stored receipts/history and authorized GET reads remain available. An uncertain earlier request retains its exact key/body. Forward resume appends to history; rolling back to a reader that predates readiness is not the recovery plan.

New 069 DDL includes the demo CHECK ACCESS EXCLUSIVE lock and new-table foreign-key locks. Startup uses tighter-of-inherited 5-second lock and 20-second statement limits through commit/rollback. Local populated upgrade, ordinary contention, full rollback, apply-once, zero-op, paused reads and forward resume require actual execution. Prepared recovery trees must not be called executed. Production table sizes, other writers, backup cutoffs and physical restoration are not established by local fixtures; release requires a separate finite readiness disposition.

## Demo evidence and presentation

Only new/reset sessions receive the versioned simulated equipment examples. Old sessions/graphs/receipts are unchanged and retain unknown evidence. Practice holds name existing synthetic jobs and a current synthetic worker; they create no execution or Operations activity. Matching a job is not an exact execution match. Missing execution provenance remains Needs Review. An execution association can only come from validated canonical Operations history after explicit initialization. Other-job/target conflicts remain recorded conflicts.

The ordinary drawer uses compact native disclosures, paired desktop/stacked mobile alternatives, explicit item units, keyboard focus preservation and truthful loading/error/recovery states. Simulated equipment records are labeled outside caller dialogue. Final browser/navigation checks must inspect loaded data and private-path requests after the last navigation, not only destination shells. Founder visual approval is separate from browser-engine checks.

## Part 4 exit ownership

| Slice | Delivered contract | Remaining limitation |
| --- | --- | --- |
| 1 | Equipment identity/configuration, job requirements, reviewed reference/private knowledge pins | No universal industry expertise or safety certification |
| 2 | Declared owned/rented/financed costs and exact three-component adoption | No invented market rates, utilization or missing operating costs |
| 3 | Recorded readiness/alternatives and actual selected-estimate/scheduling consumers | No external availability, reservation or maintenance clearance |

Part 4 acceptance remains conditional on independent review and separately authorized release verification. The three-slice count is unchanged.
