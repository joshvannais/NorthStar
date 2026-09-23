# Mission 26 Part 6A: ordered first-approval month diagnostic

Status: isolated, unreleased bounded calculation. Part 6A remains open.

The guarded ordered-price month route can optionally accept an exact currency.
It then calculates a **provisional input first-approval amount** from Mission
24 revision-one approvals whose recorded decision time falls in the requested
UTC calendar month. Amendments and withdrawals do not become additional first
approvals. The source-order timestamp establishes when NorthStar observed the
decision after the first fence; it is not silently substituted for the
commercial decision time. Broken revision links, mixed first-approval
currencies and excessive amounts return unavailable.

An empty supplied month returns no amount, rather than a dollar zero. A
nonempty amount is still only arithmetic over the supplied guarded receipt:
`sourceMonthVerified`, `calendarPeriodVerified`, `eligibleForForecast` and
`forecastIssued` remain false. Late/backdated decisions, future corrections,
source overflow, complete calendar observation and the policy for using later
withdrawals in a future-facing baseline still need explicit proof. This does
not establish booked work, earned revenue or cash.

Focused synthetic tests cover first approval versus amendment/withdrawal,
decision time versus source observation, mixed currency, broken lineage and
the empty input. Mounted PostgreSQL proves current guarded access and the
pre-anchor unavailable case; a positive fully closed post-anchor month is
not yet available for mounted observation. No numerical future forecast is
issued or accepted by this package.
