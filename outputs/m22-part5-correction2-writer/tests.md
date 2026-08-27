# Test evidence

## Focused and mounted PostgreSQL 18.4 UTC

- Strict cursor unit boundary: `1/1` suite, `21/21` tests.
- Initial focused status and pagination selection: `1/1` suite, `2/2` selected
  tests, including both status aliases and the 101-row cursor matrix.
- Terminal Parts 1–5 mounted compatibility: `5/5` suites, `68/68` tests.
- Affected Part 1–5 unit/static/ratification: `9/9` suites, `112/112` tests.
- Historical canonical contract/M19/M20 navigation/transcript/API: `4/4`
  suites, `106/106` tests.
- Post-corpus status closure: the two historical account suites were green and
  the complete Part 4 mounted authority suite finished `18/18`.

Mounted coverage includes tenant/IDOR, owner/dispatcher/employee, inactive and
revoked sessions, past-due safe reads, hostile bytes, both status aliases,
canonical cursor rejection before connection, 101-row counts and pages, stale
and cross-tenant cursors, stable exact-microsecond keysets, all six Part 4 human
actions, hard conflict/no override, warning acknowledgement, idempotency,
revision/digest, concurrency and refresh behavior, and zero provider authority.

## Locally available corpus

- Initial corpus: `149/152` suites and `2,107/2,134` tests. Besides the 24 known
  unavailable account-migration cases, three failures exposed pending-owner
  compatibility at the newly gated status alias.
- Terminal corpus after correction: `151/152` suites and `2,110/2,134` tests.
- Sole non-pass: `tests/integration/account-migration-010-postgres.test.js`,
  exactly 24 cases because four `ACCOUNT_MIGRATION_*` disposable URLs were not
  provided. This evidence is unavailable, not passing.

Generated Jest JSON is preserved under `raw/`. Green writer evidence does not
grant approval; a different fresh exact-head auditor must rerun independently.
