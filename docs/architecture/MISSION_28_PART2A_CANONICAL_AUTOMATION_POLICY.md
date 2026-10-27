# Mission 28 Part 2A — canonical tenant-private automation policy

Status: **implementation candidate only.** This source-only contract defines a policy document; it does not create a database record, runtime authority, activation, schedule, task, message, provider attempt, recipient effect, upstream mutation, accounting effect, money movement, UI, or demo behavior.

The executable authority is [MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json](MISSION_28_PART2A_CANONICAL_AUTOMATION_POLICY.json). It is bound to the released Part 1A–1D artifacts and the exact Part 1D launch matrix. Part 2A cannot widen a source, action family, capability, channel, recipient, provider mode, limit, suppression, unavailable state, or effect boundary accepted by Part 1.

## Stable identity and append-only versions

Every policy document has one exact tenant UUID and one exact policy UUID. Both remain identical across every version. Version 1 has no predecessor; each later positive safe-integer version is exactly its predecessor plus one and names the immediate predecessor's canonical digest. A gap, duplicate, rewrite, fork, replay, reordered version, identity change, cross-tenant reuse, or ambiguous predecessor fails closed.

The two fictional examples prove the chain without granting authority. They are inert contract fixtures, not persisted policies. Historical run/effect/evidence records remain Part 2B work, lifecycle transitions remain Part 2C work, and PostgreSQL authority, trusted time and the production canonicalizer remain Part 2D work.

## Exact first-bound policy grammar

A version contains exactly the fields listed in `policyVersionFields`. Its trigger references one released Part 1 source class and can state only that the exact source is available and current. Arbitrary code, provider logic, hidden expressions and missing-as-zero behavior are denied until the later closed trigger and rule catalogs are accepted.

Its action can only describe one not-runnable internal policy definition for `internal_read_digest_task`, `owner_approval_request`, or the internal owner-only form of `collection_escalation`. The `customer_communication`, `secure_document_delivery`, and `financial_reminder` families remain unavailable. `unsupported_upstream_mutation_or_money_movement` remains permanently denied.

The only channel is passive in-app presentation, the provider is absent or disabled, and the recipient is one exact tenant-private owner, admin or assigned staff identity allowed by the Part 1D cell. A policy allows one source snapshot, one proposed action and one internal recipient while allowing zero external recipients, messages, provider attempts, upstream mutations or money effects. Tenant-customized limits remain Part 3C work.

Schedules are represented as evaluation-only with no scheduler, time zone or `notBefore` authority. Every policy requires a canonical UTC expiry but the trusted-clock contract remains unavailable until Part 2D. Approval authority is explicitly false until Parts 3A–3B. Rollout is exactly `disabled_contract_only`; there is no enabled state.

## Suppression and digest contract

Every version carries all required suppression categories in exact order: global stop; tenant pause; changed, stale, corrected or unavailable source; manual/owner activity; unknown prior effect; unavailable recipient, permission or channel; exceeded limit; and expiry or disabled rollout. This records policy intent only. Part 5D and later runtime slices must separately implement and revalidate suppressions.

Canonicalization is `mission28_sorted_json_v1`: plain JSON data only, object keys sorted by Unicode code point, array order preserved, exact strings, safe integers only, UTF-8, and no whitespace in serialized JSON. Sparse arrays, aliases, cycles, symbols, accessors, `toJSON`, custom prototypes, proxies, fractional/non-finite numbers and negative zero are denied. The digest is lower-case SHA-256 over the namespace `mission28.policy.version.v1\n` followed by the canonical JSON of every policy-version field except `canonicalDigest`.

This source-level digest contract prevents two differently represented policy versions from silently sharing identity. It is not a production canonicalizer, currentness token, signature, approval, activation, database record, run/effect/evidence record or provider idempotency key.

## Acceptance and unavailable evidence

Part 2A requires exact released Part 1 identities, exact schema/grammar/bounds, a valid fictional append-only digest chain, fail-closed mutation tests across every policy field, zero runtime/schema/migration changes, and a fresh independent whole-head audit with P0=P1=P2=P3=0 before release.

Part 2A has no independent acceptance, PR, merge, deployment or release evidence. Production providers, credentials, senders, callbacks, templates, sandbox/live capability and deliverability; real recipients/messages/effects; professional legal/privacy/consent/collections/debt/country-region/regulatory/provider/security review; private-production customer evidence; live money; hosted load/SLA; exercised restore; physical Safari/devices; manual assistive-technology review; and founder visual approval remain unavailable and unclaimed.
