# Mission 26 Part 6A: ordered-price calendar-month candidate

Status: pure calculation candidate also consumed by a guarded paid diagnostic route. Part 6A remains open.

The pure evaluator accepts one ordered-price readback-shaped input and an exact UTC
calendar month. It returns an unavailable result unless the month begins after
the first source-order fence, ends no later than the receipt capture, and the
source is still current. It checks event count, receipt identifier and digest shape,
event shape, duplicate decisions and nondecreasing source-observation times.
A source clock reversal, an event outside the anchor-to-capture interval, a
partial month or an unclosed month fails closed.

A candidate whose window checks pass reports `inputOrderTimestampDecisionCount`,
counting supplied Mission 24 events whose `sourceObservedAt` falls in the
requested month. A separate provisional first-approval amount, when requested,
uses Mission 24 `recordedAt` for commercial decision-time attribution. Those
two fields can therefore differ for later-ordered decisions. Neither proves continuous source
coverage, including when the supplied event array is empty. This is **not** an approved-price amount, booked
work, earned revenue, collected cash or whole-business zero. The evaluator
does not authenticate direct inputs; the mounted paid route separately guards
and reads its private receipt. Direct pure-function results retain
`sourceAuthenticated: false`; the guarded route may attest to its current
bounded receipt as described in the source-window proof. Both retain
`sourceMonthVerified: false`,
`calendarPeriodVerified: false`,
`eligibleForForecast: false` and `forecastIssued: false`. The count is a
synthetic diagnostic for later guarded integration and evaluation.

The private source order, not Mission 24 `created_at`, determines which events
belong after the first fence. `sourceObservedAt` is a wall-clock observation
inside that order and is assigned by a trigger before transaction commit. A
month-end trigger timestamp can therefore precede durable commit and reader
visibility in the next month. The evaluator rejects timestamp regressions, but a
later decision or clock anomaly can stale an earlier receipt. A future
source-authenticated, revision-aware monthly baseline needs exact run
currentness, correction/withdrawal semantics, overflow recovery, enough
comparable covered periods, and independent acceptance before numerical
forecasting. Off-platform completeness remains a separate question.
