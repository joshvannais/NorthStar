# Mission 23 Part 2 — Production application receipt

## Exact release identity

- PR #161 merged normally at `2026-09-04T06:42:11Z`.
- The resulting `main` revision is
  `403576639ea0223a2a18340d87882a6cdfa47ca4`.
- GitHub deployment `6259306993` reached `success` at
  `2026-09-04T06:43:03Z`.
- Railway NorthStar deployment
  `7392c2b3-0f49-4b3f-9e15-c3ed40fa5270` was created at
  `2026-09-04T06:42:12.865Z` and reached `SUCCESS` / `RUNNING` at the exact
  merge revision.
- Remote `main` resolved to the exact merge revision during verification.

No manual redeploy, restart, DDL, provider configuration, or hidden migration
step is represented by this receipt.

## Sole automatic runner and first application

The Railway application startup log began at
`2026-09-04T06:42:55.500946964Z`. The ordinary application startup path reported

```text
[DB] Migration applied: 038_canonical_field_execution_authority.sql
```

at `2026-09-04T06:42:59.204382383Z`. This is evidence that the sole automatic
application runner discovered and applied the frozen migration during the first
production start at the exact merge revision.

## Read-only production ledger verification

Verification completed at `2026-09-04T06:44:38.598Z` using read-only production
inspection. Production reported:

- PostgreSQL `18.6`;
- UTC time configuration;
- server encoding `UTF8`;
- 36 total authoritative `_migrations` rows;
- exactly one row named `038_canonical_field_execution_authority.sql`;
- checksum
  `84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`;
  and
- `applied_at = 2026-09-04 06:42:56.965851+00`.

The row checksum exactly matches the frozen Git blob and application migration-
runner checksum documented in `MIGRATION_IDENTITY.md`. No customer/private row
was accessed. The verification made no production mutation and did not read or
record credentials.

## Health and availability observation

- Production `/api/health` returned `ok` with PostgreSQL and canonical
  persistence healthy.
- Production `/` returned HTTP 200.
- The running Railway deployment and remote `main` both matched
  `403576639ea0223a2a18340d87882a6cdfa47ca4`.

These observations establish first production application, its exact one-row
ledger identity, the automatic runner path, exact deployed revision, and health
for that deployment. They do not establish a later-start zero-op.

## Remaining release boundary

A second application start after migration 038 was already present has not yet
been observed. Therefore this receipt does **not** claim second-start zero-op,
zero pending migrations on a later start, or unchanged 038 ledger identity after
that later start. The later normal automatic deployment of this documentation-
only receipt follow-up, after independent approval, is the planned opportunity
to collect that evidence without a manual provider restart. Part 3 remains
blocked until the root release coordinator verifies and records that result.

No dated production backup receipt or isolated restore rehearsal is available.
The previously authorized conservative disposition remains in force: preserve
the exact migration source, permit only a separately reviewed forward fix,
perform no destructive database rollback, and stop progression on a migration,
startup, revision, or health discrepancy. Missing recovery evidence remains
unavailable; it is not converted into a pass by this receipt.
