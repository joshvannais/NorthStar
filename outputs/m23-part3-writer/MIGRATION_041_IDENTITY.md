# Mission 23 Part 3 — Migration 041 identity

This identity was frozen from the committed Git object, not from mutable working-
tree bytes.

- Migration: `migrations/041_canonical_labor_transcript_source_authority.sql`
- Source commit that freezes the exact candidate migration bytes:
  `04e1891195d5ebbbb760210cc080de753163aa19`
- Git tree object ID:
  `5335b1a9717edd72222e2e5a9b1fdebcb786a6eb`
- Git blob object ID: `567419243b53c1770eeafb49de187335e981444b`
- Blob byte count: `29603` bytes
- SHA-256 over `git cat-file blob
  04e1891195d5ebbbb760210cc080de753163aa19:migrations/041_canonical_labor_transcript_source_authority.sql`:
  `55dcb1bd4a5ddd65645915127b7964081498e1e3321fe215aaafe5707ae9cc5c`
- Application migration-runner checksum:
  `55dcb1bd4a5ddd65645915127b7964081498e1e3321fe215aaafe5707ae9cc5c`

The blob SHA-256 and checksum loaded by `src/db.js` are identical. Migrations
039 and 040 remain frozen separately and unchanged. No later candidate commit
may modify migrations 039, 040, or 041.

This local identity alone proves no production fact. The historical bounded
read-only production-history preflight proved exact 039+040 compatibility but
predates 041; no terminal pre-application 039+040+041 receipt was supplied. The
later `PRODUCTION_APPLICATION_RECEIPT.md` records independent acceptance, normal
merge, automatic first application, exact one-row production identity, and
health for all three migrations. That post-application receipt does not
retroactively prove the missing pre-application inspection. A later ordinary
application-start zero-op with the row checksum and timestamp unchanged remains
pending. No private production row or credential was required for these
identity checks.
