# Mission 26 Part 10A — authenticated forecast timeline boundary

Status: implementation candidate for original Part 10A. Migration 252 and the guarded `GET /api/v1/forecast/timelines/:originId` route mount the weekly, monthly and quarterly current-versus-prior-versus-actual boundary in the shared paid/demo Command Center. Final acceptance still requires the frozen-head audit and normal release lane.

## Current authority

The route starts from one exact current Part 9A deterministic baseline origin. That existing reader authenticates the tenant and role, Retell-only source snapshot, complete three-month observation coverage, Business Profile and time zone, algorithm definition/build/configuration, future monthly horizon, exact unit and all source/configuration/input/output/receipt digests. Migration 252 revalidates that narrow subject contract and returns no baseline amount.

The repository still lacks Part 11's general immutable saved-run ledger and currentness lifecycle. It also lacks a complete authorized inventory that can prove which compatible issued run is current, which earlier compatible issued run is immediately prior, and which later outcome is finalized under the same target, scope, unit, calendar and bucket. Part 3B's released selected-M24 comparison authority is target- and UTC-day-specific; it cannot be relabeled as weekly/monthly/quarterly Retell demand history. Part 3C's descriptive measurement and fictional fixtures do not establish this missing inventory or outcome authority.

## Value-free timeline behavior

The mounted result therefore binds the current authenticated Part 9A subject identity and returns `complete_saved_run_inventory_not_available`. Weekly, monthly and quarterly rows all carry explicit unavailable states with null period boundaries, partial-period status, current value, prior value and actual. This is deliberate: without the complete inventory, even the supplied origin cannot be proven to be the latest applicable run. A prior value is never regenerated at an older cutoff, and an actual is never inferred from a forecast, scenario or unfinalized observation.

If Part 9A becomes stale after a source/profile correction or revocation, the timeline returns `deterministic_baseline_not_current`, clears the subject and timeline digest, and keeps every displayed value unavailable. A newly captured current origin produces a new authenticated subject and digest. Known zero remains a possible future authenticated value; this package never converts absence into zero.

The compact Command Center table labels the three grains and keeps Current, Prior and Actual visibly distinct. Paid mode reads only the guarded route for the selected authenticated origin and never falls back to demo. Demo mode uses an isolated fictional value-free boundary and makes no paid forecast request. Loading, workspace loss, invalid response, source invalidation and recovery clear old values and identities before rendering anything new.

## Deliberate limits

This slice does not create Part 10B KPI bundles, Part 10C drilldowns, Part 10D alerts/recommendations/exports or Part 11 storage. It does not display probabilities, scenarios as facts, revenue/cash/earned value, recommendations or automatic actions. A future additive contract can show a period only after the owning run and actual readers authenticate the complete same-tenant inventory, pre-outcome issuance chronology, compatible business-calendar bucket, current permissions and correction lineage. Physical Safari, live provider/private-production history, natural forecast accuracy and founder visual approval remain separate evidence.
