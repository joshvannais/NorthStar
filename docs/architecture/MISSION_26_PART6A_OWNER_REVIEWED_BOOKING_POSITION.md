# Mission 26 Part 6A — owner-reviewed job price position

Status: isolated, unreleased single-job candidate. Full Part 6A remains open.

Migration 164 reads one immutable human commercial review through the guarded
currentness function. A current first or corrected review yields the exact
approved before-tax price and currency with commercial status
`owner_reviewed_booking`. Superseded, cancelled, revoked, stale, missing or
cross-tenant reviews yield an unavailable state without an amount. The read
holds the tenant source locks through the transaction, rechecks the accepted
estimate, price and schedule, and uses paid owner/admin authority. The mounted
internal route allowlists the amount and status only for the positive state.

This is an **owner-reviewed job price candidate**, not verified booked work,
earned revenue, collected cash, a complete historical period or a forecast.
The existing human review does not prove an actual first booking or all work
outside NorthStar. Responses therefore keep `bookedWorkVerified: false`,
`historicalCoverageVerified: false` and `forecastIssued: false` even when the
recorded evidence is current. The position must not be summed into a
whole-business monthly baseline without separate source coverage and booking
authority.

Four mounted fictional-tenant tests pass with a positive first-review price,
positive corrected-review price, and unavailable superseded/cancelled paths.
Changed-scope and changed-price correction, source-period completeness,
first-actual-booking authority, paid/demo frontend journey, release and live
validation remain open. The wider Mission 22 regression is not green.
