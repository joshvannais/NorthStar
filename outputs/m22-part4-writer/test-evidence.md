# Part 4 writer test evidence

All PostgreSQL evidence used a disposable PostgreSQL 18.4 server with data
checksums enabled, UTC, loopback-only networking, non-default port 55554, and
separate unprivileged migration/runtime roles where authority mattered.

## Final focused evidence

- Part 4 contract unit suite: 17/17.
- Part 4 mounted role-separated PostgreSQL suite: 11/11.
- Combined Part 4 current focused evidence: 28/28.
- Added final regressions cover crew targeting and crew-membership divergence,
  forged transaction-local authority, and atomic rollback when immutable audit
  insertion is deliberately failed.
- Historical Part 1 PostgreSQL compatibility: 10/10.
- Historical Part 2 PostgreSQL compatibility: 20/20.
- Historical Part 3 PostgreSQL compatibility: 13/13.
- Previously affected API/migration/ratification plus Part 4 rerun: 84/84.

## Full available corpus

- Locally available corpus before the final test-only regression additions:
  149/149 suites and 2,076/2,076 tests, run in-band against PostgreSQL 18.4.
- The final additions did not alter production modules or migrations and their
  exact affected Part 4 suites are green 28/28. This is stated precisely rather
  than relabelling the earlier full run as an exact-later-tree run.

## Migration and restart evidence

- Fresh role-separated 001-035 migration: green.
- Exact ledger equals the production migration loader output.
- Migration 035 appears exactly once.
- Same-database rerun changes no filename, checksum, or applied timestamp.
- Separate supported role-separated 001-034 -> 035 upgrade preserves the
  accepted canonical assignment byte-for-byte and records 035 once.
- Fresh real server startup: credential-free `/api/health` returned 200.
- Restart of the same database: credential-free `/api/health` returned 200.
- First startup applied all 33 repository migration files, including 035 once.
- Second startup logged zero applied migrations.
- Both stderr logs are empty.
- Ledger after restart: 33 rows; migration 035 count 1; checksum
  `64898a637bc1ba3959edbdfdf32f06fb04d2ca4a4a8e0399792c8508a2de86d7`.
- Both Node server processes, the startup database/roles, all suite
  databases/roles, and the disposable PostgreSQL server were stopped/removed.

## Preserved intermediate failures

- Initial migration compile exposed runtime privilege omissions and an
  appointment-trigger ownership boundary. Both were fixed before green suites.
- The first supported-upgrade test run passed product assertions but failed its
  disposable cleanup because roles were dropped before the owned database. The
  exact disposable database was removed first, roles removed second, and the
  rerun passed 9/9 at that stage.
- The first unfiltered corpus run reported 145/150 suites and 2,072/2,100 tests.
  Twenty-four failures were the known unavailable account-migration URL matrix.
  Four failures were actionable: two historical direct-PATCH assertions, one
  historical migration subset that admitted 035 without 032-034, and a spawned
  child process that could not resolve dependencies from the isolated checkout.
  The assertions now prove 428 plus zero mutation, the migration subset defers
  035, the isolated checkout has a local ignored dependency junction, and the
  affected rerun passed 84/84.

## Covered behavior

All six actions; profile, crew, and unassigned targets; schedule and dispatch
state independence; post-dispatch revocation; exact revisions/digests; exact
15-minute inclusive expiry with controlled clock; exact warning/review
acknowledgement; hard-conflict rejection; idempotent retry and divergent reuse;
replay; concurrent previews/approvals; atomic audit failure; tenant/IDOR;
session/member/role/subscription/crew/target/conflict/recommendation divergence;
employee denial; demo exclusion; hostile stored bytes; duplicate JSON and 64 KiB
limits; legacy/direct SQL/internal helper/transaction-local bypass attempts;
DST and UTC compatibility; Part 3 zero-provider-call behavior; fresh and
supported upgrades; migration checksum and restart provenance.
