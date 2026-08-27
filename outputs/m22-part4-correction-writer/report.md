# Mission 22 Part 4 narrow correction writer evidence

Status: M22-P4-001 and M22-P4-002 corrected; exact-new-head independent
re-audit pending.

This is writer evidence, not an audit verdict. The writer did not mark PR #147
ready, merge, deploy or restart Railway, access production, call a provider, or
begin Part 5.

## Correction boundary

The correction changes no UI and introduces no new credential, capability,
plan, provider, or broad runtime-role authority. Migrations 001-034 remain
byte-for-byte unchanged. The unmerged additive migration remains 035.

M22-P4-001 is closed at the database mutation boundary. Both runtime-executable
entry routines take the existing tenant mutation lock. A schema-qualified,
fixed-search-path `SECURITY DEFINER` helper independently derives every current
Part 2 hard-conflict class from locked appointment/opportunity, workforce,
membership/account, crew, skill, location, availability, and approved schedule
state. The helper is withheld from the runtime role. Preview creation requires
the submitted hard array to equal the trusted database result; approval
recomputes that result and rejects any current hard conflict. Recommendations
remain non-authoritative and make no provider call.

M22-P4-002 is closed with live database wall time. Actor/session/subscription
authority is sampled with `clock_timestamp()` after its rows are locked.
Approval reacquires that current authority after the assignment and conflict
read sets are locked, applies the inclusive expiry decision at the returned
live instant, and records that same instant on approval, assignment,
appointment, audit, and idempotency evidence. Preview lifetime begins after its
current authority locks and remains exactly fifteen minutes.

The application repository takes the same tenant lock before mounted Part 2/3
evaluation so the source-to-sink lock order is stable. No compatibility route
regains direct mutation authority.

## Result

The exact ordinary-runtime forged-clear overlap reproduction now rejects before
it can create a forged preview, and the held-transaction and lock-wait expiry
reproductions reject after the live inclusive boundary. Each regression proves
zero mutation, approval, audit, and idempotency side effects. Mounted hard-class
tests cover declared unavailability, location, skill, inactive crew members,
inactive/unavailable direct targets, and approved person overlap; existing
Parts 1-4 matrices retain all six actions, person/crew/unassigned targets,
dispatch revocation, rollback, replay, concurrency, DST/UTC, warning/review,
and recommendation/no-provider behavior.

See `finding-closure.md`, `test-evidence.md`, `ref-inventory.md`, and
`unavailable-evidence.md`. A different fresh read-only auditor must review the
complete PR at the frozen new head before any ready/merge/release action.
