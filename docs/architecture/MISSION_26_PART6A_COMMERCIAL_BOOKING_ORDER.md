# Mission 26 Part 6A — shared commercial and scheduling source order

Status: isolated, unreleased bounded source prerequisite. Full Part 6A remains open.

Migration 156 gives new Mission 22 human scheduling approvals and new Mission 24
customer estimate acceptances/link revocations one tenant-private commit order.
The source writers hold the same tenant advisory lock through commit, then append
an immutable sidecar row. Rolled-back sequence gaps are not missing events. The
sidecar does not backfill approvals or responses that occurred before its
installation. Existing Mission 22 approval receipts and Mission 24 issued
estimate, delivery and response contracts retain their behavior.

Customer acceptance belongs to one immutable issued estimate version. A
subsequent link revocation is retained separately. The order records source
identities and event kind; it does not copy names, contact details, documents,
amounts or response bodies. Ordinary runtime access to the table, sequence
and trigger helpers is withheld. There is no direct API reader or forecasting
projection in this candidate.

This order permits a later guarded same-tenant read to ask whether a specific
customer-accepted estimate version was visible before a specific human
scheduling approval. It does not decide that the scheduled work is a booked
commercial commitment: an accepted estimate may refer to different work, an
appointment may have been booked before the new fence, and scheduling may
later be changed or cancelled. A later candidate must prove the opportunity
and work relationship, first booking/correction status, currency and exact
price decision, source-window completeness, currentness and authorized
review before assigning booked-work value. Off-platform business remains
unknown. Nothing here issues earned revenue, cash or a forecast.

A disposable PostgreSQL test exercises the existing customer estimate issue,
public acceptance and owner link revocation routes plus two normal Mission 22
human approvals. It verifies one ordered four-event stream, idempotent
customer-acceptance replay, runtime privacy and immutability. A second case
holds the tenant fence while a public acceptance waits, then verifies the
event appears only after release. It also rolls back an inserted acceptance
and verifies there is no phantom sidecar event, even though its sequence value
is consumed. This does not prove two different source writers contending
simultaneously. The previously
passing four guarded booking-receipt cases were rerun after migration 156 to
check its additive effect. These focused fictional-tenant results do not prove
cross-source positive price linkage, a historical observation period, wider
Mission 22 suite success, CI, private production or full Part 6A acceptance.
