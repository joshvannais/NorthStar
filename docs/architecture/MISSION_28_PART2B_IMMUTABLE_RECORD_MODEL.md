# Mission 28 Part 2B — immutable run, effect, and evidence records

Status: **implementation candidate only.** This is a source-contract definition, not persistence or runtime behavior. It creates no database records, lifecycle transition, schedule, task, provider call, callback, delivery, reply, recipient effect, upstream mutation, accounting effect, money movement, UI, or demo behavior.

The executable authority is [MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json](MISSION_28_PART2B_IMMUTABLE_RECORD_MODEL.json). It is bound to the exact released Parts 1A–1D and 2A artifacts. Part 2B separates immutable facts about automation intent, attempted effects, and evidence; it cannot widen the released launch matrix or activate a Part 2A policy.

## Fourteen separate record kinds

The contract defines exactly fourteen record types: `eligibility_evaluation`, `proposed_action`, `approval`, `scheduled_run`, `action_unit`, `provider_attempt`, `provider_acknowledgement`, `delivery_state`, `reply_opt_out`, `internal_task`, `suppression`, `cancellation`, `reconciliation`, and `terminal_outcome`.

Each record has one type and one authority class. Internal eligibility, proposals, approvals, scheduling intent, action units, tasks, suppressions, and cancellations are `automation_decision` records. Only `provider_attempt` may describe an attempted external effect. Acknowledgement, delivery, reply/opt-out, reconciliation, and terminal outcome are bounded `effect_evidence`. None can stand in for another.

Provider-attempt existence does not prove provider acknowledgement. Acknowledgement does not prove sent or delivered. Delivery does not prove view, reply, payment, collection or outcome. Reply/opt-out evidence does not create consent or authority. A terminal outcome closes only an automation history; it cannot claim customer, provider, payment, collection or business success.

## Identity, binding, and causal order

Every record has an exact tenant UUID, unique record UUID, one exact run UUID shared by its causal history, record type, positive causal ordinal, immutable Part 2A policy tenant/ID/version/digest, one or more tenant-bound exact upstream source bindings, direct causal parents, classification, currentness marker, typed payload, payload digest, and record digest. Record-supplied tuples cannot establish their own authority: acceptance requires a separately trusted tenant-private resolution of the exact tenant, policy tuple, and every source tuple. Part 2B locks that rule to its fictional fixture; Part 2D owns the production resolver.

Every parent is bound by record ID, type, and digest. It must already exist at a lower ordinal under the same tenant and exact policy binding, and its type must be allowed by the child definition. Cross-tenant or cross-policy parents, missing or duplicate links, stale digests, forward links, cycles, aliases, clones, replays, reordered events and unsupported parent types fail closed.

Source bindings keep source ownership outside Mission 28. Eligibility's source-set digest is derived from the exact ordered source bindings. Provider acknowledgement's attempt digest must equal its direct provider-attempt parent's record digest; cancellation's target ID must equal its direct subject parent; reconciliation IDs must exactly equal its ordered direct parents; and terminal unresolved IDs must be an ordered subset of its direct parents. Other named content digests are explicitly opaque and cannot act as record links or authority.

Captured currentness is immutable evidence about what a record knew; it is not continuing authority. All-exact, all-stale, all-unavailable, mixed non-fixture, and fixture-only source markers have exact aggregate states. Unavailable takes precedence over stale, stale takes precedence over exact, and fixture markers cannot mix with non-fixture markers. Contradictory policy/source/record markers fail closed. Runtime currentness revalidation remains later work.

## Immutability and correction

Records are append-only. Mutation, deletion, replacement, in-place correction and record conflation are denied. A correction, suppression, cancellation or reconciliation creates a new typed record that names the exact immutable predecessor or subject. Uncertainty remains explicit. Conflicting terminal claims remain unavailable until a later accepted reconciliation appends a coherent result.

Payload and record digests use source-only sorted-JSON contracts with separate namespaces. Plain JSON data, safe integers, stable array order and exact strings are required. Sparse arrays, aliases, cycles, symbols, accessors, `toJSON`, custom prototypes, proxies, fractional/non-finite numbers and negative zero are denied. Part 2D still owns the production canonicalizer, PostgreSQL authority, migration, RLS, trusted time, retention, indexes, persistence and restart behavior.

## Acceptance and unavailable evidence

Part 2B acceptance requires all fourteen types and their exact classifications, payload schemas, parent and relational-subject relationships, trusted policy/source/currentness bindings, causal and digest rules, append-only correction behavior, exhaustive whole-ledger cross-tenant/cross-policy/source retargeting, conflation, reorder, replay, relational-substitution, currentness-contradiction and recomputed-digest tamper tests, zero runtime/schema/migration change, and a fresh independent whole-head audit with P0=P1=P2=P3=0.

Part 2B has no independent acceptance, PR, merge, deployment or release evidence. Part 2C lifecycle, Part 2D storage/canonicalization, providers, real recipients/messages/effects, professional legal/privacy/consent/collections/debt/regulatory/provider/security review, live money, private-production evidence, hosted load/SLA, exercised restore, physical Safari/devices, manual assistive-technology review, and founder visual approval remain unavailable and unclaimed.
