# Test evidence

- Mounted Parts 1–5 PostgreSQL 18.4 UTC: `5/5` suites, `69/69` tests.
- Affected Part 1–5 unit/static/ratification: `9/9`, `114/114`.
- Historical canonical contract/M19/M20 navigation/transcript/API: `4/4`,
  `106/106`.
- Installed Chrome 151 desktop/light and mobile/dark: green.
- Actual Playwright WebKit 26.5 desktop/dark and mobile/light: green.
- Available full Jest: `151/152` suites and `2,113/2,137` tests.
- Sole non-pass: exactly 24 `account-migration-010-postgres` cases because four
  required disposable URL groups were absent. Unavailable is not passing.

The mounted correction test covers 105 active profiles, 102 active crews, 207
unique target keys over nine pages, duplicate hostile search, omitted last-page
worker/crew selection, employee/inactive/cross-tenant denial, subscription read-
only separation, invalid/oversized query and cursor forms, target deactivation
between lookup/preview/approval, and exact durable approval results. Raw Jest and
browser outputs are preserved under `raw/`.
