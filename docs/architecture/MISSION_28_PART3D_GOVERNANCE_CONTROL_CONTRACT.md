# Mission 28 Part 3D — governance controls and safe degraded behavior

Status: **Implementation candidate only.** This is a source contract, not a runtime control plane. It adds no route, UI, database object, migration, scheduler, worker, queue, provider, recipient, message, external effect, upstream mutation, accounting action or money movement. Part 4 and later slices remain planned and unimplemented.

## Released inputs

Part 3C is released at accepted source `3cd41fe5379d92fe629c62e0ebc3a51d8886c3cc`, tree `1a54cd43a2d3f218cc7040842847caaf668505df`, PR #559, main `d227c50f73e3fb9fc89ee48332a9eda57d1c8713`, deployment `b745a483-1031-4020-9ab2-38c0044e599d` `SUCCESS/RUNNING`, running instance `0227dd84-13e8-48b1-99fd-8268ae8e8ba8`, and image `sha256:27c84d6cd34be043aa2f6388080c90b5500a8ea1d87ab018c9d58f34277e5590`. Its fresh whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and is unclaimed. Dockerfile/start binding, canonical startup, migration 273/no274, healthy PostgreSQL canonical persistence, health, root and demo checks are released evidence.

The [executable contract](MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.json) binds the normalized-LF identities of Parts 1A–3C. It cannot alter the fixed Part 3A capability matrix, create a Part 3B authorization, weaken a Part 3C limit or convert a control decision into a runtime effect.

## Exact controls

| Control | Direction | Exact result and limit |
| --- | --- | --- |
| Pause policy | Reduce only | Stops later new decisions for one policy; never claims queued or in-flight work stopped |
| Revoke standing authority | Terminal reduce only | Revokes the exact version; that identity cannot resume |
| Engage tenant kill | Reduce only | Blocks later decisions, claims and attempts; never rewrites existing effect evidence |
| Drain policy | Reduce only | Blocks new decisions/claims and preserves leased, in-flight and uncertain work for reconciliation |
| Cancel action unit | Reduce only | Cancels one exact queued, unclaimed Mission 28 action; never an upstream fact or a claimed/uncertain/completed effect |
| Resume policy | Increase | Requires exact current policy/source/limit/safe-state evidence, recent owner authentication and a new exact standing authorization |
| Release tenant kill | Increase | Always requires a distinct exact tenant-stop-state approval, two distinct current owner actors and exact safe-state evidence; inability to satisfy either authorization or dual control keeps the kill engaged |

Pause, kill, drain and cancellation are not delivery or provider facts. They cannot call back an external effect, turn an uncertain outcome into a cancellation, or imply an in-flight action stopped. Reductions win a concurrent race with an authority increase. Revoke and cancel are terminal for the exact identity. A later action or policy needs a new identity and complete accepted authority.

## Dual control and self approval

Releasing the tenant kill always requires dual control. Resume also requires it after break glass, after a tenant kill was separately released, after a prior in-flight or uncertain effect was reconciled, or after a required independent review completed. Current in-flight, uncertain, killed or pending-review state remains ineligible even with two actors. Initiator and approver must be different actor, session and membership identities; opening another session or alias membership for one person does not create dual control. Both are server-resolved current owner memberships in the same tenant, with exact capabilities, an exact recent-authentication evidence ID/digest no more than 900 seconds old, and an approval subject digest recomputed over the exact operation, target, authorization, reason, evidence, expiry and idempotency material. No fallback exists when the second eligible owner is absent.

Revoke and resume bind a Part 3B standing authorization to the exact tenant, policy ID/version/digest, source-set digest, limit-profile digest and prior-state digest. Releasing the tenant kill instead binds a distinct tenant-stop-state approval to the exact tenant and killed-state digest; a policy standing authorization cannot be relabeled for tenant-stop release. The decision lifetime is at most 900 seconds. Increasing controls require exact-current evidence observed no more than 30 seconds before the trusted decision time. Candidate data, a display role or a recomputed outer digest cannot create or retarget any of these authorities.

One eligible owner or admin may engage an authority-reducing control. That does not grant the ability to release it. A dual-control initiator cannot approve their own request, a break-glass actor cannot complete their own independent review, and record authors never create their own capabilities, approvals or trusted evidence.

## Break glass and degraded defaults

Break glass is limited to `pause_policy`, `engage_tenant_kill` and `drain_policy`. It requires an authenticated server-resolved tenant actor, fixed reducing capability, incident identity, reason, expiry, exact target, before/after state and append-only evidence. It can never activate, resume, release a stop, retry, send, call a provider, weaken a limit or dual-control requirement, mutate an upstream fact, or move money. Expiry and restart never auto-resume; the reducing state persists pending separate current authority and independent owner review.

Missing, stale, unavailable, mixed or conflicting database, clock, policy, source, limit, capability, authorization, recipient, channel, provider or effect evidence denies new/increasing authority. Unknown leased, in-flight or provider outcomes drain and reconcile. Provider/channel failure never silently falls back or duplicates. Crash, deploy, restart or restore reconstructs exact authority before any later slice may act. Terminal identities never reactivate.

## Mission 29 boundary

Part 3D uses only fixed Part 3A capabilities, current owner/admin memberships and non-configurable dual-control rules. Custom roles or hierarchies, enterprise thresholds or configurable quorums, organization-scale or multi-tenant governance, delegated administrators, SSO/SCIM identity governance and custom break-glass rosters remain Mission 29. A missing Mission 29 feature fails closed; display-role names, free-form thresholds and tenant policy cannot emulate it.

## Acceptance and unavailable evidence

Part 3D acceptance requires exact frozen-input hashes, exact seven-control order and grammar, full transition/currentness/dual-control/self-approval/break-glass/degraded-state matrices, full-redigest attacks, strict plain-data validation, unchanged migration 273/no274, exact Node 22.23.3 evidence, and a fresh independent whole-head audit with P0=P1=P2=P3=0.

Runtime control resolution, persistence, locking, fencing, leases, drains, cancellation and resume; immediately-pre-effect revalidation; provider accounts, credentials, callbacks or reconciliation; real recipients/messages/effects; custom enterprise governance; professional legal/privacy/consent/collections/provider/regulatory/security review; private-production evidence; provider sandbox/live money/first-paying-customer validation; hosted load/SLA; exercised restore; physical Safari/devices; manual assistive technology; and founder visual approval remain unavailable and unclaimed.
