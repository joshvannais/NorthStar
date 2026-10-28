# Mission 28 Part 5A — bounded declarative rule grammar

Status: **implementation candidate only**. This source contract defines the exact bounded grammar that a later evaluator may consume. It does not mount a resolver or evaluator and cannot create eligibility, approval, scheduling, recipients, provider work, effects, upstream mutation, accounting or money authority.

The executable authority is [MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json](MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json). Its baseline is released Part 4D at main `7308a529f7f6e295d786fd2c52073705eebaa2f2`, tree `df150a26d03642cb4930de8914b85bf5d8b73510`.

## Exact binding

A rule is one immutable tenant-private definition. Its tenant and policy tuple must equal a separately resolved exact policy version. Its trigger, source class, event kind, current Part 4D head, and effective Part 4B snapshot must equal one separately resolved Part 4A/4D lineage. Its action template must equal one separately resolved approved catalog entry for that tenant use. The candidate rule, a canonical clone, or a recomputed digest never establishes any of those facts.

The server-owned resolution must therefore bind:

- the exact tenant, policy ID, policy version and policy digest;
- the exact Part 4A trigger row, source class, event kind and allowed action families;
- the exact Part 4D current head and effective Part 4B snapshot identities and digests; and
- the exact approved template ID, version, digest, family, capability, channel, provider-disabled mode and internal-only effect class.

Cross-tenant, cross-policy, cross-trigger, cross-lineage, cross-snapshot, clone, alias or replay reuse fails closed. Template membership does not imply that an action is eligible or authorized.

## Bounded grammar

The only condition nodes are `group` and `predicate`. Groups are ordered nonempty `all` or `any` arrays. Predicates identify one closed fact reference, one exact type, one compatible operator and one exact literal. The complete tree is limited to depth 4, 32 nodes, 8 children per group and 16 members per collection literal. Tokens, text, integers, decimals, instants and canonical input bytes have explicit limits in the executable contract.

The closed fact catalog is deliberately small. It exposes only Mission 28 authority metadata already fixed by Parts 4A–4D: trigger ID, event kind, currentness state, lineage state, event and observation time, lineage sequence, record identity digest and snapshot digest. Adding a business field requires a later reviewed contract change; free-form property paths are not accepted.

The compatibility matrix is exact. Boolean, token, bounded text, integer, canonical decimal string, UTC instant, UUID and digest comparisons have distinct operator sets. There is no regex, script, function, expression language, property traversal, interpolation, template execution, provider branch or coercion. A decimal is a canonical base-10 string; an integer is a bounded safe integer; collection literals are ordered and unique.

## Unknown and unavailable

Later fact resolution must return the exact envelope `{ state, value }`. `known` requires a value of the catalogued type. `unknown` and `unavailable` require `value: null` and remain distinct outcomes. A missing envelope, state or value is malformed. It never becomes false, zero, an empty string, an empty collection, a no-op or permission.

Part 5A does not execute this envelope, but it freezes the later result semantics. A known predicate returns `match` or `no_match`; unknown stays `unknown`; unavailable stays `unavailable`. Every group is completely validated first. For both `all` and `any`, any unavailable child yields unavailable and, absent unavailable, any unknown child yields unknown. Only then does `all` require every child to match or `any` require at least one match. This conservative precedence prevents a known branch from hiding unavailable or unknown material. Part 5B owns the actual deterministic evaluator, reason codes and result records.

## Approved templates

Three reference-only templates are frozen:

1. an internal fact digest/task for `internal_read_digest_task`;
2. an internal owner approval request for `owner_approval_request`; and
3. an internal reviewed-collection work item for the exact Mission 27 reviewed handoff and `collection_escalation`.

All use `in_app_passive`, `provider_disabled`, and `internal_record_only`. The collection template is compatible only with the Part 4A `m27.reviewed_collection_handoff` row. No customer communication, secure document delivery, financial reminder, provider, recipient, message, upstream mutation, accounting or money template exists in this slice.

## Plain data and canonical digest

Validation is descriptor-first. Accepted inputs are ordinary objects and standard dense arrays containing own enumerable data properties only. Symbols, accessors, `toJSON`, custom prototypes, boxed or coercible values, proxies, cycles and shared aliases are rejected before field access, canonicalization or digest work. Object key order and array order are exact. The SHA-256 rule digest covers every rule field except itself under the namespace `mission28.declarative-rule.v1\n`.

An exact digest replay is evidence of one immutable definition only. It never proves currentness, eligibility, approval, scheduling or an effect.

## Deferred and unavailable

Part 5B evaluation, Part 5C preview, Part 5D collision/suppression/dry-run, and all Part 6+ scheduling and execution remain planned and unimplemented. Provider sandbox/live systems, real recipients, live money, private-production proof, hosted load/SLA, professional legal/privacy/provider/regulatory review, physical Safari/devices, manual assistive technology and the founder visual verdict remain unavailable and unclaimed.
