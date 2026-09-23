# Mission 26 Part 6A: mounted ordered-price month diagnostic

Status: isolated, unreleased bounded prerequisite. Part 6A and Part 12A remain open.

The paid `/api/v1/forecast/price-history/ordered-snapshots/:snapshotId/month-candidate`
read uses the existing owner/admin forecast permission and guarded tenant-scoped
ordered-receipt function. It accepts exactly one UTC calendar month. The server
passes the private readback directly to the pure month evaluator and returns
only a minimized diagnostic; source events, prices, customer information,
private order and digest nonce never enter the HTTP response.

The response reports whether candidate window checks passed and how many
supplied decision events fell in that month. Even after a guarded read, the
candidate does not verify continuous calendar coverage, an empty business
period, booked work or a future price flow. Its `sourceMonthVerified`,
`calendarPeriodVerified`, `eligibleForForecast` and `forecastIssued` fields
remain false. Pre-anchor, unclosed, stale and malformed source windows stay
unavailable. No customer-visible forecast or commercial decision is issued.

Focused route tests cover minimized output, invalid requests, denied roles and
poisoned shapes. Mounted disposable-PostgreSQL tests cover current paid access,
pre-anchor unavailability, tenant hiding and source privacy. This does not
release the stacked migrations or close the original Part 6A scope.
