# Mission 28 Part 10C — Work-state communication boundary

Status: **Implementation candidate only.** Part 10B is released. This contract adds no route, queue, worker, provider, recipient, message, task, notification, work mutation, evidence mutation, external effect, or money authority.

## Exact Mission 23 source boundary

Part 10C consumes only two trigger rows frozen by Part 4A and their exact Part 4B snapshots:

- `m23.work_progress_state` has grain tenant, execution, and progress record. A supported progress or blocker request pins exact execution and progress revisions/digests, the `progress_observed` event and source time, accepted review state, snapshot, source set, currentness resolution, and original lineage.
- `m23.work_completion_reopening_state` has grain tenant, execution, and assignment. A supported completion or reopening request pins exact execution and assignment revisions/digests, the immutable completion decision record, action, lifecycle state, event and decision time, snapshot, source set, currentness resolution, and original lineage.

Those facts never grant customer-communication permission. Progress evidence cannot complete work. Completion evidence cannot approve billing. Reopening is an exact newer state that invalidates any older completion projection; it is not silently treated as completion.

Part 4A does not currently expose an accepted customer-safe trigger for work-started, ready-for-review, or aftercare communication. `in_progress`, `completion_pending`, a completed quantity, a milestone, elapsed time, a note, or a prediction cannot manufacture one.

## Closed results

| Request | Required exact source | Current result |
|---|---|---|
| Work started | accepted customer-safe work-started trigger | unavailable; source fact not supported |
| Work progress | latest reviewed progress record | unavailable; communication authority not launched |
| Work blocked | latest reviewed open/investigating/awaiting blocker or exception | unavailable; communication authority not launched |
| Ready for review | accepted customer-safe review-ready trigger | unavailable; source fact not supported |
| Work completed | latest `completion_approved` / `approve_completion` decision with lifecycle `completed` | unavailable; communication authority not launched |
| Work reopened | latest `work_reopened` / `reopen_execution` decision with lifecycle `reopened` | unavailable; communication authority not launched |
| Aftercare | accepted customer-safe aftercare trigger | unavailable; source fact not supported |

Every label is fixed, owner-readable, and nonreflective. No request creates a message, worklist record, task, notification, provider attempt, or external effect.

## Privacy and truth

Raw work descriptions, internal notes, worker identity or contact data, blocker details, costs, margins, quantities, predictions, and uncertain completion evidence are rejected rather than copied, summarized, or redacted after use. A supported source proves only the fixed state named above. It does not establish customer-safe free text, urgency, outcome, recipient, channel, provider, or delivery evidence.

Every source value is ordinary plain data with an exact key set. Tenant, execution, assignment, progress/completion record, revisions, digests, event kind/time, review/action/lifecycle state, snapshot, source set, currentness, lineage, actor, session, membership, launch matrix, and communication basis must resolve independently and agree exactly. Missing, unreviewed, stale, mixed, unavailable, corrected, tombstoned, superseded, substituted, cross-tenant, cross-record, or ambiguous material fails closed.

The semantic idempotency digest excludes only projection identity, evaluation time, and digest fields. Reusing the same semantic material under another identity or time is clone/replay reuse and is denied. A genuine new exact source fact requires new coherent revisions, digests, snapshots, source-set and currentness evidence.

## Evidence boundary

Part 1D still has no accepted external customer-communication launch cell, and Part 7B still resolves external communication authority as unavailable or suppressed. No migration 288 is added; migration 287 remains latest. Direct applied migration-history re-query, private-production data, provider sandbox/live evidence, real recipients/messages, outcomes, legal review, hosted load, exercised restore, physical devices, manual assistive technology, and founder visual approval remain unavailable and unclaimed.

Part 10D and all later slices remain planned and unimplemented.
