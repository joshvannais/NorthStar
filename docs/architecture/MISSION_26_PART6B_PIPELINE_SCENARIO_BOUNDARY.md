# Mission 26 Part 6B — guarded open-pipeline scenarios

Status: single-package implementation candidate. Part 6B becomes the twenty-first
scoped-accepted Mission 26 slice only after this exact package passes a fresh
independent exact-head audit, merges normally, and completes its sole automatic
deployment verification. There is no separate documentation gate, second pull
request, or second deployment. This package adds no customer-facing UI.

Migration 235 replaces the old caller-supplied arithmetic helper with one
server-selected, tenant-private research lifecycle for
`pipeline.open_value_scenario.v1`. Paid owners and admins may review bounded
scenario assumptions, capture a genuinely future origin, and append an
evaluation after that origin's full horizon. HTTP responses expose lifecycle
identity and honest boundary flags only. Scenario weights, prices, members,
source manifests, totals, outcome receipts, and comparison metrics remain in
private PostgreSQL evidence.

## Authenticated cutoff population

The origin uses migration 222's current, post-epoch
`pipeline_first_booking` open-risk population. It does not treat raw estimate
existence or an opportunity's mutable status as proof that work belongs in the
open pipeline. Migration 235 records every estimate through an insert sidecar
and generation fence, enumerates the tenant's bounded estimate inventory, and
fails closed on a missing sidecar, ordering gap, duplicate current estimate, or
an unmatched open-risk member.

Each open member is classified exactly once:

- `preliminary_estimate` uses the current estimate's before-tax price only
  when no Mission 24 decision exists;
- `approved_unbooked` requires the current Mission 24 approval and its exact
  issued customer estimate version, price, currency, revision, decision,
  digest, and source-order lineage; and
- withdrawn, booked, corrected, cancelled, reviewed-but-unconfirmed, and
  outside-open-risk records are retained in the private exclusion manifest and
  never contribute scenario value.

The origin also pins the current prospective Business Profile, policy review,
pipeline epoch, open-risk digest, Part 6A integrated commercial source digest,
estimate high-water order, complete status counts, and the registered method
closure. A current policy or profile change before the future horizon starts
requires a new origin. Once the horizon starts, the cutoff inputs stay frozen:
legitimate later lifecycle progress does not rewrite or stale them. Each
estimate fence is locked and its generation advance must reconcile exactly to
timestamped post-cutoff decision, labor-plan, and estimate-revision records.
An unexplained generation advance, missing lineage, or a late observation
whose effective time belongs at or before the cutoff still fails closed for
the origin's full lifetime.

## Scenario arithmetic and meaning

The reviewed policy contains ordered lower, central, and upper weights in
millionths for the two categories. They are explicit planning assumptions, not
learned probabilities. Each total multiplies raw integer cents by the selected
millionth weight across both categories, sums those products, and rounds only
once after the whole sum. Category displays use the same bounded integer
arithmetic, but their separately rounded values are not added to obtain a
total. This prevents cross-category rounding drift.

The resulting range is a private open-pipeline scenario. It is not a revenue
forecast, calibrated interval, confidence bound, earned-revenue amount,
invoice, payment, collection, cash position, or authority to change an
estimate or schedule. Every receipt remains `researchOnly=true`,
`probabilityCalibrated=false`, `realForecastEligible=false`,
`forecastIssued=false`, `paidNumericServing=false`, and actionless.

## Frozen-cohort outcome

After the complete half-open horizon, evaluation considers bookings only for
the exact frozen members; post-cutoff entrants remain excluded. The outcome
first authenticates every tenant accepted-booking event in the horizon to its
matching migration 222 visibility row and exact schedule revision. A
`human_preview_approved` event must bind the same assignment, appointment,
revision, digest, request, and occurrence time to its owning human preview
approval. Any uncovered, duplicated, or mismatched accepted event makes the
whole outcome unavailable, including events for nonmembers.

A frozen member counts only when that same accepted event is joined to the
exact commercial review and estimate lineage that was effective no later than
the booking. The receipt pins the approval, acceptance, issued version,
decision, order, request/canonical digests, reviewed price, and currency. A
member with no booking records explicit null booking lineage. There is no
additional Part 6B owner-confirmation event: the existing human schedule
preview approval and exact commercial review are the event-flow authorities.
Unresolved price or lineage evidence makes the complete evaluation unavailable
rather than silently becoming zero.

The immutable evaluation compares actual booked-work value for that frozen
cohort with the saved scenario range and labels it below, inside, or above.
That descriptive comparison does not calibrate the assumptions or select a
commercial action. Re-evaluation appends a revision; source correction changes
the outcome digest and requires a new idempotent request.

## Persistence, privacy, and recovery boundary

The policy, origin, and evaluation ledgers are append-only and tenant-scoped.
Reads recompute stored evidence, output, metrics, outcome, policy-review, and
method-closure digests before returning metadata. Startup independently
reconstructs the registered migration 234/235 function and trigger closure;
checks exact columns, defaults, constraints, owners, sequences, indexes, and
the complete enabled trigger set; revokes all table, column, sequence, and
helper access; and grants the runtime role only the six guarded policy/origin/
evaluation entry points. A disposable test-only clock requires an explicit
transaction-local test GUC and refuses both direct and assumed runtime-role
callers even if execution is mistakenly granted.

The implementation proves deterministic behavior over synthetic PostgreSQL
fixtures, including fresh and rolling migration, restart/startup authority,
policy/origin/evaluation replay and key-collision handling, concurrent
single-effect capture, role and tenant privacy, bounded evidence and review
history, exact cross-category rounding, late-lineage refusal, complete-zero
outcomes, and a three-member mixed-category lifecycle with an event-time
reviewed booking, explicit no-booking receipts, post-cutoff entrant exclusion,
and later correction and cancellation. It does not prove CI, private
production-tenant behavior, provider or credential behavior, off-platform or
whole-business completeness, natural conversion history, empirical accuracy,
real calibration or drift, physical Safari/devices, or complete accessibility.
Part 6B changes no browser code or customer-facing UI, so no fresh Part 6B
browser-render or visual verdict is claimed. Playwright WebKit is not physical
Safari evidence.
