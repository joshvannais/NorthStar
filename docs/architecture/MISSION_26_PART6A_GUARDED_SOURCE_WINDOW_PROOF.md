# Mission 26 Part 6A: guarded ordered-source UTC window evidence

Status: isolated, unreleased bounded prerequisite. Part 6A remains open.

The paid owner/admin month diagnostic now distinguishes a pure candidate from
the result of reading its immutable receipt through the guarded database
function. When the receipt is current at the locked read, its first source
fence precedes the requested UTC month, its capture follows the month, and all
bounded source events pass the structural and lineage checks, the response sets
`sourceAuthenticated` and `sourceOrderUtcWindowObservedAsOfCapture` to true.
The response pins the receipt id, capture time and source digest. This means
NorthStar's post-anchor Mission 24 price-decision order for that UTC window was
observed **as of that receipt capture**. It does not establish that those
decisions were durably visible at the end of the requested month: sidecar
timestamps are assigned before transaction commit.

A later price decision makes an earlier receipt stale on guarded read. A
backdated first approval may change decision-time attribution in a later
receipt. This response does not select a company-local business calendar,
certify complete off-platform business activity, establish booked work,
validate first-approval amount as a future baseline, or make an empty event
window a whole-business zero. `sourceMonthVerified`,
`calendarPeriodVerified`, `eligibleForForecast`,
`wholeBusinessCoverageVerified` and `forecastIssued` remain false. A failed
window or source check leaves source authentication and the window proof false.

The pure evaluator still returns `sourceAuthenticated: false` for direct,
unauthenticated inputs. The guarded route promotes only the bounded receipt
provenance, not the forecast. Synthetic route tests cover a passing empty
receipt-shaped input and poisoned/stale inputs. A positive closed post-anchor
month cannot yet be observed in mounted PostgreSQL because the first source
anchor is current. That evidence, rolling overflow recovery, company calendar
policy, booked-work lineage, enough comparable periods, and independent
acceptance remain open.
