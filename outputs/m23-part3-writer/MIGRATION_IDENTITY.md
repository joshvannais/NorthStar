# Mission 23 Part 3 — Migration identity

This identity was frozen from the committed Git object, not from mutable working-
tree bytes.

- Migration: `migrations/039_canonical_labor_time_evidence.sql`
- Source commit that freezes the exact candidate migration bytes:
  `716ecb5d52f021d644930ffacd0407037274b2ae`
- Git blob object ID: `db96ba632aecea501fd9c1bda3c3dfebf139cad0`
- Blob byte count: `56232` bytes
- SHA-256 over `git cat-file blob
  716ecb5d52f021d644930ffacd0407037274b2ae:migrations/039_canonical_labor_time_evidence.sql`:
  `2204695c9be757a66094897f6bb9e86bee9c84f1582a3bc27812d7bbdebdf13a`
- Application migration-runner checksum:
  `2204695c9be757a66094897f6bb9e86bee9c84f1582a3bc27812d7bbdebdf13a`

The blob SHA-256 and the checksum loaded by `src/db.js` are identical. No later
candidate commit may modify this migration. The terminal writer head and PR head
remain separate immutable release identities and are recorded at the writer
gate.

This local identity alone proves no production fact. The separate dated, read-
only `PRODUCTION_MIGRATION_READINESS_RECEIPT.md` records historical production
compatibility and the exact frozen 039 pending at that inspection. The later
`PRODUCTION_APPLICATION_RECEIPT.md` records independent acceptance, normal
merge, automatic first application, exact one-row production identity, and
health. A later ordinary application-start zero-op with the row checksum and
timestamp unchanged remains pending. No private production row or credential
was required for these identity checks.
