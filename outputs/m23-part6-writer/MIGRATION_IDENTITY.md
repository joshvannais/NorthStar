# Frozen additive migration 047

- Path: `migrations/047_canonical_field_evidence_authority.sql`
- Git blob: `b2a7a64dc6f5497b7eb7de7c5864a132b89b9d3e`
- Bytes: `59435`
- SHA-256: `8c01ba40fa1afe5bc0a5653c82607b42faf38f359866884d23c6731cc5932aa9`
- Exact released base: `dfc769520ea56fdb7fde44dda6fe0bd65202fcdb`
- Released migration files 001–046: 44 files, byte-for-byte preserved.

The checksum is over the exact Git-blob bytes. The disposable PostgreSQL 18.4
lifecycle test interrupts the real migration runner after 047 DDL but before its
ledger commit, proves complete rollback, retries exactly once, and proves rerun
and restart are zero-op.

This freezes candidate bytes only. It does not claim application to production,
production-history compatibility, backup/restore recoverability, hosted CI,
independent approval, merge, deployment, or release. Any correction after this
freeze must be additive; migration 047 must not be rewritten.
