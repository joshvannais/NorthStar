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

This local identity proves no production fact. The completed bounded read-only
production-history preflight proved exact 039+040 compatibility but predates
041. A new bounded read-only preflight must verify the exact combined
039+040+041 pending candidate before release. Fresh independent exact-head
audit, normal merge/automatic application, exact ledger rows, health, and
later-start zero-op remain subsequent evidence. No private production row or
credential was required for this identity check.
