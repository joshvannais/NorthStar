# Test evidence

- Focused operator-directory unit: `1/1` suite, `6/6` tests.
- Mounted Parts 1–5 PostgreSQL 18.4 UTC: `5/5` suites, `70/70` tests.
- Affected Part 1–5 unit/static/ratification: `9/9`, `114/114`.
- Historical canonical contract/M19/M20 navigation/transcript/API: `4/4`,
  `106/106`.
- Installed Chrome 151 desktop/light and mobile/dark: green.
- Actual Playwright WebKit 26.5 desktop/dark and mobile/light: green.
- Available full Jest: `151/152` suites and `2,114/2,138` tests.
- Sole terminal non-pass: exactly 24 `account-migration-010-postgres` cases
  because four required disposable PostgreSQL URL groups were absent.
  Unavailable is not passing.

Mounted correction coverage includes role/workforce demotion, session revoke,
replace/binding mismatch and expiry, membership/user suspension, dispatcher
removal, subscription change, tenant isolation, hostile bytes, all broad
aliases, target endpoint, 208-target unique traversal through label renames,
explicit stale restart on target-set activation/deactivation/query membership
and crew membership changes, and lowercase/uppercase/mixed UUID queries.

Raw Jest, startup, and browser summaries are preserved under `raw/`.
