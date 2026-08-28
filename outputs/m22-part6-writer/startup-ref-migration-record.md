# Mission 22 Part 6 startup, reference, and migration record

- Authorized base: `8d5f18ed02b2edd201664a75c5cd726edcce1bd9`.
- Tested implementation: `dcd860524c9242a6c774e349e63091f92646b246`.
- Tested tree: `9163cc43eddd557eecb0afe8510a73a8c6553bff`.
- PostgreSQL: disposable loopback 18.4, UTC, isolated data directory and port
  `55436`; no production data/account/configuration.
- Fresh start: 33 migrations; restart: zero migrations.
- Migration 035 ledger count: one; exact source/ledger checksum
  `96fb6814a9a8a0db2ebdca2fc4626df8091bb7f3b48a3f4bef613e97fe977129`.
- Credential-free health: 200 on first start and 200 after restart; database and
  canonical persistence both healthy.
- Runtime restrictions: no database creation and no public-schema creation.
- All provider credential variables were omitted and no provider call ran.
- Protected migration hash inventory: `migration-hashes.sha256` (33 entries).
- Base-to-implementation migration path diff: zero; migration 036 absent.

The terminal handoff separately records post-push remote main, branch, pull ref,
generated merge ref, PR state/checks, evidence head/tree/parent, clean status,
full-history status, and disposable cleanup.
