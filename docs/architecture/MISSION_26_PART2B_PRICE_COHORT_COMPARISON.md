# Mission 26 Part 2B — supported price cohorts at capture

This bounded comparison joins two normalized local months to NorthStar's
ordered Mission 24 approved-price source. Both months must use the same
prospectively anchored Business Profile version, time zone, area and calendar.
The first price receipt must be separately observed committed before the
earlier month begins. A guarded current receipt must contain the bounded
post-anchor source events and be captured after both months end. Different
currencies, missing anchors, partial periods, changed profiles or source
receipts return unavailable. The paid owner/admin route exposes only the
derived counts and source digest, never private raw event rows.

The reported count is the number of approved-price decision rows whose
**source insert time** falls inside each local month and which are known at
receipt capture. A zero count means no such rows were known **at capture**.
It is not proof that no delayed transaction can later commit with an insert
time inside that month. PostgreSQL insert timestamps are not commit timestamps;
the route therefore keeps `observationCoverageVerified: false`, issues no
forecast, and does not label either month as a finalized historical balance.
The separately activated first receipt proves only the source start was
committed before the first period. Source currentness must be checked again
when a later run uses this comparison.

Focused mounted fictional-tenant tests cover prospective refusal for past
months, tenant/role denial, currency mismatch, and a test-only date-shifted
two-month zero-at-capture comparison across New York daylight saving time.
The date shift exercises the comparison path, not genuinely elapsed history.
Full Part 2B still requires a valid completed-observation coverage method,
positive source events and correction/late-arrival proof, and an independent
full-slice audit. No real customer history or paid forecast is asserted.
