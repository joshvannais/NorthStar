# Mission 28 Part 4D — deterministic fact precedence

Status: **Implementation candidate only.** This slice freezes the deterministic coalescing, lineage, state-transition, and concurrency contract for accepted source facts. It adds no migration and mounts no resolver, route, UI, evaluator, scheduler, worker, queue, provider, recipient transport, upstream mutation, accounting action, or money movement.

The normative executable contract is [MISSION_28_PART4D_FACT_PRECEDENCE_CONTRACT.json](MISSION_28_PART4D_FACT_PRECEDENCE_CONTRACT.json). It consumes the released Part 4A catalog, Part 4B immutable snapshot lineage, and Part 4C two-stage currentness contract without copying or widening upstream authority.

## One lineage, one authoritative head

A lineage is exactly one tenant, trigger, record-identity digest, and event kind. Its transition history is append-only. Every transition binds one exact stored Part 4B snapshot and separately server-resolved disposition. Candidate data, cloned objects, aliases, caches, timestamps, transport order, or recomputed digests cannot choose an operation or head.

`original`, `correction`, `tombstone`, `reopen`, `reverse`, and `replace` form a closed state machine. The first transition is an original Part 4B sequence-one snapshot. Every later transition is the next exact Part 4B correction and binds the current transition ID, digest, sequence, state, and effective snapshot. Tombstone and reversal make the lineage ineligible. Reopen and replacement require a new snapshot identity and digest; neither may resurrect or alias an old snapshot. A replacement makes only its new exact snapshot effective.

Event time and trusted observation time remain evidence, not precedence. A late or reordered candidate that does not name the exact current head is historical-only and cannot change eligibility. Equal timestamps have no tie-breaker. Missing, ambiguous, forked, or conflicting lineage fails closed.

## Coalescing and concurrency

Exact same-ID replay returns the original immutable transition evidence plus a fresh authoritative-head read. A new transition ID coalesces only when its complete lineage, operation, sequence, snapshot, predecessor, target, and trusted-disposition material is exact; it then returns the existing evidence and fresh head. Neither result is a currentness or eligibility decision, including when the stored transition is no longer the head. Reusing an identity or digest for different material is a conflict.

The future runtime must serialize by tenant, trigger, source class, record identity, and event kind. It must reread the head and compare-and-swap the complete predecessor binding inside one database transaction. Concurrent different candidates have one winner; the loser rereads and fails stale. Concurrent exact duplicates return the same coalesced evidence plus the newly read head, never eligibility. Rollback leaves neither a partial transition nor a changed head. No cache, request-local object, alias, clone, or replay token is authority.

## Currentness and effect boundary

Only an active head may be offered to Part 4C. Evaluation binds the exact Part 4D head and effective snapshot; immediately-pre-effect revalidation must reread that head. Any correction, tombstone, reopen, reversal, replacement, or concurrent advance invalidates the earlier decision and requires a new evaluation.

A current fact head remains evidence only. It does not grant eligibility, approval, scheduling, provider, recipient, external-effect, upstream-mutation, accounting, or money authority. Part 5 owns rule evaluation. A future slice must implement and independently validate the transactional resolver before any runtime consumer exists.

## Evidence boundaries

Part 4D leaves production at 270 migrations through 274/no275. Mounted precedence resolution, database lock/restart execution, provider sandbox/private production, real recipients or messages, upstream/accounting/money effects, professional legal/privacy/provider review, hosted load/SLA, physical devices, manual assistive technology, and founder visual approval remain unavailable and unclaimed.
