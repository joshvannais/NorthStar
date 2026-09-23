# Mission 26 Part 6A — human review currentness candidate

Status: isolated and unreleased. Full Part 6A remains open.

Migration 160 adds a paid owner/admin, tenant-private read of the immutable
first-booking review recorded by migration 159. It holds the tenant commercial
source lock while comparing the review with the accepted issued version, any
later same-opportunity customer acceptance or revocation, and the latest
human scheduling approval. The reviewed price is rechecked under the Mission
24 decision lock. The current assignment must still point to that approval,
remain scheduled, and have the same nonterminal appointment status. A newer
review for the appointment makes the older review unavailable.

The later-acceptance check uses an indexed tenant/source-kind/order scan and
stops after 1,001 accepted events. More than 1,000 later accepted responses
without a matching opportunity return `acceptance_history_exceeds_bound` and
`reviewCurrentAtRead: false`. A large tenant history cannot silently turn an
incomplete scan into a current review. A more selective opportunity-indexed
projection remains future scale work.

The positive state means only that these **recorded** inputs still agree at
read time. It returns no booked-work amount and leaves first actual booking,
historical coverage, booked-work verification and forecasting false.
Correction/cancellation review writes, paid/demo HTTP mounting, complete
source periods, off-platform activity, release and live validation remain
open. A current read is not a durable saved-run currentness guarantee.

Four mounted fictional-tenant integration cases pass with migration 160
installed. They cover the initial current read, cross-tenant unknown and
member denial, a rollback-only synthetic later accepted response, a
rollback-only synthetic assignment currentness change, and a later customer
link revocation. The existing status-position case also observes a later
approved assignment. The synthetic changes
exercise fail-closed guards; they do not prove a complete real customer or
cancelled-work journey. The >1,000-event bound and production-scale query plan
are not exercised by these focused tests. The wider Mission 22 regression is
not green.
