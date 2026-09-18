# Mission 25 Part 13F acceptance evidence

## Frozen scope

**Canonical title:** Explicit owner adoption through the authority that owns the affected business-profile or planning value.

The immutable base is `48658790426cf0ec82ab40d8572c25ecc81f18ee`, the independently accepted Part 13E head. Migration `129_canonical_job_outcome_planning_adoption.sql` adds an immutable, per-service planning-value authority over exact current Part 13E multiplier measures.

Only the current owner can adopt or roll back a planning value. Every action pins the current saved registry revision, exact preview and selected measure for adoption, or the exact prior planning revision for rollback. Current exact retries are idempotent and concurrent requests serialize. Stale proposal lineage, retired permission periods, superseded registry versions and changed planning revisions fail closed. Rollback can restore an exact earlier value or leave it unset without reviving retired learning evidence.

Financial reference values, scope, unavailable measures and absolute amounts cannot be adopted. No estimate, price, schedule, job, asset, material, connected financial record, business profile, provider record or company policy changes in this slice. Part 13G lifecycle propagation and Part 13H rendered experience remain outside this slice. Mission 27 remains the authority for native financial truth.

## Executable evidence

- Fresh disposable PostgreSQL 17 applied migrations 001-129 and passed the mounted Part 13 A-F matrix: 18 suites and 63 tests.
- Focused Part 13F API, contract and ratification evidence passed: three suites and 15 tests. The related Mission 24 labor-plan and cost-composition suites passed 48 tests, and the proposal-adoption contract passed its four Node test cases.
- Mounted evidence covers a five-job imported-labor cohort, current registry selection, concurrent adoption replay, planning revision history, source staleness without automatic removal, permission revocation, non-revival after regrant, exact rollback, unset recovery, tenant and role isolation, immutable storage and entry-only runtime authority.
- Startup checks fail closed when the planning table or helper is exposed and restore exactly the four guarded runtime entries.
- `git diff --check` and Node syntax checks are required before handoff.

## Evidence boundaries

No provider connection, credential, private production record, production deployment, physical device or manual assistive-technology review is claimed. No rendered path changes in this slice, so browser screenshots and responsive visual review are not applicable. API messages are reviewed for plain business language.
