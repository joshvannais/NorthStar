# Mission 26 Part 6A: ordered-price calendar-month candidate

Status: unmounted, unauthenticated calculation candidate. Part 6A remains open.

The pure evaluator accepts one guarded ordered-price readback and an exact UTC
calendar month. It returns an unavailable result unless the month begins after
the first source-order fence, ends no later than the receipt capture, and the
source is still current. It checks event count, immutable receipt identity,
event shape, duplicate decisions and nondecreasing source-observation times.
A source clock reversal, an event outside the anchor-to-capture interval, a
partial month or an unclosed month fails closed.

A structurally covered result counts only Mission 24 decisions observed in
NorthStar during that month. This is **not** an approved-price amount, booked
work, earned revenue, collected cash or whole-business zero. The evaluator
does not authenticate its input and remains unmounted; every result retains
`sourceAuthenticated: false`, `calendarPeriodVerified: false`,
`eligibleForForecast: false` and `forecastIssued: false`. The count is a
synthetic diagnostic for later guarded integration and evaluation.

The private source order, not Mission 24 `created_at`, determines which events
belong after the first fence. `sourceObservedAt` is a wall-clock observation
inside that order. The evaluator rejects observed clock regressions, but a
later decision or clock anomaly can stale an earlier receipt. A future
source-authenticated, revision-aware monthly baseline needs exact run
currentness, correction/withdrawal semantics, overflow recovery, enough
comparable covered periods, and independent acceptance before numerical
forecasting. Off-platform completeness remains a separate question.
