# M22-P5-013 atomic broad-read closure

## Prior gap

`loadSchedulingOperatorDirectory` previously owned and committed its
repeatable-read transaction. Route handlers then issued broad graph/count/detail
queries through the pool. A durable owner/dispatcher demotion after authority
commit but before the data query therefore allowed the same request to return
broad bytes under a second snapshot.

## Corrected boundary

`withBroadSchedulingReadSnapshot` owns one bounded repeatable-read transaction
when given a pool, loads the existing correction-5 current authority on its
client, rejects non-readers before data access, executes the route operation on
that same client, and only then commits. When given an already-owned
`PoolClient`, the directory loader reuses it without `connect`, `BEGIN`,
`COMMIT`, or `release`. This lets Calendar and Command Center overview reads
compose their existing shared-lock, mutation-free repeatable-read snapshots.

The current snapshot includes exact authentication session identity/status/
expiry/tenant/user/membership binding, membership and user active state,
workforce operational role, onboarding/business profile, and subscription.
The same snapshot produces every protected row, count, category, timezone, and
detail byte. Pool use after the authority decision is prohibited by mounted
instrumentation.

Owned transactions set 15-second statement and idle-transaction timeouts,
2-second lock timeout, and `search_path=pg_catalog,public`. Data errors roll
back before release. No query writes business data.

## Linearization semantics

The linearization point is the transaction snapshot. If a concurrent external
change commits after that snapshot, the in-flight request may coherently finish
using its earlier authority and data. The next request must observe the change
and fail closed or become read-only. Tests intentionally do not require a
transaction to see commits that occurred after snapshot creation; they require
that authority and bytes never come from different snapshots.

## Mounted proof

The mounted production routers exercise 70 protected aliases plus exact races.
For every alias: one connect, one begin, one commit, one release, zero pool
queries, zero data reads outside the transaction, and at least one data query
after authority on the same backend. Error injection proves one rollback,
zero commit, and release after rollback.

Boundary mutations cover owner/member plus dispatcher/technician demotion,
session revoke, expiry and deletion, membership and user suspension,
subscription past-due, and onboarding/business-profile retirement. The raced
request is coherent on the earlier snapshot; the immediately following
request returns typed 401/403 or truthful `canMutate=false`. Protected response
bytes and counts are absent from denied responses.
