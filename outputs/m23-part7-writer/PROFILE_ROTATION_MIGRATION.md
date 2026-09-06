# Part 7 profile-rotation correction — migration candidate identity

Writer correction candidate only. Independent acceptance and release remain
pending. No migration was applied outside disposable loopback PostgreSQL.

| Identity | Exact value |
| --- | --- |
| Path | `migrations/048_canonical_progress_issue_change_facts.sql` |
| Git blob | `55b527c2dc8a31514e3398489ed1bcc0811e1b47` |
| Byte count | `55557` |
| SHA-256 | `c87210731112f7da7df2f955eadbe7fa6e66c16d80c732441c2ee1688dbc189a` |
| Line endings | LF only; no CR bytes |
| Released base | `6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9` |
| Released migrations | 45 exact blobs, through 047, unchanged |
| Candidate migration set | 46 sources, one new unreleased 048 |

048 was not released. This ordinary additive correction commit changes that
unreleased candidate's definition; it does not alter any released migration or
rewrite Git history. The rejected candidate's old blob/bytes/checksum remain in
[MIGRATION_IDENTITY.md](MIGRATION_IDENTITY.md) and its immutable Git commit.
This is not a supported in-place update to a database already carrying the
rejected 048 checksum. The production runner must reject such a checksum
mismatch; do not change its ledger, bypass reconciliation, or down-migrate.

Only the internal observation helper's active-profile check is conditional:
new/full documents still require active authority; exact-predecessor reviews
and issue transitions validate retained historical provenance. No request can
select this mode or replace the inherited profile pin. Existing actor/work
authorization, replay ordering, source pins, immutable history, and evidence
checks are unchanged.

The generic production-history inspector discovers the same 46 sources without
source modification. Its exact source-seal test and Part 7 ratification seal
are updated to the corrected candidate identity; the released 047 seal remains.
Fresh/upgrade/interruption/apply-once/rerun validation results will be recorded
in the separate non-overwriting correction verification receipt.

Recovery disposition remains **separately reviewed forward fix only**.
Production backup/PITR/restore evidence remains unavailable, not passing.
Local transaction rollback is not proof of production restore or application
rollback safety. No destructive down-migration is provided or authorized.
