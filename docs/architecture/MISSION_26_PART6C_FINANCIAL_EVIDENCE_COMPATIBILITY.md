# Mission 26 Part 6C — external financial evidence compatibility

Part 6C can use existing Mission 25 financial evidence as **source context**,
without turning it into NorthStar billing or an issued forecast. The current
authority in `migrations/116_canonical_external_financial_import_authority.sql`
stores consented, provider-neutral invoice, payment, collection and accounting
records with source occurrence time, revision/tombstone lineage, currency,
amount basis, run cursor and a bounded backfill/continuous-update contract.
The import is not a native invoice, payment, collection or accounting entry.
Mission 25's reviewed reference and financial-outcome authority in
`migrations/120_canonical_external_financial_outcomes.sql` then produces
tenant-private, per-estimate advisory observations only while the current
source and purpose permissions remain valid and the reviewed source basis
remains fresh. The [Part 12 acceptance record](../evidence/MISSION_25_PART12_ACCEPTANCE.md)
establishes disposable PostgreSQL and mounted paid/demo tests; it does not
establish a connected provider, private production history or real forecast.

## What the existing observations mean

| Existing observation | Current source rule | Mission 26 use today |
| --- | --- | --- |
| Revenue advice | Explicit posted accounting entry categorized as revenue. | Inspectable external context for one reviewed estimate; not automatically `revenue.earned_value.v1`. An approved recognition basis, complete event-time coverage and corrections are still missing. |
| Collection advice | Explicit collection record with `amount_collected` basis. Invoice or payment status alone does not prove collection. | Inspectable external context; not automatically `revenue.collected_cash.v1`. A reviewed event-time cash definition and complete source reader are required. |
| Realized-cost advice | Explicit posted accounting entries categorized as direct, overhead or other cost. | Context for later Part 7; do not substitute it for complete operating cost or double-count native cost. |
| Margin advice | Difference between compatible recorded external revenue and cost amounts where revenue is positive. | Advisory comparison only; not NorthStar's native operating margin, and not a substitute for Part 7's complete compatible target. |

The M25 read is deliberately per source and estimate, with at most 20 history
entries displayed and a `truncated` indicator. A fresh **current** observation
does not prove which historical records were visible at an earlier prediction
cutoff. Its aggregate amount also does not itself provide a calendar-period
event flow. `createdAt` is the observation time, not the revenue-recognition
or receipt time. Summing current per-estimate advice across a month would
silently mix event periods, corrections, sources and possibly duplicated
financial records. The imported `occurred_at` field is necessary but not
sufficient: an owning, source-scoped period reader must prove event semantics,
reference uniqueness, consent/retention, current or as-of revision, complete
pagination, finality and correction/withdrawal policy.

## Consumption gate

An eventual Mission 26 financial outcome receipt must pin the tenant,
source/purpose permission periods, source and calculation versions, currency,
event-time attribution, exact cutoff and horizon, reviewed estimate/job link
when applicable, deduplicated record manifest, complete period coverage,
recorded-through point, correction/tombstone lineage and source digest. A
source lacking any consequential field must return an explicit unavailable
reason, not zero. Provider failure or revoked permission invalidates later
use; it does not silently rewrite an immutable prior forecast. External
invoice face value, approved estimate price, booked work, accounting advice,
collection advice and received cash remain distinct measures. No foreign
exchange conversion or accounting recognition policy is invented here.

Mission 27 owns native invoice, payment and collection authority. After it
exists, a separately reviewed Mission 26 adapter may derive collected-cash
actuals from accepted payment evidence and forecast collections from
eligible, source-complete history. An invoice marked paid is not enough by
itself. Neither Mission 27's roadmap nor today's external accounting label
establishes an approved earned-revenue recognition policy. That remains an
**unowned source-authority gap requiring founder review** before
`revenue.earned_value.v1` can issue. Mission 26 Parts 3B–D and 11 still own
saved forecasts, later outcomes, calibration, promotion and immutable runs.

This is a compatibility and refusal decision, not a new financial reader,
provider connection, migration, route, UI, accounting policy or numerical
forecast. Part 6C cannot be finally accepted as native cash forecasting
before Mission 27 supplies compatible released evidence.
