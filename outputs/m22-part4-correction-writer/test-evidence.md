# Part 4 correction writer test evidence

All mounted database evidence used one disposable PostgreSQL 18.4 server with
data checksums enabled, UTC, loopback-only networking, non-default port 55556,
and separate unprivileged migration/runtime roles where authority mattered.

## Green gates

- Part 4 contract unit suite: 17/17.
- Part 4 mounted role-separated PostgreSQL suite: 14/14.
- Combined focused Part 4: 31/31.
- Mounted Parts 1-4 PostgreSQL compatibility: 57/57
  (10 Part 1, 20 Part 2, 13 Part 3, 14 Part 4).
- Exact current-tree locally available full Jest corpus: 149/149 suites and
  2,081/2,081 tests, in-band, 560.414 seconds.
- Fresh role-separated migration/startup: 33 migrations applied; migration 035
  exactly once; credential-free `/api/health` 200; stderr zero bytes.
- Same-database restart: zero migrations applied; credential-free health 200;
  stderr zero bytes.
- Restart ledger: 33 rows; migration 035 count one; migration 035 checksum
  `47b2b9e729e7ad89ce1dd55c2d88dfc25a52d0e720f171476a9552654b671cdb`.
- The mounted Part 4 test also creates a separate supported 001-034 database,
  applies 035 once, preserves the accepted assignment byte-for-byte, and
  proves restart reapplication changes no ledger filename/checksum/timestamp.

No UI/public file changed. Browser evidence is N/A, not passing; visual
approval remains separate. Part 3 mounted compatibility retains zero provider
calls and recommendations remain non-capabilities.

## Preserved intermediate failures

- The first focused invocation omitted the disposable-server identity variables
  required by the mounted harness. All 11 then-existing tests failed immediately
  with `M19 disposable PostgreSQL identity environment is incomplete`; no test
  database or product assertion ran. The exact data directory, port, and run ID
  were supplied, after which the current 14/14 suite passed.
- The first four-part compatibility run reported 56/57 because Part 2's
  historical broad routine-name inventory selected the initial new helper name
  containing `conflict` and expected the Part 2 two-entry search path. The
  helper was narrowly renamed `canonical_schedule_part4_hard_authority`, its
  runtime EXECUTE grant was explicitly revoked and added to privilege
  verification, and the rerun passed 57/57. No gate was weakened.

## Unavailable exclusion

The full available corpus excludes only
`tests/integration/account-migration-010-postgres.test.js`. Its 24 cases require
four `ACCOUNT_MIGRATION_*` disposable URLs that are absent. They are unavailable,
not passing. The exclusion and exact available count are stated separately.
