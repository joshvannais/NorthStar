# Mission 25 Part 14C acceptance evidence

Candidate scope: migration, restart, replay, resume, correction, revocation, retention and deletion recovery proof.

The mounted recovery journey starts with a fresh PostgreSQL 17 database and the production application. It records one exact permission period, continuous import, connection and pause, then closes and reopens the application's real database pool against the same populated database. Migration 134 recognizes the equivalent PostgreSQL 17 and 18 migration-ledger catalog shapes without rebuilding the populated ledger. Migration 135 gives first cleanup execution and every exact replay one bounded public projection. Each later startup must be a migration zero-op: all 133 filename, checksum and applied-time records remain byte-for-byte equal. Exact current permission, import and connection retries replay after restart, and the paused connection resumes from its pinned revision.

The same journey imports a current correction, verifies only version 2 is current, explicitly revokes permission, and proves retired requests are blocked while details are hidden. A later permission period may expose the retained staged record under the accepted import authority, while the old permission, import, adapter and retention requests stay retired. A 30-day retention decision tombstones both eligible staged records. A separate 101-record deletion runs in a bounded 100-record page, restarts the real database pool with the checkpoint still incomplete, and proves the uncertain first-page retry returns the exact original public run with camel-case cursor and count fields. It resumes from the saved cursor, tombstones the final record, restarts again and proves the completed-page retry returns the exact original public run without adding history. Both responses expose only the documented run fields; raw database columns and internal tenant, actor, session, request and authority fields remain withheld.

The accepted all-source lifecycle suites remain the broader compatibility authority for labor, travel, vehicle and equipment, materials, CRM and field service, project and change-order, communications and external-financial source classes. Slice C adds one complete mounted restart journey rather than duplicating each accepted class implementation. No operational record is inferred or rewritten. Reviewed matches and downstream learning retain their existing separate renewal requirements.

No HTML, CSS or browser JavaScript changes are part of Slice C. API errors and recovery messages use existing reviewed plain business language, so no new rendered browser claim is made. No provider connection, credential, private-production, push, pull-request, merge or deployment action was performed. Physical restoration, backup recovery, production topology, RPO/RTO, provider recovery, physical-device review, manual assistive-technology review and founder visual approval remain unavailable rather than passing.

## Executable evidence

- Fresh PostgreSQL 17 mounted Slice C and ratification: 2 suites, 5 tests passed.
- Mounted Slice C plus accepted Part 13G and Part 14A-B compatibility: 8 suites, 23 tests passed.
- Protected migration checksums and Part 14A table inventory: 2 suites, 39 tests passed.
- Accepted external-labor operations compatibility: 8 lifecycle cases passed.
- Accepted imported-labor outcome compatibility: 8 reconciliation, observation and non-revival cases passed.
- `node --check src/db.js`, `git diff --check`, and the no-rendered-path diff check passed.

The dedicated PostgreSQL 18 account-migration suite requires its separate disposable PostgreSQL 18 identity and negative-control URLs, which were unavailable in this lane. PostgreSQL 18 execution therefore remains unavailable rather than passing; the fresh mounted authority and restart proof use PostgreSQL 17.
