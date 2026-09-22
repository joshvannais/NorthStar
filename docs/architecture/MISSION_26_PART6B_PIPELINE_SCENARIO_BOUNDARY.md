# Mission 26 Part 6B — open-pipeline scenario boundary

The bounded, unmounted `pipelineScenarioDiagnostic` tests arithmetic for
caller-supplied **assumptions** about open opportunities. It separates
preliminary estimate prices from human-approved but unbooked prices. Booked
work belongs to Part 6A and is rejected here to prevent double counting.
Neither open category is earned revenue or collected cash. The function has
no source reader, route, saved run, UI or automatic commercial action.

Each opportunity has one estimate identity, one price status and one exact
currency. Three assumed conversion weights are supplied in millionths and
ordered lower/central/upper. Deterministic multiplication uses integer cents
and rounds only after summing each category. For example, a fictional $100
preliminary estimate with 10%, 25%, and 50% assumptions yields a $10–$50
scenario with a $25 central value. That is **not** a $25 revenue forecast:
the weights have not been derived from the contractor's observed conversion
history. The output explicitly says `deterministic_scenario_only`,
`sourceAuthenticated: false`, `probabilityCalibrated: false`, and
`forecastIssued: false`. Incomplete claimed coverage yields unavailable
values rather than a misleading zero.

Before an authorized paid forecast, owning Mission 24 and lead sources must
establish current estimate identity, price status, price revision, currency,
correction/withdrawal lineage and complete as-of open-pipeline coverage.
Mission 22 must keep booked work separate. Mission 25 supplies only approved,
tenant-private learning. Mission 26 Parts 3B–D require immutable saved
predictions, finalized conversion outcomes, complete denominators, reviewed
sample/calibration policy, applicability and algorithm promotion. A caller's
weights or `complete` claim cannot satisfy those gates. Part 9 owns any later
statistically calibrated interval; the lower/upper values here are scenario
assumptions, not confidence bounds. Mission 27 owns native payment evidence.

The focused synthetic tests cover distinct commercial categories, exact
rounding, observed zero assumptions, incomplete coverage, duplicate estimate
IDs, mixed currencies, coercion, invalid weights and temporal refusal. They
do not establish provider, source, historical, production or statistical
accuracy evidence. Acceptance of this helper cannot close Part 6B as an
issued numerical forecast.
