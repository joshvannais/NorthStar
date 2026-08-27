# Source-to-sink and transaction inventory

## Authority source

Production authentication supplies the exact durable session ID and a tenant/
user envelope. `actorInput` forwards that identity. Inside the owned snapshot,
the correction-5 directory logic reloads session, membership, user, workforce,
onboarding/business profile, and subscription rows and derives `canRead` and
`canMutate` only from those current rows.

## Composable transaction

`withReadSnapshot` distinguishes a pool from an existing `PoolClient` by the
client's `release` method. A pool owns connect/begin/commit/rollback/release; an
injected client owns none. `withBroadSchedulingReadSnapshot` performs authority
and the supplied data operation on that one queryable.

Canonical and compatibility routes pass the client to `listCanonicalGraphs`,
`getCanonicalGraph`, completed-graph counts, surface projections, timezone
authority, and all list/aggregate/detail builders. Command Center detail uses
the same helper. Calendar and Command Center workspace call
`buildSchedulingOverviewPage`, whose one repeatable-read transaction now loads
operator and timezone authority before page rows, refreshed assignment
authority, conflict evaluation, categories, and counts.

## Response sink

Only after the transaction completes are bounded rows serialized to JSON.
Denied current authority throws typed 401/403 before response data construction;
data failure rolls back and becomes the existing bounded unavailable response.
This correction changes no rendering or mutation path. Stored/customer/job/
worker/crew/reason bytes continue through existing safe JSON and DOM
`textContent` sinks. It adds no `innerHTML`, direct appointment PATCH, browser
authority, provider call, unbounded cache, or cross-tenant lookup.

Manual review found zero remaining calls to the retired route-level
`requireBroadSchedulingRead` pattern. The optional scanner was unavailable and
was not invoked.
