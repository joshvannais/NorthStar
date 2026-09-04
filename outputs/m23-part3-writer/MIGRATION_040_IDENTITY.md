# Mission 23 Part 3 — Migration 040 identity

This identity was frozen from the committed Git object, not from mutable working-
tree bytes.

- Migration: `migrations/040_canonical_labor_time_audit_corrections.sql`
- Source commit that freezes the exact candidate migration bytes:
  `d66974d32f6c61849b0a432e02fc82093d4d0628`
- Git tree object ID:
  `0e30aca1e78962ee979bad8f767bae95c87b1ddf`
- Git blob object ID: `b8647606d58669fa806dc434a205d87f3fc11ecb`
- Blob byte count: `28443` bytes
- SHA-256 over `git cat-file blob
  d66974d32f6c61849b0a432e02fc82093d4d0628:migrations/040_canonical_labor_time_audit_corrections.sql`:
  `229b022a8fa70ac2daae05f2ffaf48016ecd77a50df29350cc9cd72221b6258b`
- Application migration-runner checksum:
  `229b022a8fa70ac2daae05f2ffaf48016ecd77a50df29350cc9cd72221b6258b`

The blob SHA-256 and checksum loaded by `src/db.js` are identical. Migration
039 remains frozen separately and unchanged. No later candidate commit may
modify either migration.

This local identity proves no production fact. A new bounded, read-only
production-history compatibility preflight must confirm the exact combined
pending 039/040 candidate before release. A fresh independent exact-head audit,
normal merge/automatic application, exact ledger rows, health, and later-start
zero-op remain subsequent evidence. No private production row or credential was
required for this identity check.
