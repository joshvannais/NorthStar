# Mission 23 Part 8 migration identity — third correction

Writer evidence only. Current base/main/merge-base:
`a5bc90ddede95d0a88e6f857f8c75c9637dd8245`.
Audited parent: `c96e710d60a14ba4d39ed78c854ac91e5318303e`.
All 49 SQL files through 051 are byte-identical to that parent.
Only next migration 052 is added; final inventory is 50 SQL files.
The final enclosing head/tree are sealed in postcommit readback, not recursively here.

| Migration | Bytes | SHA-256 | Git blob |
| --- | ---: | --- | --- |
| 049_canonical_completion_reopening_authority.sql | 79646 | 387188bf8aeaddef56f23eb7542a7a7c0efb05c55b9074cad045b0a0eecd2fdf | 038cfbc974399ec05ea2bf8ae31b5b53287adad0 |
| 050_canonical_completion_source_read_authority.sql | 4226 | 34c3765845fde3d57cb95a09f4bdd6e71f5e3e27ba09f1822438db8ac9dcb22e | 8775249791e51758998dc94b002970788d30d8a7 |
| 051_canonical_completion_type_and_provenance_authority.sql | 2961 | 2efc03578054a94ee0db22f2b603dd0d38df9584950e8cc94c5db315995c3f57 | 88cc4e6b5674259951a6fcc6232a52e7f2653682 |
| 052_canonical_transcript_insert_only_authority.sql | 1088 | 2071b58c97a8c4fa9e2e0c7255b67f0340c4062f7477b498ef31b16aafcefb8b | 335a51b1b278f9719e30f4dae755022bf68d46bd |

Migration 052 performs ACL changes only, not data/schema-row rewrites. It
revokes PUBLIC/runtime UPDATE at table and every column level and DELETE,
using the migration runner's already validated runtime identity. That identity
is transaction-local and set before migration execution. The ordinary startup
reconciler then reapplies and verifies zero effective UPDATE columns after
broad grants, even when no migration is pending. SELECT/INSERT remain.

The 052 test injects only stale synthetic ACLs, checks their revocation during
the migration BEFORE the later grant reconciler, interrupts and proves both
ACL/ledger rollback, retries once, verifies exact checksum, then repeats stale
PUBLIC/runtime grants and proves zero-op restart removes them without ledger
timestamp changes. No transcript content is changed for this proof.

Earlier 049/050/051 lifecycle tests remain; the 050-only and 051-only fixtures
truthfully list later pending migrations. Part 7 verifies the full 048–052 tail.
No destructive down-migration, production application, backup/PITR/restore or
old-application rollback compatibility is claimed. Recovery requires a separately
reviewed forward fix.
