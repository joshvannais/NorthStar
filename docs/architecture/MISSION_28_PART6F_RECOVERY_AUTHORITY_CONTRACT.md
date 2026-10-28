# Mission 28 Part 6F — durable recovery evidence without effect authority

Part 6F closes the bounded Part 6 restart and recovery contract. It records an owner-only, tenant-private assessment of one exact Part 6A transaction and every action unit in that run after a process restart, migration restart, worker crash, database outage, provider outage, partial callback, deployment restore, or explicitly unavailable disaster-restore drill. It does not restart a worker, publish a queue item, reclaim a lease, resend a provider request, infer an effect, or mutate Parts 6A–6E evidence.

## Exact separately trusted boundary

Each request binds one tenant, recovery and incident identity; one exact transaction/run/policy/source-set tuple; the exact bounded unit count; and one active same-subject actor/session/membership. The incident kind has one closed evidence state. Candidate material and a separately trusted resolution must match canonically. Candidate state, residue, result, history digests, provider outcomes and effect claims are not accepted as input.

The owner-only function resolves the transaction, every unit and outbox, any schedule, latest lease event, stable provider-request receipt, latest retry event and effective control event from PostgreSQL. It locks the accepted lifecycle/control/source authorities before resolving latest source heads. Any missing or mismatched immutable predecessor fails the complete request and leaves no recovery row. Cross-tenant, cross-run, cross-policy, cross-source and replayed material cannot create evidence.

## Closed recovery dispositions

- Unscheduled or queued evidence stays committed/unpublished. The assessment does not schedule or claim it.
- An active lease remains authoritative until its trusted expiry; the assessment cannot steal or fence it.
- An expired lease may only be reclaimed later through a new accepted Part 6C fence and all then-current authority.
- A retry schedule stays no-effect evidence and remains subject to Parts 6D and 6E.
- A reserved provider identity, partial callback, provider outage or uncertain retry state requires exact reconciliation with no resend.
- A permanent stop or reducing/terminal control is preserved exactly and never reopened.
- Stale or unavailable source lineage preserves history but blocks every authority increase.
- Disaster restore remains an explicit evidence gap. `restore_drill_unavailable` is not proof of a successful restore and grants no restored authority.

Every accepted assessment contains exactly one item for each Part 6A unit in canonical unit-index order. Closed item counts must sum to the transaction unit count. Exact replay returns the immutable historical assessment before re-reading later mutable heads; conflicting identity or cloned material with another recovery ID fails closed.

## Storage and exclusions

Migration 280 adds forced-RLS immutable recovery assessments and items plus one owner-only function. PUBLIC receives no table or execute privilege. No existing policy, source, transaction, outbox, schedule, lease, receipt, retry or control row is updated or deleted. No legacy data is adopted.

Independent acceptance, PR, merge, deployment, mounted runtime consumption, actual crash/outage/restore evidence, disaster-restore exercise, provider sandbox/live evidence, real recipients/messages, provider attempts/acknowledgements, callbacks, external outcomes, money, hosted load/SLA, physical Safari/devices, manual assistive technology, professional review and founder visual approval remain unavailable and unclaimed.
