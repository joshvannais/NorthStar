# Mission 23 Part 4 — Migration identity

This identity is frozen from the committed Git object, not mutable working-tree
bytes.

- Migration: `migrations/042_canonical_material_inventory_evidence.sql`
- Source commit that freezes the exact candidate migration bytes:
  `5e91449f3655dcfe9eec7cd0086a5a9c440c0f64`
- Source tree: `23f626170471804c551e51d4bd6c1822f91fbea8`
- Git blob object ID: `8adb615f30626fe940ab7e444727184fed5bfe9b`
- Blob byte count: `70623` bytes
- SHA-256 over `git cat-file blob
  5e91449f3655dcfe9eec7cd0086a5a9c440c0f64:migrations/042_canonical_material_inventory_evidence.sql`:
  `5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4`
- Application migration-runner checksum:
  `5efac96a5c275f58e56b117cdae135d4f16ce4847cccdbab8de580b5a3c1d6c4`

The Git-blob SHA-256 and checksum loaded by `src/db.js` are identical. Migration
042 must remain byte-for-byte unchanged after this freeze. A later evidence-only
commit may record production-history preflight or exact-head test results but
must retain this exact blob.

This identity alone proves no production fact. Production compatibility,
application, deployment, health, later-start zero-op, and recovery are separate
evidence gates.
