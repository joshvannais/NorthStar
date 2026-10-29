# Mission 28 Part 12A — tenant-private action queue contract

## Status and authority

Part 12A is an implementation candidate only. It freezes the bounded grammar for tenant-private owner and assigned-staff tasks, alerts, approval requests, failure work, follow-up queue items, and one owner-only collection work item. It consumes the released Part 1D launch matrix, Part 3A actor/session/membership capability matrix, the Part 4A–4D exact source snapshot and authoritative-head contracts, and preserves the exact released Part 11A–11F collection authority chain. A source fact, queue label, role name, assignee, or capability string never creates authority.

Part 11F is production-accepted at source `83399ffce66b32497221554c0dd839e27403d454`, tree `48c9944659282a5aea106c2cbbc625759552cb5e`. Its fresh isolated root audit returned P0=P1=P2=P3=0 under exact Node 22.23.3: focused 16/16, Parts 11A–11F 6 suites/90 tests, cumulative Mission 28 50 suites/692 tests, migration/history 2 suites/40 tests, syntax 50/50, JSON 49/49, 283 migrations through 287/no288, 54 docs/tests paths, protected paths 0, clean diff and exact clean remote. PR #598 normally merged at `2026-10-29T19:40:39Z` to main `aea7f65174923b9328dae9454ad2f9a351fe09a4`. Sole deployment `fdfcea4e-b515-4551-91e8-ce9b160adea3` is `SUCCESS`; service instance `7ee4f747-38c2-4baa-a024-1d7db6e7c218` and deployment instance `e16b9ccd-34fb-4f27-88fc-cb114ef42bcc` are `RUNNING`; image `sha256:fa4a1641a43db1959172002d4146ec580db6d8ccb9edcbf4d27ff7040a41567f`. Canonical startup is ready; `/api/health` is HTTP 200 with PostgreSQL and canonical persistence healthy; `/`, `/dashboard`, and `/demo/` are HTTP 200; dashboard/demo exact 91,681-byte SHA-256 `b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369` parity passed. Direct applied production migration history remains unavailable and unclaimed.

## Exact source and capability boundary

Every candidate binds one exact Part 4A trigger row and source class, one immutable Part 4B active snapshot, and the exact Part 4D authoritative head whose effective snapshot ID and digest equal that snapshot. Snapshot lineage sequence and predecessor, head transition identity/digest/sequence, event kind/time, trusted observation time, and `latest_exact_current` state are inseparable. Event or observation time never establishes precedence. Stale, mixed, unavailable, tombstoned, reversed, replaced, corrected, ambiguous, non-head, cross-lineage, or cross-tenant material fails closed.

The trigger must permit the requested action family, and that family/source/role/capability/recipient combination must be one exact Part 1D launch binding. The creator is one exact active same-tenant actor, session subject, and membership subject. Visibility independently binds one exact active same-tenant viewer actor, session subject, membership subject, capability-decision identity/digest, role, and Part 3A `automation_view` record scope. An assigned-staff viewer must be the exact assignee actor and membership; owner/admin tenant-wide visibility and member assigned-record-only visibility remain distinct. The assigned-record identity is the exact source snapshot identity and is independent of the request/projection identity, so changing a request ID cannot silently change staff scope or stable idempotency. Staff is view-only. Approval requests do not create approval. Collection work requires the exact reviewed Mission 27 collection handoff, the owner role, and the collection-work capabilities.

## Queue material

The closed queue kinds are `owner_task`, `staff_task`, `alert`, `approval_request`, `failure_work`, `follow_up_queue_item`, and `collection_owner_work_item`. Each has a fixed action family, creator capability, recipient class, assignee role set, reason-code set, and priority set. The assignee is an exact active same-tenant membership subject. The due window is bounded from trusted `evaluatedAt`; there is no default clock or inferred due date. The source link is an opaque internal identity/digest tuple, never a URL, customer data, message, or free text.

Completion evidence is explicitly `unavailable_no_accepted_completion_authority`; its record ID, digest, actor, and time are null. Part 12A does not reinterpret view permission as completion authority. A later accepted completion record must be independently authorized and cannot rewrite this source material.

Material, request, and stable semantic idempotency digests remain separate. Evaluation time and request identity do not change the stable semantic digest. Exact replay is idempotent; a same-ID material conflict or a new-ID semantic clone is denied. A source correction produces new exact snapshot/head material and never silently rewrites history.

## Current result and no-effect boundary

No mounted action-queue persistence or accepted runtime capability/record-scope resolver exists. The only current result is:

- state: `tenant_private_action_queue_unavailable_no_mounted_authority`
- reason: `accepted_creation_completion_and_persistence_authority_unavailable`
- label: `Internal action queue unavailable — complete current authority is not mounted`

No queue record, task, alert, approval request, failure-work record, follow-up record, completion evidence, message, provider attempt, external effect, upstream mutation, accounting/financial change, or money effect is created. This is an owner-readable contract and test boundary, not fake success.

Part 12B reviewed Mission 25/26 handoffs, Part 12C queue lifecycle/dedupe/reassignment/correction behavior, Part 12D drilldown, real providers/recipients, private-production evidence, professional review, hosted load/SLA, physical devices, manual assistive-technology review, and founder visual approval remain unavailable and unclaimed.
