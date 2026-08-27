# Source-to-sink and authority inventory

## Server path

Authenticated Calendar and Command Center projections call
`loadSchedulingOperatorDirectory`, which resolves the current membership/user/
workforce authority and returns a bounded initial target set plus exact discovery
metadata. The new authenticated canonical route parses query/cursor input before
calling `loadSchedulingOperatorTargetPage`. Production PostgreSQL derives active
profiles and crews under tenant predicates; no request-supplied tenant, role,
membership, crew, target status, or mutation authority is trusted.

The directory and target-page reads run in a read-only repeatable-read snapshot,
so actor authority, totals, ordering, and returned rows cannot come from mixed
database moments. The endpoint remains a read capability only. Assign/reassign
still travels through the Part 4 preview and separate approval endpoints, which
recheck current durable authority before any mutation.

## Browser path

The shared scheduling dialog consumes the server discovery contract. Initial
incompleteness is explicit; visible Search and Next controls fetch bounded pages
with same-origin credentials and no-store semantics. A result replaces only the
current selector page. Loading blocks preview, stale dialog responses are
discarded by dialog identity, lookup failures preserve the proposal and never
claim an omitted target unavailable, and the last page does not advertise a
nonexistent Next action.

All worker/crew/hostile labels are placed in option/text nodes through
`textContent`; no `innerHTML`, client-side authority, unbounded read, direct
appointment PATCH, provider call, or alternate apply path was introduced.

The optional security scanner remained unavailable and was not invoked. Manual
source-to-sink review covered route mounting, input boundary, tenant/role/read-
mutate gates, transaction snapshot, SQL parameters/order, response bounds, DOM
sinks, preview/apply handoff, and error/reload behavior.
