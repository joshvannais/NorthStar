# Mission 28 Part 6C — delivery coordination authority

Status: **implementation candidate only**. This slice adds an owner-only, tenant-private PostgreSQL coordination boundary. It does not mount a scheduler, publisher, consumer, worker, provider adapter, route or UI and cannot create a recipient, message, provider attempt, acknowledgement, delivery outcome, upstream mutation, accounting entry or money effect.

## Exact boundary

An exact released Part 6A action unit and Part 6B schedule can receive a short, finite lease only when its PostgreSQL schedule is due and unexpired, its policy remains active and unexpired, and every bound source snapshot remains the latest available exact-current lineage head. The request is bound to a separately trusted server-owned worker/process/deployment/region resolution. Candidate material never creates that authority.

Each schedule has one mutable owner-only lease head and append-only lease events. The first fence is `1`; takeover is allowed only after the current lease expires, requires the exact prior fence, and increments it by exactly one. An active lease, stale fence, substituted worker identity, cross-tenant clone or conflicting request ID fails closed. Exact historical replay returns the prior event without reinterpreting later currentness.

Before a transaction's first claim, all of its one-to-32 Part 6A units must have exact Part 6B schedules. First claims then follow the original contiguous zero-based `unitIndex`; a unit cannot first-claim until every lower index has immutable lease evidence. One tenant/transaction advisory lock serializes competing claims without blocking independent transactions.

The second owner-only function derives one stable provider-request identity as `m28:<exact Part 6A unitId>` and tenant-global unique request/receipt digests from immutable schedule, run, unit, outbox, material and idempotency bindings. Reservation and replay both require the current unexpired lease ID and fence; a later valid fenced takeover receives the original immutable receipt rather than a new identity. The stored state is `identity_reserved_no_provider_attempt_or_ack`. It is evidence of an identity reservation only: retries and uncertain acknowledgements in Part 6D must reuse it, while no provider attempt or outcome exists in this slice.

## Storage and isolation

Migration `277_canonical_automation_delivery_coordination_v1.sql` adds forced-RLS lease heads, immutable lease events and immutable provider-request receipts. Direct public privileges and runtime execute privileges remain absent. The migration never updates the Part 6A outbox or Part 6B schedule. No legacy row is adopted.

Part 6D owns retry/backoff/uncertain-outcome reconciliation; Part 6E owns cancel/pause/revoke/drain/dead-letter; Part 6F owns restart/outage/restore/orphan recovery. Later parts own senders, recipients, content, channels, providers and delivery/effect evidence.

Executable authority: [MISSION_28_PART6C_DELIVERY_COORDINATION_CONTRACT.json](./MISSION_28_PART6C_DELIVERY_COORDINATION_CONTRACT.json).
