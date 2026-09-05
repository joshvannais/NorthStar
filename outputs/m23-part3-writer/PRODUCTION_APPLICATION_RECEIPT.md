# Mission 23 Part 3 — Production application receipt

## Exact accepted and released identity

- The exact independently accepted Part 3 candidate head is
  `8de66512d1baa335e4e7151b6a7232c94de9dc0a` with tree
  `2abaf5251a16e52afac0bf1a4f2b1da7783ea460`.
- PR #163 merged normally at `2026-09-04T14:29:12Z` as
  `ee6cac8b729f73a5af22c7d5747fd52c1d1d4035`.
- The merge commit has the same exact tree
  `2abaf5251a16e52afac0bf1a4f2b1da7783ea460` as the accepted candidate.
- Automatic Railway deployment
  `e1d88caa-339e-49b6-a08a-60cd20eddcf9` reached `SUCCESS` for the exact merge
  commit. Its image digest is
  `sha256:35bc3cf838052c911a93ca01bd2892a3f6db054da67b7742fc462aac4970082a`.
- Remote `main` resolved to the exact merge commit when the documentation-only
  receipt branch was created.

No manual redeploy, restart, DDL, provider action, or hidden migration step is
represented by this receipt.

## Sole automatic runner and first application

The supplied complete startup-log evidence from the ordinary automatic Railway
deployment contained exactly one application entry for each Part 3 migration:

```text
[DB] Migration applied: 039_canonical_labor_time_evidence.sql
[DB] Migration applied: 040_canonical_labor_time_audit_corrections.sql
[DB] Migration applied: 041_canonical_labor_transcript_source_authority.sql
```

No second application entry for migrations 039, 040, or 041 appeared in that
startup. The observation did not supply individual log-entry timestamps, so
none are invented here. This is first-start automatic-runner evidence, not the
separate later-application-start zero-op evidence still required below.

## Read-only production ledger verification

The supplied read-only production inspection reported:

- PostgreSQL `18.6`;
- `TimeZone = Etc/UTC`;
- server encoding `UTF8`;
- collation and ctype `en_US.utf8`;
- `migrationCount = 39`;
- exactly one row named `039_canonical_labor_time_evidence.sql`, checksum
  `2204695c9be757a66094897f6bb9e86bee9c84f1582a3bc27812d7bbdebdf13a`;
- exactly one row named `040_canonical_labor_time_audit_corrections.sql`,
  checksum
  `229b022a8fa70ac2daae05f2ffaf48016ecd77a50df29350cc9cd72221b6258b`;
- exactly one row named `041_canonical_labor_transcript_source_authority.sql`,
  checksum
  `55dcb1bd4a5ddd65645915127b7964081498e1e3321fe215aaafe5707ae9cc5c`;
  and
- the same `applied_at = 2026-09-04T14:30:01.345Z` for all three rows.

Each production checksum exactly matches the separately frozen Git-blob and
application-runner identity in `MIGRATION_IDENTITY.md`,
`MIGRATION_040_IDENTITY.md`, and `MIGRATION_041_IDENTITY.md`. The read-only
inspection accessed no private/customer row, displayed no credential, and made
no production mutation or provider action.

## Credential-free health observation

Three credential-free `GET https://northstar-os.ai/api/health` requests each
returned HTTP `200`. Each response reported `status = ok`, PostgreSQL
persistence, and both `database` and `canonicalPersistence` as `healthy`.
Observation timestamps were not supplied, so none are invented.

Together, the exact deployment, ordinary startup, read-only ledger, and three
health observations establish first production application of migrations
039–041, exact one-row identities, and healthy canonical persistence for the
observed automatic deployment. They do not exercise private labor rows or prove
any later-part product behavior.

## Required later-start zero-op follow-up

This section described the follow-up still required when this first-application
receipt was written. That follow-up subsequently passed through PR #164 and is
recorded without rewriting the original first-start evidence in
`LATER_START_ZERO_OP_RECEIPT.md`. Part 3's later-start gate is now achieved.

The first deployed application start cannot also prove a later application
start. This documentation/evidence/ratification receipt PR adds no migration or
runtime code. If it passes fresh independent audit, merges normally, and is
automatically deployed, that later ordinary application start must establish:

1. the complete startup log contains no `[DB] Migration applied` entry;
2. the authoritative ledger still has `migrationCount = 39` and exactly one row
   for each of migrations 039, 040, and 041;
3. every checksum remains exactly as recorded above;
4. every `applied_at` remains exactly `2026-09-04T14:30:01.345Z`; and
5. credential-free health remains HTTP 200 with PostgreSQL, `database`, and
   `canonicalPersistence` healthy.

No manual restart or redeploy may manufacture that evidence. Until the later
automatic start and read-only ledger check are recorded, Part 3's later-start
zero-op gate is pending and Part 4 must not begin.

## Historical pre-application and recovery boundaries

`PRODUCTION_MIGRATION_READINESS_RECEIPT.md` records exact read-only
pre-application compatibility for 039 alone and then 039+040. It predates 041.
No terminal pre-application 039+040+041 production-history receipt was supplied,
and this post-application ledger cannot retroactively prove that pre-release
inspection occurred.

No dated production backup receipt or isolated restore rehearsal is available.
The founder-authorized conservative disposition remains in force: preserve the
exact migration sources, permit only a separately reviewed forward fix, perform
no destructive database rollback or data deletion, and stop progression on any
revision, migration, startup, ledger, or health discrepancy. Missing historical
pre-application and recovery evidence remains unavailable; neither is converted
into a pass by this receipt.
