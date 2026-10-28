# Mission 28 Part 6A — transactional outbox and bounded action units

Part 6A defines one tenant-private authoritative transaction that converts one separately resolved, accepted current decision into one to thirty-two bounded internal action units and exactly one committed-unpublished outbox row per unit. The transaction receipt, units and outbox rows commit together or none exist. No queue publication is observable before commit.

The executable authority is [MISSION_28_PART6A_TRANSACTIONAL_OUTBOX_CONTRACT.json](MISSION_28_PART6A_TRANSACTIONAL_OUTBOX_CONTRACT.json). It consumes the exact released Part 2B/2D, Part 3B–3D, Part 4A–4D and Part 5A–5D identities without redefining them.

## Accepted decision boundary

The request cannot establish its own authority. A server-owned tenant-private resolver independent of the request must supply the exact Part 3B authorization, Part 4A trigger/action-family admission, latest accepted Part 4B source heads, fresh Part 4C evaluation and immediately-pre-effect revalidation, Part 4D precedence head, eligible Part 5B output, no-effect Part 5C preview and the exact Part 5D `selected_no_effect` collision decision. Policy, source, authorization, evaluation, preview, collision, material and currentness identities must all agree in one transaction. Any change requires a new decision, revalidation and transaction.

Part 5D selection remains no-effect analysis and never self-authorizes. Part 6A may accept it only as one component of the separately trusted complete current decision. The current application has no mounted resolver or runtime execute grant; owner-only migration evidence cannot be presented as production automation.

## Bounded action units and outbox state

Action units are ordered, contiguous and limited to the three provider-disabled first-launch internal templates. The source-set digest is derived from the exact tenant plus one to eight ordered, unique snapshot IDs and unique snapshot digests; the accepted decision binds a separately derived digest of the complete ordered action-unit array. Every unit therefore binds the same tenant, run, policy, exact source set, accepted decision and authorization, plus one distinct unit identity, material digest and idempotency digest. A unit is internal intent only—not a provider attempt, acknowledgement, delivery, recipient effect, outcome, upstream mutation, accounting fact or money movement.

The authoritative transaction stores one immutable receipt, every unit and exactly one corresponding outbox row in state `committed_unpublished`. Duplicate identities/material/idempotency digests, gaps, fan-out overflow, partial rows and cross-request/tenant/policy/source/run reuse fail closed. Exact request replay returns the same receipt without adding rows; conflicting transaction-ID reuse fails.

## Deliberately unavailable behavior

Part 6A mounts no route, UI, scheduler, publisher, queue consumer, worker, lease, claim, retry, provider adapter, callback, recipient, message or effect executor. Part 6B owns durable time-zone-aware scheduling. Parts 6C–6F own publication, leases, fencing, ordering, retries, reconciliation, cancellation/dead-letter and restart/outage recovery. Parts 7+ own sender, recipient, content, channel, provider and delivery behavior. Provider/live evidence, real recipients, external effects, private production, live money, hosted performance/SLA, restore, physical devices, manual assistive technology, professional review and founder visual approval remain unavailable and unclaimed.
