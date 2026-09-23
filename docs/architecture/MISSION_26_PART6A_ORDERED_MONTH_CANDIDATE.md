# Mission 26 Part 6A: ordered-price calendar-month candidate

Status: unmounted, unauthenticated calculation candidate. Part 6A remains open.

The pure evaluator accepts one ordered-price readback-shaped input and an exact UTC
calendar month. It returns an unavailable result unless the month begins after
the first source-order fence, ends no later than the receipt capture, and the
source is still current. It checks event count, receipt identifier and digest shape,
event shape, duplicate decisions and nondecreasing source-observation times.
A source clock reversal, an event outside the anchor-to-capture interval, a
partial month or an unclosed month fails closed.

A candidate whose window checks pass reports `inputObservedDecisionCount`,
counting supplied Mission 24 events whose `sourceObservedAt` falls in the
requested month. A separate provisional first-approval amount, when requested,
uses Mission 24 `recordedAt` for commercial decision-time attribution. Those
two fields can therefore differ for late-observed decisions. Neither proves continuous source
coverage, including when the supplied event array is empty. This is **not** an approved-price amount, booked
work, earned revenue, collected cash or whole-business zero. The evaluator
does not authenticate its input and remains unmounted; every result retains
`sourceAuthenticated: false`, `sourceMonthVerified: false`,
`calendarPeriodVerified: false`,
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
