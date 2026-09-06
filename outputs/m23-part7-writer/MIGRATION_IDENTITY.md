# Part 7 frozen migration identity

Candidate only; no production application or independent approval is claimed.

| Identity | Exact value |
| --- | --- |
| Path | `migrations/048_canonical_progress_issue_change_facts.sql` |
| Git blob | `755e689eaf84fe580de47669f20f0141c89f34dc` |
| Byte count | `55120` |
| SHA-256 of raw Git blob bytes | `92dfa4c54777e0e0bde4633edbddfd046f7b3d07b27a9dbb1cc2cd0ed6ff0b84` |
| Line endings | LF only; no CR bytes |
| Released base | `6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9` |
| Existing migration set | All 45 released SQL blobs unchanged |
| Candidate set | 46 SQL migrations; exactly one new 048 |

The automatic production runner is unchanged except registering/withholding the
new progress authority through its existing role-grant flow. The generic
read-only production-history inspector already discovers the source set; its
source-seal unit test now asserts 46 sources and exact 048 bytes/checksum while
retaining the released 047 seal. No production inspection was performed.

Disposable PostgreSQL 18.4 on `127.0.0.1:55483`, UTF-8, UTC, checksums enabled,
uses separately created non-superuser owner/runtime roles. The focused mounted
suite installs fresh with the real runner. The upgrade suite first applies the
exact released 45-file set, interrupts after 048 DDL before ledger commit,
verifies no progress schema or 048 ledger row remains, then applies exactly once
and reruns with no migration work. Existing rows retain exact checksums and
application times. The production initialization path is also mounted and
returns healthy initialization with no duplicate migration application.

Recovery disposition: **separately reviewed forward fix only**. There is no
down-migration. Backup/PITR/restore evidence is unavailable. An old application
rollback has not been demonstrated safe because its generic role-grant logic
does not know the new withheld tables. Local transaction-interruption rollback
is not a production backup or application-rollback demonstration. Production
compatibility inspection, application evidence, risk acceptance, and release
authority remain separate later gates.
