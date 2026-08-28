# Mission 22 Part 6 terminal writer test evidence

## Exact implementation gates

- Focused mounted Part 6 PostgreSQL plus contract tests: 2/2 suites and 12/12
  tests green in 5.018 seconds. The mounted suite covers the employee direct
  and current-active-crew boundary, tenant/IDOR and forged scope, revoked or
  divergent session/member/user/workforce/crew authority, paid/demo isolation,
  hostile durable bytes, bounded response shape, exact approval pins, tenant
  time/DST boundaries, rollback/release, safe search path, and restricted
  runtime-role behavior.
- Explicit Mission 22 Parts 1–6 compatibility selection: 13/13 suites and
  169/169 tests green in 50.788 seconds.
- Locally available full Jest corpus, excluding only the separately documented
  unavailable account-migration environment: 153/153 suites and 2,130/2,130
  tests green in 587.716 seconds; zero snapshots.
- PostgreSQL 18.4 UTC startup/restart: 33 migrations applied to the fresh
  database; zero on restart; migration 035 applied exactly once at the exact
  protected checksum; both credential-free health requests returned 200;
  startup stderr was zero bytes; runtime role could create neither a database
  nor objects in `public`.
- Browser evidence: eight matrices, 96 screenshots, Chrome
  `151.0.7922.173` and actual Playwright WebKit `26.5`, desktop/mobile and
  light/dark. Every matrix recorded eight Today responses, zero external/
  provider calls, zero worker-mutation requests, and zero browser errors.

## Raw evidence map

- `raw/part6-focused.stdout.log` and `.stderr.log`: exact focused Part 6 run.
- `raw/parts1-6-compatibility.stdout.log` and `.stderr.log`: explicit serialized
  compatibility selection.
- `raw/full-jest.stdout.log` and `.stderr.log`: locally available full corpus.
- `raw/startup-restart.json` and `.stderr.log`: PostgreSQL/startup/restart/
  checksum/runtime-role/health record.
- `raw/browser-*.stdout.log` and `.stderr.log`: each real-browser matrix.
- `employee-only-screenshots/manifest.json`, `manifest.md`, and
  `screenshots.sha256`: machine/human screenshot ledger and exact hashes.

Intermediate failures remain preserved in `intermediate-failures.md`; none is
silently relabeled passing. A green writer matrix is not independent approval.
