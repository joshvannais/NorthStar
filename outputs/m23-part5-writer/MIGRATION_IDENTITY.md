# Frozen additive migration 046

- Path: `migrations/046_reviewed_equipment_operations.sql`
- Git blob: `5b9d294954fb27857299be0b9ef15873ba07cc45`
- Bytes: `57208`
- SHA-256: `86284c861a014b462e3456e87ec7be703f299e19d23cc7b1650bcd87cb47513f`
- Base: `eccc8e901b20ae3cc65a68c9fb2b068a4ceb9375`
- Released migration files 001–045: 43 files, byte-for-byte preserved.

This identity freezes candidate migration bytes. It does not claim production
application, hosted CI, independent approval, merge or release. A correction
after this freeze must be additive; these migration bytes are not rewritten.

The disposable PostgreSQL lifecycle test intercepts the real migration runner
after 046 DDL and before its ledger commit, proves complete rollback, retries
the exact migration, and verifies later startup is a zero-op with unchanged
one-row checksum and timestamp. Separate runtime-role tests verify ordinary
runtime cannot import public research or access private evidence tables.
