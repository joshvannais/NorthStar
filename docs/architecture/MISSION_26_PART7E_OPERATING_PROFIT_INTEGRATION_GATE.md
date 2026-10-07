# Mission 26 Part 7E — operating cost, profit and margin integration gate

Status: implementation candidate. Migration 244, the private paid read, the
shared paid/demo Command Center surface and retained acceptance evidence are
complete in the writer checkout. Part 7 acceptance still requires a fresh
independent whole exact-head audit and the normal release lane.

## One composition, one compatible revenue target

The forecast starts from each booked job's newest exact Mission 24
`estimate-cost-adoption-v3` revision and its matching source-authenticated
proposal-adoption receipt. The receipt must pin the same material, labor,
equipment, travel, component manifest, coverage review and pricing plan. The
approved owner-confirmed booked price before tax supplies the planning revenue
target. The forecast does not add the independent Part 7A-D aggregates and it
does not describe approved price as earned revenue, invoiced revenue, collected
cash or recognized revenue.

Every included job must be current in the Part 7A labor, Part 7B material and
Part 7C equipment/travel gates and in the complete booked-work cohort. Currency,
tenant, commercial state and source revision must agree. A missing, newer,
corrected, cancelled or incompatible plan, price, booking or source fails the
whole result closed as unavailable. A complete zero remains different from an
absent source, and margin requires a known positive denominator.

## Monthly economic cost and dated cash

The exact approved schedule supplies the work interval. Revenue, direct job
cost and incremental job overhead are attributed by elapsed seconds across
tenant-local month boundaries, with the final piece retaining any rounding
remainder. A job crossing a month is therefore split between its months rather
than placed wholly in its start month. The outer horizon remains exactly
2,592,000 elapsed seconds; tenant-local dates are used only for expense coverage
and month labels, including across daylight-saving changes.

An append-only owner/admin policy records fixed and variable period expenses,
complete local-date coverage, source attestations, a current Part 7D schedule
pin, an explicit overlap reconciliation and two to five named deterministic
scenarios. Period expenses are recognized by covered local days. Direct job
cost, incremental job overhead, fixed expense and variable expense form
economic operating cost. Part 7D overhead and financed-asset due amounts form a
separate dated-cash total. Economic recovery, financing cash and actual payment
remain distinct; dated cash is never inserted into accrual profit.

Scenario cost, profit and margin are deterministic consequences of each named
cost assumption. They carry no calibrated interval or probability claim.
Mission 25 adjustments are not applied, and the response explicitly preserves
the still-unavailable external-event and scope-change classifications.

## Authority, currentness and recovery

`canonical_operating_profit_policy_revisions` is append-only and tenant private.
Owner/admin mutations require the current Business Profile, current Part 7D
schedule revision, CSRF, idempotency and serializable source locks. The runtime
role receives only the guarded policy mutation/read and aggregate forecast
entry points. Raw policy rows, helper functions, estimate/job identities and
component facts are withheld from the browser response.

The paid route uses one read-committed server-selected cutoff and returns only a
strict aggregate. The isolated demo uses the same response validator and
renderer with fictional data and never calls the paid route. Loading, malformed
responses, failures and unavailable evidence clear prior KPI values and graph
marks before rendering the explanation. Recovery rereads and repaints the
current aggregate.

The existing Command Center cost-and-operational-risk card now contains three
monthly KPIs, one compact profit-range graph, plain-language explanation and a
collapsed source-boundary drilldown. It does not add a dashboard or commercial
action.

## Acceptance boundary

Focused proof covers component quantities and exact duplicate prevention, a
job spanning months, fixed and variable expenses, economic cost versus dated
cash, named scenario changes, zero versus absent values, current/corrected/
cancelled histories, source cutoff and concurrency, currency, time zone and
DST, tenant/role/commercial authority, CSRF and idempotency, Mission 25
attribution boundaries, paid/demo isolation and failure recovery. Whole Part 7
proof reruns the mounted A-E lifecycle and strict Chrome and Playwright WebKit
paid/demo, mobile/desktop and light/dark journeys.

The frozen writer candidate retained 10 focused and whole-Part-7 suites with
44 passing unit/integration cases against a disposable PostgreSQL full
migration chain through migration 244. It also retained 16 strict full-page
browser journeys: eight Chrome and eight Playwright WebKit combinations across
paid/demo, mobile/desktop and light/dark. Those journeys cover KPI cards,
graph, drilldown, loading/failure/unavailable recovery, keyboard focus, ARIA,
overflow, reduced motion and measured key-text contrast. Static validation
found 233 unique HTML IDs, no missing ARIA references and no broken local
links. This is writer evidence for the candidate; it is not the required
independent audit or release evidence.

CI, private-production/provider/credential evidence, physical Safari/devices,
complete accessibility and the founder visual verdict remain unavailable and
must not be inferred from local acceptance evidence.
