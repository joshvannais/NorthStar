# Mission 27 Part 13A — provider lifecycle health and incident controls

## Authority

Part 13A extends the released provider-disabled Part 7 boundary into the full
operational lifecycle named by the frozen roadmap. It does not create a
provider account, adapter, credential, webhook endpoint, sandbox, live mode,
incident action, checkout, payment, receiver, accounting entry, or money
movement. Parts 13B–13D retain retention, replay, recovery, observability,
capacity, security and whole-Part-13 acceptance.

The server consumes only the exact released Part 7A payment-provider boundary,
Part 7B connection lifecycle and Part 8A provider-event receipt readiness. All are strictly projected before and after
each Part 13A projection. There is no cache, identity marker, caller-issued
trust token, or fallback value. Any invalid or changing source fails closed.

## Private read boundary

`GET /api/v1/customer-financial/payment-provider/lifecycle-health` is the only
Part 13A route. It requires a current paid tenant session and owner role. It is
private and `no-store`, accepts no query or request body, and returns no tenant,
actor, session, customer, provider-account, credential, endpoint or incident
identity. There is no demo or mutation route.

The exact case-insensitive path, with the router's optional trailing slash, has
one pre-parser method/body boundary. Unsupported methods return a fixed private
405 with `Allow: GET`; any framed GET body returns a fixed private 400. Both
occur before JSON parsing, authentication, throttling or repository access.
GET-only CORS is applied before this boundary without widening the method set.

## Value-free lifecycle contract

The immutable `m27-provider-lifecycle-health-v1` projection keeps these
separate:

- adapter schema and registration;
- tenant-bound provider account health and KYC/capability observations;
- expected policy versus observed capability drift;
- server-side credential rotation and revocation;
- webhook endpoint and signing-secret rotation and revocation;
- sandbox/live mode separation;
- explicit disconnect/reconnect with no automatic reconnect; and
- incident disablement and recovery authority.

Every current operational fact is unavailable because no accepted provider
account, adapter runtime, credential authority, webhook authority, sandbox
evidence or incident-control authority exists. Unknown health or drift can
never be treated as healthy or drift-free. The launch rollout remains disabled,
live mode remains off, and new connection, initiation and event ingestion remain
unauthorized. Raw secrets are never accepted, stored or returned. All provider,
credential, webhook, receiver, accounting and money effect counters are zero.

## Evidence boundary

Focused tests enumerate every semantic leaf and structural/source witness,
repository source composition and reread behavior, exact owner source, route
equivalence and near misses, query/body/framing/method/CORS composition,
privacy, and zero effects. Mounted evidence uses a disposable local PostgreSQL
17 database through migration 272 and proves current subscription/session/role
denial, restart stability, zero protected residue, zero external transport and
no migration 273.

Part 13A creates no rendered surface. Browser and founder visual acceptance are
therefore not applicable to this slice. Provider sandbox, live provider,
private production, operational incident, production performance, physical
device and first-paying-customer live-money evidence remain unavailable and
unclaimed.
