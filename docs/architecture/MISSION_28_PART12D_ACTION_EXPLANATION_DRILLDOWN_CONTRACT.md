# Mission 28 Part 12D — action explanation and drilldown contract

Status: **Implementation candidate only.** This source contract adds no route, UI, table, function, worker, queue, scheduler, provider adapter, recipient, message or effect authority.

## Exact private drilldown

An owner-readable drilldown may explain one exact tenant-private Part 12 action only when separately trusted resolution binds the same immutable queue item, source snapshot and authoritative head, policy version and deterministic evaluation, Part 12C lifecycle head, viewer identity and record scope. The explanation keeps evidence quality, trust status, uncertainty, horizon and completion-unavailable truth visible. Candidate data and recomputed digests never create any of those authorities.

The queue and lifecycle head carry the exact released Part 12C semantic fingerprint. Its projection is unchanged: tenant, queue kind/action family, source record and snapshot identities/digests, policy identity/version/digest, evaluation identity/output digest, origin assignee, reason, evidence quality, trust, uncertainty and horizon material. Part 12D does not add its origin-contract/projection/material fields to that fingerprint and does not omit or redefine any Part 12C-bound field.

The source branch is exact. An ordinary action requires the latest exact-current Part 4 snapshot and authoritative head. A `source_changed_stale` action instead requires the exact Part 12C same-lineage correction tuple: the predecessor equals the action's source head, the snapshot and head sequences each advance exactly one, the replacement transition ID and digest are both distinct, the replacement authoritative head binds the replacement effective snapshot, and the distinct successor queue material remains required for unresolved consequential work. Event time and observation time never establish precedence.

The decision branch binds the exact Part 5B policy, source-set digest, evaluation identity and output digest, result, ordered reason codes and evidence quality. The current repository has no mounted Part 3C limit resolver or action-attempt history resolver. Limits and prior attempts are therefore shown only as fixed unavailable states; unavailable never means that limits are unused or that no real-world attempt occurred.

Visibility is tenant-private and read-only. The viewer must be the exact active same-tenant owner or admin actor, session and membership subject with the separately resolved `automation_view` capability, the tenant-wide record scope and the exact queue-item record identity. A role name alone is never authority. Fixed labels contain no customer, source, policy, attempt, document, financial or other private material.

## Current state and next safe choice

The current lifecycle state selects one fixed read/review label: review unresolved work, review or wait for a snooze, review dismissed or expired unresolved work, review escalated internal attention, or review an exact source correction. That label is explanatory only. It grants neither the capability nor the record authority needed to approve, schedule, send, perform work, change an estimate, mutate an upstream record, contact a recipient, call a provider, create a financial or money effect, make a legal decision, or complete the action.

The current result is fixed: `Action explanation unavailable — complete current authority is not mounted`. No drilldown record, queue mutation, lifecycle event, completion evidence, schedule, work record, estimate change, message, recipient contact, provider attempt, external effect, upstream mutation, financial effect or money effect is created.

## Identity, replay and hostile data

The envelope is strict plain data with exact keys, bounded bytes, canonical digests and independently trusted material. Accessors, proxies, symbols, `toJSON`, custom prototypes, sparse arrays, aliases, coercion, free text, extra or missing fields and noncanonical identities fail before digest, identity or history lookup. Exact request replay returns immutable no-effect evidence. The same request with different material and the same semantic material under another request identity both fail closed.

## Evidence boundary

Migration 287 remains latest and migration 288 is absent. Mounted drilldown, limit, attempt, viewer-capability and completion resolvers; private-production drilldown evidence; provider/live-recipient/effect/money evidence; professional legal/privacy/regulatory review; hosted load/SLA, restore, physical devices, manual assistive technology and founder visual approval remain unavailable and unclaimed.
