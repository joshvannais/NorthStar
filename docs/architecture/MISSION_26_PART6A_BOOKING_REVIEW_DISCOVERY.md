# Mission 26 Part 6A: recent booking review candidates

The paid owner/admin `GET /api/v1/forecast/booking-reviews/candidates` route discovers up to 100 recent current human scheduling approvals with an accepted issued estimate and a still-current reviewed price. It returns appointment and approval IDs, scheduled time and before-tax price so a booking review screen can show a specific job. It does not mark that job booked or create a forecast. A later accepted scope, changed schedule or price can make a displayed candidate stale; the human review write checks the source again and may refuse it. The UI must refresh rather than assume a displayed candidate grants write authority.

The query runs under the tenant commercial source lock, returns unavailable without a list above its bound, and excludes appointments already carrying a commercial review. The runtime role cannot read source tables directly; only paid owner/admin sessions can call the guarded route. An empty list means no **observed review candidates in this bounded source**, not zero work in the business.

The focused mounted fictional-tenant test exercises one positive candidate, absence after review, other-tenant empty result and member denial. A paid/demo frontend journey, rendered wording, cross-source contention, source-complete period, release and full Part 6A acceptance remain open.
