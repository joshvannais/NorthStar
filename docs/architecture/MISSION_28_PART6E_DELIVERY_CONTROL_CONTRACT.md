# Mission 28 Part 6E — delivery controls without effect authority

Part 6E adds the owner-only durable control boundary for cancelling, pausing, revoking, superseding, draining, resuming, expiring, dead-lettering, owner-reviewed retry and tenant/policy bulk stop. It does not mount a resolver, scheduler, queue, worker, provider adapter, callback, recipient, message or money path. A control decision is evidence and a database guard; it is not evidence that an already leased, in-flight, uncertain or externally completed action stopped.

## Exact target and actor

Every decision binds one tenant and one exact target: the tenant, a policy version, or a Part 6B schedule with its Part 6A transaction/run/unit/outbox and Part 6C receipt/provider identity. The database resolves the target again. The actor must be an active account with an active same-subject session and membership in the same tenant and a fixed owner/admin role allowed by the operation. Resume and owner-reviewed retry require an owner session created within fifteen minutes. Candidate material and a separately trusted resolution must be byte-for-byte equivalent after canonicalization; neither creates target, phase, count or result authority.

## Action-phase treatment

- **Queued:** exact unclaimed work may be cancelled or expired. Scope pause, revoke, supersede, drain and bulk stop block later claims.
- **Leased:** cancellation is denied. Reducing scope state blocks a later claim or renewal but cannot claim the existing lease, in-flight work or an external effect stopped.
- **In flight:** no accepted durable in-flight authority exists yet. Cancellation, retry and completion claims fail closed. A scope reduction can only block later new attempts.
- **Uncertain:** cancellation and resend are denied. Exact Part 6D reconciliation remains available as evidence. Dead-lettering preserves the unresolved state and never turns it into no-effect evidence.
- **Completed:** completion evidence is immutable and is never cancelled, revoked or rewritten. Accepted durable completion evidence remains unavailable in this slice.
- **Permanent stop:** attempt-ceiling evidence that definitively reports no provider acceptance may be dead-lettered and reviewed. Effect-confirmed, terminal and unknown/unsafe stops never reopen.

## Controls and precedence

Pause and drain are reducing states. Revoke, supersede, bulk stop, cancellation, expiration and dead-letter are terminal for their exact target. A drain becomes `drained` only when the bounded scope has no leased or uncertain actions; otherwise it remains `draining`. Resume is limited to an exact paused or drained policy version whose lifecycle is still active and unexpired and whose source snapshots remain latest, available and exact-current. Tenant bulk stop is terminal in this slice.

Supersession requires an exact distinct successor policy version whose latest lifecycle state is active. It blocks the old policy version only and never rebinds historical action evidence. Expiration is derived from the PostgreSQL clock and the exact schedule/policy expiry. Scope fan-out is limited to 32 actions and fails closed above that bound.

The database preserves the released Part 6B–6D outer order: exact policy-lifecycle first, followed by tenant → policy → action control locks. Guards on new schedules, new delivery leases and new retry classifications reach those control locks only after their accepted lifecycle and source locks. A reducing control therefore serializes the race without a lifecycle/control cycle and without rewriting Part 6A–6D data. While the outer lifecycle lock remains held, resume and owner-reviewed retry additionally hold each exact migration-274 lineage lock before resolving the latest source head and until the control transaction commits, so a concurrent correction either wins first and makes the decision stale or waits behind the accepted decision. Exact Part 6D `record_reconciliation` remains allowed because it records evidence and cannot resend.

## Dead letter and owner-reviewed retry

Dead-lettering requires exact Part 6D uncertainty or permanent-stop evidence and an owner review. `effect_or_unknown_unresolved` never becomes no-effect. Owner-reviewed retry is narrower: the exact action must already be dead-lettered from a definite-no-acceptance attempt-ceiling stop, the policy/source authority must still be current, and the review outcome must be `new_action_required_no_reuse`. The old schedule, run, receipt and provider request identity stay terminal and blocked. This record grants no resend; any later action must be separately created with a new run/action/receipt identity and all then-current authority.

## Storage and unavailable evidence

Migration 279 adds forced-RLS current heads, immutable append-only control events, one owner-only function and database guards. PUBLIC receives no table or execute privilege. The migration mutates no existing outbox, schedule, lease, retry, receipt, provider or effect row and adopts no legacy data.

Independent acceptance, PR, merge, deployment, mounted runtime consumption, provider sandbox/live evidence, real recipients/messages, provider attempts/acknowledgements, in-flight/completed effect evidence, external outcomes, money, restart/outage/restore evidence, hosted load/SLA, physical Safari/devices, manual assistive technology, professional review and founder visual approval remain unavailable and unclaimed.
