# Validated finding closure

## M22-P5-008 — tenant-wide status count disclosed to employees

Both `/api/v1/canonical/status` and `/api/dashboard/status` now share one status
builder. Current owners/admins/active dispatchers retain their tenant-scoped
completed-graph count. Authenticated employees and pre-workforce onboarding
sessions receive only generic operational metadata with
`broadSchedulingRead:false`; no `completedGraphs` property is constructed and no
canonical-operation count query runs. Inactive membership is still denied by the
production authentication boundary and revoked sessions remain `401`.

Mounted tests cover both aliases for owner, active dispatcher, employee, another
tenant, inactive dispatcher, revoked session, past-due/read-only owner, and
hostile stored bytes. The full-corpus intermediate failure exposed and then
closed compatibility for newly signed-up pending owners without weakening the
broad-data boundary.

## M22-P5-009 — noncanonical cursor parsing after database work

`src/scheduling/graphCursor.js` is the single parser/encoder. It accepts only a
bounded unpadded canonical base64url spelling of canonical JSON in exact key
order, one lowercase UUID string, and an exact six-microsecond UTC timestamp.
Calendar dates are checked manually, so impossible dates cannot normalize
through JavaScript `Date`. Padding, junk, whitespace, oversize values, invalid
UTF-8/JSON/schema/types, offsets, milliseconds, leap seconds, impossible dates,
and alternate spellings fail with one bounded `400 INVALID_CURSOR`.

The Command Center route validates before resolving a pool or operator and the
overview repository validates before `pool.connect()`. Canonical graph aliases
also parse query filters before their broad operator lookup. Repository and
mounted tests cover validation-before-connect, 101-row pagination, exact
microseconds, stable keysets, malformed and forged inputs, reused cross-tenant
cursors without disclosure, stale cursors, and mutation between pages.

## M22-P5-010 — one-character mobile Daily Brief columns

At widths up to 768 CSS px the Daily Brief heading stacks title and tenant-time
update, with both elements bounded to the full available width and the timestamp
allowed to wrap. Real installed Chrome and actual Playwright WebKit geometry now
reports a 324 px title and timestamp, a one-line title, and column layout at a
390 px viewport. Desktop layout remains unchanged.

Both mobile screenshots were inspected: the Daily Brief and "What Needs
Attention" heading are readable and no longer collapse to one character per
line. This is writer evidence; user visual approval remains separate and
unclaimed.
