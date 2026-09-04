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
for that deployment.

## Later-start zero-op follow-up

PR #162, the independently accepted documentation-only receipt follow-up,
merged normally at `2026-09-04T09:47:56Z` as
`e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`. GitHub deployment `6261881255`
and Railway deployment `8ea1badb-3a7f-49bd-a0f8-0fa0a94865df` reached the
exact commit in `success` and `SUCCESS` / `RUNNING` state respectively. This was
the ordinary sole automatic deployment; no manual restart or redeploy was used.

The complete startup log for the later container start at
`2026-09-04T09:48:41.774970382Z` contained no `[DB] Migration applied` entry.
Read-only ledger and health verification at `2026-09-04T09:49:39.687Z` still
reported 36 authoritative migration rows, exactly one migration 038 row, the
unchanged checksum
`84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`, and its
original `applied_at = 2026-09-04 06:42:56.965851+00`. Health remained `ok`,
with database and canonical persistence healthy.

That later normal start therefore proves migration 038 restart zero-op at the
frozen source identity: no second application, no additional ledger row, and no
changed application timestamp. The follow-up did not inspect private rows or
credentials and made no provider, configuration, or production-data mutation.

## Remaining release boundary

No dated production backup receipt or isolated restore rehearsal is available.
The previously authorized conservative disposition remains in force: preserve
the exact migration source, permit only a separately reviewed forward fix,
perform no destructive database rollback, and stop progression on a migration,
startup, revision, or health discrepancy. Missing recovery evidence remains
unavailable; it is not converted into a pass by this receipt.
