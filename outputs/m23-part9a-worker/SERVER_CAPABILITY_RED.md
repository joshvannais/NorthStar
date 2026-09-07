# Mission 23 Part 9A explicit worker-capability red evidence

Date: 2026-09-07 (America/New_York)

Writer evidence only; not independent audit approval.

Before the server-capability implementation, the new tests proved that the
mounted worker page had no explicit server-returned action contract:

- `tests/unit/m22-part6-mobile-today.test.js`: 1 failure, 11 passes. The
  projected record had no `workCapabilities` object.
- `tests/integration/m22-part6-mobile-today-postgres.test.js`: 3 primary
  capability failures plus 1 expected cascade after the earlier test stopped
  before creating the crew execution. The real PostgreSQL 18.4 projection had
  no initialization/start action list and the migration entry response had no
  action or kind allowlists.

The tests ran against the disposable loopback PostgreSQL 18.4 cluster on port
55629 (UTF-8, `C/C`, UTC, checksums on). No external or provider call was made.

These failures are preserved before implementation so the browser cannot keep
inferring executable state from lifecycle labels or locally hard-coded action
lists.
