# Mission 23 Part 2 — Migration identity

This identity was frozen from the committed Git object, not from mutable working-
tree bytes.

- Migration: `migrations/038_canonical_field_execution_authority.sql`
- Source commit that freezes the exact candidate migration bytes:
  `71cd80bd17bd28870ce71316543036fe0934d8f2`
- Git blob object ID:
  `9601ae8219f29da02440282dd9a5a3b13076ed34`
- Blob byte count: `65393` bytes
- SHA-256 over `git cat-file blob
  71cd80bd17bd28870ce71316543036fe0934d8f2:migrations/038_canonical_field_execution_authority.sql`:
  `84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`
- Application migration-runner checksum:
  `84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`

The blob SHA-256 and the checksum loaded by `src/db.js` are identical. No later
commit in this candidate may modify this migration. The exact terminal writer
head and PR head remain separate immutable release identities and are reported
at the writer gate.

This local identity alone does not prove any production fact. The separate
dated production-readiness receipt proves exact pre-application history and
compatibility through migration 037. The later
`PRODUCTION_APPLICATION_RECEIPT.md` records the normal merge, sole automatic
deployment, first-start application, exact one-row production checksum, and
healthy application at the same frozen identity. A later production start
remains required to prove restart zero-op; that gate is not inferred from the
first successful start.
