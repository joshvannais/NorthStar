# Frozen additive migration 047

- Path: `migrations/047_canonical_field_evidence_authority.sql`
- Git blob: `f8a94d64d20bc3076819b6f719ca02a1f2508318`
- Bytes: `74729`
- SHA-256: `b9c08d267cbf373202e621b381f5821bb96c54fde3046be25fe08005d8f16048`
- Exact released base: `dfc769520ea56fdb7fde44dda6fe0bd65202fcdb`
- Released migration files 001–046: 44 files, byte-for-byte preserved.

The checksum is over the exact Git-blob bytes. The disposable PostgreSQL 18.4
lifecycle test interrupts the real migration runner after 047 DDL but before its
ledger commit, proves complete rollback, retries exactly once, and proves rerun
and restart are zero-op.

This corrected freeze supersedes the pre-release candidate identity reviewed at
PR head `78906517ffae3de3f0dc4678640675988baab259`; migration 047 has never been
released or applied to production. It does not claim application to production,
production-history compatibility, backup/restore recoverability, hosted CI,
independent approval, merge, deployment, or release. A different fresh auditor
must review this exact corrected identity before release.
