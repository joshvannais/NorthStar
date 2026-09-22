# Mission 26 Part 6A — mounted historical approved-price review

The private `/api/v1/forecast/price-history` route gives a current paid owner or
administrator a narrow way to capture and read the existing Mission 24 price
decision source receipt. Capture uses the released guarded PostgreSQL function
inside a serializable transaction with the authenticated tenant, actor,
session, CSRF and idempotency key. The response excludes the event rows and
returns only the snapshot identity, source digest, cutoff and event count.
The separate read recomputes the approved-price position from the guarded
snapshot and checks currentness. A stale source remains unavailable.

This is historical **approved commercial price activity**. It is not a
forecast, booked work, earned revenue or cash. The route does not accept
customer, tenant, role, decision, source-event or price values from the
browser. Forecast permission is owner/admin only, and both responses are
private and no-store. Capture has a conservative per-tenant availability rate
limit in addition to the existing bounded source size; that in-memory limit
is not a durable database quota. No customer-facing or demo route is added.

The source trace found no reviewed same-tenant link proving that a Mission 24
issued-estimate acceptance is the Mission 22 first booking of the quoted job.
An appointment can be a consultation or site visit. Part 6A booked-work value
therefore remains unavailable until the owning source authorities provide
the reviewed first-booking and effective-price link. Customer acceptance,
schedule recommendation and approved price are kept as distinct facts.

This route does not close Part 6A, Part 6B or Part 12A. It does not create an
immutable forecast run, a future price-flow method, calibrated probability,
booking source, demo parity or a monthly revenue card. The existing published
Mission 24 and Mission 25 records and decisions are unchanged.
