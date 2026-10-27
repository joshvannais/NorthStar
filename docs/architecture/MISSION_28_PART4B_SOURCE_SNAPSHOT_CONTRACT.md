# Mission 28 Part 4B — durable source snapshots and correction lineage

Status: **Implementation candidate only.** This slice adds a tenant-private, append-only PostgreSQL storage authority for exact Part 4A observations. No runtime route, ingest adapter, evaluator, scheduler, worker, provider, recipient, external effect, upstream mutation, or money authority is mounted or granted.

The normative executable contract is [MISSION_28_PART4B_SOURCE_SNAPSHOT_CONTRACT.json](MISSION_28_PART4B_SOURCE_SNAPSHOT_CONTRACT.json). The accepted closed trigger catalog remains [MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json](MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json).

## What one snapshot means

A stored snapshot is evidence that a trusted Mission 28 storage boundary observed one exact current upstream fact binding. It records:

- the tenant and exact Part 4A trigger;
- the exact Part 4A grain as the source record identity;
- exactly one source version or source revision plus canonical and source digests;
- one explicit Part 4A event kind, source-owned event-time field, source-state selector, and canonical UTC event time;
- every exact Part 4A currentness pin and its digest;
- either a PostgreSQL-resolved active actor/session/membership or separately trusted authenticated-event provenance;
- a PostgreSQL-generated, distinct `observedAt`;
- original or append-only correction lineage; and
- canonical request and stored-snapshot digests.

The snapshot contains the exact source identity, version/revision, digests, event binding, and the closed Part 4A currentness-pin values—not an arbitrary upstream payload. Some closed pins necessarily carry bounded state such as status, balance minor units, currency, time, or revision. Those copied observations never become upstream business authority. Message bodies, documents, contact destinations, provider payloads, credentials, recipients, or effect content are not accepted.

## Time, currentness, and provenance

`eventTime` is the selected source-owned occurrence or effective time from Part 4A. `observedAt` is PostgreSQL `statement_timestamp()` in UTC and cannot be supplied by a candidate. The two fields have different authorities and neither may substitute for the other.

Only `available_exact_current` input is accepted. Currentness pins must have exactly the Part 4A names for the trigger. The event-kind and event-time pins must equal the event binding; the designated version/revision and digest pins must equal the separately named fields. Stale, unavailable, fixture, partial, mixed, missing, unknown, substituted, or ambiguous bindings fail closed.

Actor provenance is resolved against the active tenant session and membership before first storage. Authenticated-event provenance must match a separately trusted server-resolved value. The storage function is revoked from public and application roles; Part 4B mounts no resolver or application caller.

## Replay and corrections

An exact replay of one tenant/snapshot ID/request digest/provenance returns the original stored row and its original `observedAt`. Any conflicting reuse of the ID fails. A correction is a new immutable snapshot whose lineage sequence is exactly one greater and whose predecessor ID and digest match the immediately preceding snapshot for the same tenant, trigger, record identity, and event kind. It must change the source version/revision or a bound digest/currentness pin.

Rows are update/delete/truncate protected and retained under `source_snapshot_history`. Tombstone/replacement precedence, late/reordered fact handling, duplicate coalescing, and broader concurrency policy remain Part 4D; evaluation-time and pre-effect revalidation remain Part 4C.

## Boundaries

- Source facts and snapshots never grant action, approval, evaluation, delivery, collection, provider, mutation, or money authority.
- No arbitrary source payload, message/document body, contact destination, provider payload, credential, recipient, or effect content is copied into this store; only the closed identity and currentness bindings are retained.
- No runtime route, UI, queue, scheduler, worker, provider adapter, or recipient transport is introduced.
- Provider sandbox/private production, real recipients/messages/effects, live money, legal/privacy/provider review, physical-device evidence, and founder visual approval remain unavailable and unclaimed.
