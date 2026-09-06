# Migration 049 identity and recovery disposition

Writer candidate only. This identity must be independently recomputed from the
exact Git blob before audit acceptance, merge, or deployment.

- Path: `migrations/049_canonical_completion_reopening_authority.sql`
- Git blob object ID: `038cfbc974399ec05ea2bf8ae31b5b53287adad0`
- Byte count: `79646`
- SHA-256: `387188bf8aeaddef56f23eb7542a7a7c0efb05c55b9074cad045b0a0eecd2fdf`
- Line ending/content classification: ASCII text with LF bytes in the isolated
  checkout.
- Protected base: `fce4000f22c08f5f74712d37439286a4c601b1a7`
- Protected migration inventory: all 46 SQL migrations 001–048 are byte-equal
  to that base.

The migration is forward-only and additive: it widens the existing canonical
field-execution state/action constraints, replaces only the current-state guard
to enumerate those new transitions, creates completion history/evidence tables,
indexes, helpers and two runtime entry points, installs immutable/deferred
invariants, and revokes PUBLIC access. It does not transform or delete existing
rows and contains no down-migration.

On disposable PostgreSQL 18.4, a deterministic interruption after migration 049
DDL but before ledger commit rolled the schema and ledger back together. The
same bytes then applied once, reconciled with one checksum row, and a later
ordinary invocation was a zero-op with the row and timestamp unchanged. This is
local migration behavior, not production application evidence.

Backup/PITR/restore evidence is unavailable. Recovery disposition is therefore
a separately reviewed forward fix only. No destructive down-migration is
authorized. An old application rollback is not represented as safe across the
new lifecycle values; compatibility and release consequence would require a
separate authorized proof before use.
