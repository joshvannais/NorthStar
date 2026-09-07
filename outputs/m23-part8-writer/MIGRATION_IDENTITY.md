# Mission 23 Part 8 migration identities and recovery

Writer-only evidence for the second correction. Recompute all identities at
the new immutable head during independent audit. The enclosing commit cannot
self-reference: its exact head/tree are reported in the postcommit handoff.

- Base: `fce4000f22c08f5f74712d37439286a4c601b1a7` (46 SQL migrations).
- Audited correction parent: `13f9348312a354835b7a56eddc133d00492b7b53`.
- All 48 SQL migration files at that parent, through 050, remain byte-identical.
- Current source inventory: 49 SQL migration files; only 051 is new this stage.

| Migration | Bytes | SHA-256 | Git blob |
| --- | ---: | --- | --- |
| 049_canonical_completion_reopening_authority.sql | 79646 | 387188bf8aeaddef56f23eb7542a7a7c0efb05c55b9074cad045b0a0eecd2fdf | 038cfbc974399ec05ea2bf8ae31b5b53287adad0 |
| 050_canonical_completion_source_read_authority.sql | 4226 | 34c3765845fde3d57cb95a09f4bdd6e71f5e3e27ba09f1822438db8ac9dcb22e | 8775249791e51758998dc94b002970788d30d8a7 |
| 051_canonical_completion_type_and_provenance_authority.sql | 2961 | 2efc03578054a94ee0db22f2b603dd0d38df9584950e8cc94c5db315995c3f57 | 88cc4e6b5674259951a6fcc6232a52e7f2653682 |

These are raw LF Git bytes. Migration 050 replaces the completion read source
gate. Migration 051 renames the original mutation implementation to a private
helper, adds a same-signature JSON-type wrapper, and revokes PUBLIC transcript
write privileges. Startup grants then reconcile runtime table/column authority
on every invocation. No existing data or released migration is rewritten.

Separate lifecycle tests retain exact 049 and 050 upgrade/interruption checks.
The 050-only fixture deliberately reports 051 pending rather than pretending
to be final schema. The 051 lifecycle verifies 050-to-051 upgrade, deterministic
DDL interruption with schema/ledger rollback, retry once, exact checksum,
zero-operation restart, private helper ACLs and stale-column grant removal.
The Part 7 tail lifecycle verifies all four tail migrations 048–051.

Production ledger/application, backup/PITR/restore, deployed revision and old
application rollback compatibility remain unavailable. Recovery is a separately
reviewed forward fix only; no destructive down-migration is authorized.
