# Mission 28 Part 4A — closed trigger catalog

Status: **Implementation candidate only.** This is a source contract. It does not implement trigger ingestion or resolution, source snapshots, persistence, routes, UI, rules, scheduling, queues, workers, providers, recipients, messages, external effects, upstream mutation, or money movement.

The normative executable catalog is [MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json](MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json). It binds 19 trigger types to the accepted Missions 20–27 source authorities. A catalog row says only that one exact current upstream fact may later be evaluated by a separately accepted Mission 28 policy. Catalog membership is never action authority.

## Closed-world rule

- Unknown trigger IDs and unknown source classes are denied.
- Every trigger identifies its exact tenant-private grain, source authority and source-code anchors, a closed upstream event-kind map, distinct Mission 28 observation time, exact currentness pins, allowed action families, and ownership boundary.
- Each accepted event kind selects exactly one named source-owned occurrence/effective-time field and one exact source-state selector. There is no fallback or precedence between alternative fields. Missing, unknown, duplicate, or simultaneously ambiguous candidates fail closed; distinct source events remain distinct observations.
- Event time is the selected upstream business occurrence or effective time. Observation time is a later trusted Mission 28 capture time and remains unimplemented until Part 4B. Neither may silently substitute for the other.
- Missing, stale, mixed, unavailable, fixture, cross-tenant, corrected, partially current, or unsupported source authority fails closed.
- Corrections append new evidence. They never rewrite prior evidence or silently grant action authority.

## Catalog coverage

| Owner | Trigger facts |
| --- | --- |
| Mission 20 | Lead/contact state; tenant communication-preference state |
| Mission 21 | Reviewed published knowledge version |
| Mission 22 | Appointment state; assignment/dispatch state |
| Mission 23 | Reviewed work progress; completion/reopening state |
| Mission 24 | Commercial revision; issued quote version; customer quote response/expiry/revocation |
| Mission 25 | Current reviewed outcome summary; current reviewed recommendation |
| Mission 26 | Reviewed advisory handoff |
| Mission 27 | Invoice lifecycle; receivable due/aging; payment/receipt/settlement; refund/dispute/correction; offline cash/check; reviewed collection handoff |

The released Part 1D matrix currently permits these facts to make only `internal_read_digest_task` and `owner_approval_request` evaluable. The exact reviewed Mission 27 collection handoff may additionally make `collection_escalation` evaluable, but only as the already-defined owner-only internal work item. Customer communication, secure document delivery, financial reminders, and upstream mutation or money movement remain unavailable.

## Time and currentness

Each row contains a closed event-kind map. The event kind, selected event time, and exact source-state selector are part of the source binding. A future Part 4B observation must resolve one supported kind, read only that kind's named source field, and carry a distinct trusted `observedAt` plus exact tenant, grain, identity, version/revision, digest, and state pins. A source event may never be selected by field-presence fallback or precedence; more than one candidate for one observation is ambiguous and denied. For multi-source facts, every member must be exact current and from the same tenant. Elapsed time, provider arrival order, prediction, recommendation, fixture state, content generation, or a source read by itself cannot create a trigger fact or action permission.

## Important boundaries

- Mission 20 owns business, lead, contact and preference truth.
- Mission 21 owns reviewed knowledge and publication.
- Mission 22 owns appointment, assignment and dispatch truth.
- Mission 23 owns work execution, completion and reopening truth.
- Mission 24 owns pricing, commercial approval, quote versions and customer responses.
- Mission 25 owns tenant-private learning and evidence quality; recommendations remain advice.
- Mission 26 owns forecasts, uncertainty and reviewed advisory handoffs; predictions remain advisory.
- Mission 27 owns invoice, receivable, payment, refund, dispute, settlement, offline-payment and collection truth.

Part 4B owns durable source snapshots and correction lineage. Part 4C owns evaluation-time and pre-effect revalidation. Part 4D owns duplicate, replay, reorder, correction, tombstone and concurrency behavior. Part 5 and later own rules and execution. None is implemented by Part 4A.

## Evidence and unavailable gates

Part 3D was independently accepted P0=P1=P2=P3=0 at source `797be4a33bb2128ae2efd79b5347ef43f94da0f6`, merged through PR #560 to main `041971bb190998e1444087482941686c4166573d`, and released by deployment `7e0ef15f-1275-4578-aade-70b8c8277bef` (`SUCCESS/RUNNING`, image `sha256:b631fefb559f09cdb3073a80bdd8051487a6e0478bd07606705903af41174595`). The audit report hash was not supplied to this writer and remains unclaimed.

Runtime trigger capture, provider sandbox/live evidence, real recipients/messages, private-production trigger data, hosted load/SLA, professional legal/privacy/provider/regulatory review, and founder visual approval are unavailable and unclaimed.
