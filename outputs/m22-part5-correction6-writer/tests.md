# Test evidence

- Focused helper plus mounted Part 4/5 after final source review: `2/2` suites,
  `28/28` tests.
- Mounted Parts 1–5 and Command Center Prelude on PostgreSQL 18.4 UTC: `5/5`
  suites, `71/71` tests.
- Affected Part 1–5 unit/static/ratification: `9/9`, `115/115`.
- Historical canonical contract/M19/M20 navigation/transcript/API: `4/4`,
  `106/106`.
- Installed Chrome 151 desktop/light and mobile/dark: green.
- Actual Playwright WebKit 26.5 desktop/dark and mobile/light: green.
- Locally available full Jest: `151/152` suites and `2,116/2,140` tests.
- Sole terminal non-pass: exactly 24 `account-migration-010-postgres` cases
  because four required disposable PostgreSQL URL groups were absent.
  Unavailable is not passing.

Mounted correction coverage includes all 70 protected aliases, single-client
and single-backend tracing, role/workforce demotion, session revoke/expiry/
deletion, membership/user suspension, subscription and onboarding transitions,
not-found/count paths, injected rollback, connection release, tenant isolation,
and preservation of findings 001–012 and 014–015.

Raw structured Jest and startup results are preserved under `raw/`; real
browser screenshots are preserved under `browser/`.
