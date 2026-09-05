# Frozen additive migration 047

- Path: `migrations/047_canonical_field_evidence_authority.sql`
- Git blob: `fe6f68075c6a3ce9e73206b0c51edbebdc58cd7f`
- Bytes: `94203`
- SHA-256: `f54418be9a5972e2a529e999399dc0bac44a61cbf4070af0a8246d61e2cd6bf8`
- Exact released base: `dfc769520ea56fdb7fde44dda6fe0bd65202fcdb`
- Released migration files 001–046: 44 files, byte-for-byte preserved.

The checksum is over the exact Git-blob bytes. The disposable PostgreSQL 18.4
lifecycle test interrupts the real migration runner after 047 DDL but before its
ledger commit, proves complete rollback, retries exactly once, and proves rerun
and restart are zero-op.

This corrected freeze supersedes the pre-release candidate identities reviewed at
PR heads `78906517ffae3de3f0dc4678640675988baab259` and
`050555b309dd0a801ca87b859282c8609e588a74`; migration 047 has never been
released or applied to production. It does not claim application to production,
production-history compatibility, backup/restore recoverability, hosted CI,
independent approval, merge, deployment, or release. A different fresh auditor
must review this exact corrected identity before release.
