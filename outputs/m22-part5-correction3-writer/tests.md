# Test evidence

- Mounted Parts 1–5 PostgreSQL 18.4 UTC: `5/5` suites, `68/68` tests.
- Affected Part 1–5 unit/static/ratification: `9/9`, `112/112`.
- Historical canonical contract/M19/M20 navigation/transcript/API: `4/4`,
  `106/106`.
- Installed Chrome desktop/light and mobile/dark: green.
- Actual Playwright WebKit desktop/dark and mobile/light: green.
- Available full Jest: `151/152` suites and `2,110/2,134` tests.
- Sole non-pass: exactly 24 `account-migration-010-postgres` cases because four
  `ACCOUNT_MIGRATION_*` disposable URLs were absent. Unavailable is not passing.

Raw Jest outputs are preserved under `raw/`. The CSS-only product change did not
alter mounted PostgreSQL behavior; the browser test adds the exact property that
the previous green workflow matrix omitted.
