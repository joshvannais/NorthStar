# Mission 28 Part 4C — coherent currentness revalidation

Status: **Implementation candidate only.** This slice freezes the two-stage currentness contract. It does not mount a resolver, evaluator, effect executor, route, UI, scheduler, worker, provider, recipient transport, upstream mutation, accounting action, or money movement.

The normative executable contract is [MISSION_28_PART4C_CURRENTNESS_REVALIDATION_CONTRACT.json](MISSION_28_PART4C_CURRENTNESS_REVALIDATION_CONTRACT.json). It consumes the released Part 4B snapshot contract without changing upstream fact authority.

## One coherent current decision

Evaluation-time revalidation resolves, in one trusted epoch, the exact active policy, latest exact Part 4B source snapshot, internal recipient, internal membership basis, passive in-app channel, limits and usage, prior-effect high-water mark, suppressions, authorization, and tenant/policy governance state. Every currentness dimension carries the exact same resolution-epoch identity; every identity and digest belongs to the same tenant, run, proposed-action subject, policy, source, and material binding.

Only the three conditional first-launch internal families are contract-eligible: internal read/digest/task, owner approval request, and reviewed collection escalation as an internal owner work item. Customer communication, secure document delivery, financial reminders, upstream mutation, and money movement remain unavailable. Tenant membership is internal product authority—not customer consent or a legal basis for contact.

Missing, stale, mixed, unavailable, corrected, cross-tenant, cross-policy, cross-run, cross-action, cross-recipient, paused, stopped, terminal, suppressed, over-limit, uncertain, colliding, expired, or unsupported material fails closed. A Part 4B snapshot must be the latest exact lineage member for its trigger, record identity, and event kind; a later correction invalidates the decision.

## Immediately before an effect

The pre-effect stage must independently resolve every dimension again under a new trusted epoch. It binds the exact separately trusted evaluation receipt and requires the fresh material digest to be unchanged. It cannot reuse an evaluation-time resolver, combine before/after dimensions, accept a changed source or suppression state, or fall back to a different recipient, channel, policy, or provider mode.

The evaluation receipt is resolved from server-owned immutable evidence by exact tenant, decision, revalidation identity, digest, and material digest. Candidate fields or candidate-computed digests never create, replace, or retarget that trusted resolution. Elapsed time between evaluation and later approval does not itself establish currentness; the fresh pre-effect resolution and unexpired authorization do. There is no reusable elapsed cache window between pre-effect validation and a future claim.

Closing a check-then-act race requires the future effect executor to acquire the required database locks, perform this pre-effect resolution, and claim the action within one transaction whose locks remain held through commit or rollback. That executor does not exist in Part 4C. Therefore even a conforming pre-effect receipt is evidence only: it is not bearer authority and cannot prove an attempt, acknowledgement, delivery, mutation, payment, or success.

## Evidence boundaries

Part 4C adds no migration and leaves production at 270 migrations through 274/no275. Mounted currentness resolution, atomic effect claims, provider sandbox/private-production evidence, real recipients or messages, upstream/accounting/money effects, professional legal/privacy/consent/provider review, hosted load/SLA, physical devices, manual assistive technology, and founder visual approval remain unavailable and unclaimed.
