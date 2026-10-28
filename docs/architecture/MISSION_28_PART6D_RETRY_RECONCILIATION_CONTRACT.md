# Mission 28 Part 6D — bounded retry and uncertain-outcome reconciliation

Status: **Implementation candidate only.** This slice is owner-only durable authority for classifying separately trusted attempt observations, computing bounded retry timing and permanently stopping terminal, exhausted, effect-confirmed, unknown or unsafe actions. It does not mount or grant a scheduler, worker, queue publisher or consumer, provider adapter, callback, route, UI, recipient, message, external effect, upstream mutation, accounting or money capability.

## Exact authority chain

Every decision binds the exact tenant, Part 6A transaction/run/unit/outbox, Part 6B schedule, Part 6C stable provider-request receipt, current lease ID and fence, retry policy, attempt observation and optional reconciliation evidence. Candidate material and a separately trusted resolution must be exactly equal. The storage function then rereads the canonical rows, current active policy, every latest available exact-current source snapshot and the unexpired current fence before appending a new decision. An exact historical decision replay is returned before mutable currentness is reinterpreted; a conflicting decision identity fails closed.

The Part 6C provider request identity, provider request digest and idempotency receipt digest are immutable for the action. Retry, timeout and uncertain acknowledgement never create a second identity. Part 6D does not claim that a provider attempt, acknowledgement, delivery or business outcome occurred; it only stores the bounded no-effect decision derived from separately trusted evidence.

## Classification and reconciliation

The closed observation catalog distinguishes retryable definite non-acceptance, terminal rejection, timeout/acknowledgement uncertainty and unknown or unsafe outcomes. A retryable definite non-acceptance may schedule a later attempt below the ceiling. A terminal result, exhausted ceiling, confirmed effect, unknown evidence or unsafe outcome permanently stops. Timeout and uncertain acknowledgement first enter `reconciliation_required_no_resend`; only an exact later reconciliation for the same attempt observation may proceed. Confirmed no effect may schedule the next ordinal below the ceiling. Confirmed effect or reconciliation that remains unknown/unsafe permanently stops.

Attempt classifications increase by exactly one ordinal. Each new observation binds the exact current lease/fence and occurs inside that lease window. Reconciliation reuses the pending ordinal, observation and historical attempt lease/fence while also requiring a separately current decision lease/fence; this permits safe reconciliation after a takeover without rewriting which lease owned the uncertain attempt. A later classification is rejected until the computed retry instant and requires a newly current Part 6C lease/fence. Concurrent decisions for one tenant/schedule serialize under one database transaction lock. The append-only decision sequence increases exactly once.

## Bounded timing

The retry policy is immutable for the action: attempt ceiling 1–8, base delay 1–900 seconds, total maximum delay at most 3,600 seconds, bounded `Retry-After` at most the policy maximum and deterministic jitter at most 60 seconds. Exponential backoff is capped before composition with a trusted bounded `Retry-After`. Jitter is derived only from the stable provider-request digest and attempt ordinal and fits in the remaining delay window; total delay cannot exceed the policy maximum. Provider timeout evidence is required only for the timeout classification and is bounded to 1–120 seconds.

## Storage and no-effect boundary

Migration 278 adds a forced-RLS mutable current head and immutable decision evidence. Its one function is owner-only; PUBLIC receives no table or execute privilege. It never changes the Part 6A outbox, Part 6B schedule, Part 6C receipt or lease, and it grants no runtime role. Existing rows are not adopted.

Part 6E owns cancel/pause/revoke/supersede/drain/resume/expire/dead-letter/owner-reviewed-retry and bulk-stop behavior. Part 6F owns restart, outage, restore, partial-callback, deployment and orphan recovery. Later slices own senders, recipients, content, channels, provider calls, callbacks, delivery evidence and external effects.

Unavailable and unclaimed: independent acceptance, PR/merge/deployment, private production, mounted runtime resolver, scheduler/worker/queue publication, provider adapter or sandbox/live evidence, real recipients/messages, provider attempts/acknowledgements/callbacks, delivery/business outcomes, external effects, live money, hosted load/SLA, restore, physical Safari/devices, manual assistive technology, professional review and founder visual approval.
