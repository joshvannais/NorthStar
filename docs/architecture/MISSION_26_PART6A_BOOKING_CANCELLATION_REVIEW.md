# Mission 26 Part 6A — commercial booking cancellation candidate

Status: local, isolated and unreleased. Full Part 6A remains open.

Migration 161 lets a paid owner or admin explicitly cancel an earlier human
commercial booking review for the same tenant. The append-only row records
the prior review, reviewer, reason and immutable estimate, acceptance, price
and appointment references. A tenant commercial source lock orders this
decision with other commercial reviews. An identical idempotency request
replays the recorded row; a changed request fails. A stale or already
cancelled prior review cannot be cancelled again. The currentness reader
returns `booking_cancelled` for the cancellation row and treats the earlier
review as superseded.

This is a **commercial review decision**. It does not change the Mission 22
appointment, notify a customer, refund payment, or prove that the job was
cancelled operationally. The result says scheduling needs human review and
never returns a booked amount or forecast. Cancellation remains possible
after the original source evidence becomes stale, since an owner or admin
must be able to withdraw their prior commercial review.

Four mounted fictional-tenant integration cases pass with this migration,
including cancellation, replay, changed replay rejection, stale second
attempt, member denial, cross-tenant unknown, and currentness after the
append. Correction review, paid/demo HTTP mounting, first actual booking,
complete source periods, cross-source simultaneous contention, release and
live-data validation remain open. The wider Mission 22 suite is not green.
