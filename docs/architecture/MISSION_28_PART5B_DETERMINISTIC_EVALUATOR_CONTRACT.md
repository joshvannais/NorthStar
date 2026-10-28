# Mission 28 Part 5B — deterministic explainable evaluator

Status: **implementation candidate only**. This source contract freezes deterministic evaluation and immutable output evidence. It does not mount a resolver, evaluator, route, store, scheduler, queue, worker, provider, recipient or effect executor. No result creates approval, scheduling, delivery, upstream mutation, accounting or money authority.

The executable authority is [MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json](MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json). Its baseline is released Part 5A at main `0b86beab6d0ac3f81a079d47f8569e8e24c34de7`, tree `12f4e02e10c4b507a8e9b76e81dcff078318059b`.

## Trusted evaluation input

The complete released Part 5A rule must validate before fact lookup. A server-owned tenant-private resolver independently supplies the exact policy, Part 4A trigger, Part 4D current head and effective Part 4B snapshot, Part 5A template, Part 4C evaluation-time currentness, suppression, canonical Part 3B authorization and trusted clock. Candidate data and recomputed digests never establish those facts.

Facts are an ordered, unique set containing every predicate fact exactly once, in first depth-first predicate occurrence order. Every fact includes the exact source-binding digest inside its own fact digest and has the released Part 5A state envelope: `known`, `unknown`, or `unavailable`. Every known fact value must equal the corresponding separately resolved Part 4 source projection: trigger, event kind, currentness, Part 4D head state and sequence, source-owned event time, trusted observation time, record identity and effective snapshot. The source-owned event time may be an occurrence or future effective time, so it is not ordered against capture time; the distinct trusted `observedAt` must be at or before the trusted evaluation clock. Unknown and unavailable values remain null and distinct. Missing facts, extra facts, aliases, alternate snapshots or source fields, and cross-tenant or cross-policy reuse fail closed.

The policy, source, suppression, authorization and clock resolution form one immutable context. An exact Part 3B authorization remains either `per_run_approval` or `standing_authorization`; Part 5B does not invent a third kind or redefine its material digest. Its policy, source, recipient set, action family, channel and provider-disabled mode must remain exact. Recipient classes remain an ordered unique subset in the exact canonical Part 3B first-launch order; reordering a valid set is not canonical authorization. The Part 5A template effect class `internal_record_only` maps only to Part 3B's canonical `internal_only_no_external_effect`; no other mapping is accepted. A material change requires a completely new evaluation.

## Deterministic condition result

The Part 5A evaluator returns only `match`, `no_match`, `unknown`, or `unavailable`. Every node is validated before evaluation. Typed comparisons never coerce and never execute regex, scripts, functions, expressions, templates or provider logic. Both `all` and `any` preserve conservative absence precedence: unavailable dominates; otherwise unknown dominates; only fully known children can yield match or no-match.

The final closed result states are `eligible`, `ineligible`, `suppressed`, `unavailable`, `expired`, and `approval_required`. Their precedence is exact:

1. unavailable policy, stale/mixed/unavailable source, unavailable suppression or authorization resolution, or unknown/unavailable rule material produces `unavailable`;
2. an otherwise exact expired policy produces `expired`;
3. an exact current Part 4D tombstoned or reversed head produces `ineligible`;
4. an exact current matching suppression produces `suppressed`;
5. an exact current no-match produces `ineligible`;
6. a match with required or expired authorization produces `approval_required`; and
7. `eligible` requires an exact active policy, latest active Part 4D head, clear suppression, a matching rule and one exact current canonical Part 3B authorization.

`eligible` is only evaluation evidence. It is not approval, a schedule, a claim, a recipient/provider instruction, an effect, an upstream mutation, accounting evidence or money authority. `suppressed` is evidence of a matching suppression, not proof that an external effect stopped.

## Reasons, evidence and next evaluation

Reason codes are closed, ordered and derived from validated material; the caller never supplies them. The predicate explanation contains only stable condition paths, fact references, types, operators, fact states, comparison results and closed reason codes. It contains no candidate prose or business secrets.

Evidence quality is `complete_exact`, `partial_unknown`, or `unavailable`. An exact expired, suppressed, ineligible or approval-required result can be complete evidence of that fail-closed state. Unknown and unavailable remain distinguishable.

`nextEvaluationAt` is nullable. When present, it is selected deterministically from separately trusted future instants with exact basis digests. A source recheck is bound to the exact source-resolution digest; policy and suppression expiry candidates must equal their resolved expiry and resolution digest. The selection uses result-specific candidate kinds, earliest time and a closed tie-break order. It is an explanatory reevaluation hint only; Part 5B creates no timer, scheduler, job, queue or execution authority.

## Immutable output

The input digest covers the complete validated rule, facts, trusted context and evaluation time. Separate source, fact-set and context digests prevent replacement by a canonical-looking clone. The output repeats the exact policy/rule/source bindings, input digest, result, reasons, evidence quality, ordered predicate explanations, next evaluation time and trusted evaluation time. Its SHA-256 output digest covers the complete output except itself.

An exact output replay means only the same immutable no-effect evaluation evidence. It cannot survive changed policy, source, suppression, authorization or clock material, and it is never bearer authority.

## Deferred and unavailable

Part 5C preview, Part 5D collision/suppression/dry-run and all Part 6+ scheduling and execution remain planned and unimplemented. Mounted runtime resolution and evaluation, provider sandbox/live systems, real recipients, live money, private-production proof, hosted load/SLA, professional legal/privacy/provider/regulatory review, physical Safari/devices, manual assistive technology and the founder visual verdict remain unavailable and unclaimed.
