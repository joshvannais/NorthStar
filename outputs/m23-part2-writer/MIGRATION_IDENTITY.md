# Mission 23 Part 2 — Migration identity

This identity was frozen from the committed Git object, not from mutable working-
tree bytes.

- Migration: `migrations/038_canonical_field_execution_authority.sql`
- Source commit that freezes the exact candidate migration bytes:
  `94cee07e5400ec815a7818707a3613ea505cc86f`
- Git blob object ID:
  `4e9697acd5290c4c01b89d8c0bacb20039784ba6`
- Blob byte count: `62286` bytes
- SHA-256 over `git cat-file blob
  94cee07e5400ec815a7818707a3613ea505cc86f:migrations/038_canonical_field_execution_authority.sql`:
  `9ccc85101d72d7535269ab2ceb8b28627b22801ee5992d226512941d9cb59657`
- Application migration-runner checksum:
  `9ccc85101d72d7535269ab2ceb8b28627b22801ee5992d226512941d9cb59657`

The blob SHA-256 and the checksum loaded by `src/db.js` are identical. No later
commit in this candidate may modify this migration. The exact terminal writer
head and PR head remain separate immutable release identities and are reported
at the writer gate.

This local identity alone does not prove any production fact. The separate
dated production-readiness receipt now proves exact pre-application history and
compatibility through migration 037 with this exact 038 pending. Production
application, its exact ledger row, restart zero-op, health, and acceptance remain
unavailable until the authorized release stage observes them.
