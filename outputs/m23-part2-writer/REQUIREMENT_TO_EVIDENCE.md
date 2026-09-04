# Mission 23 Part 2 — Requirement-to-evidence ledger

## Frozen writer boundary

- Released base: `935a27e94f5df2869308a1b1ac691d212f35ae94`
- Branch: `mission23/part2-field-execution`
- Exact candidate migration-freeze commit:
  `71cd80bd17bd28870ce71316543036fe0934d8f2`
- Scope: Part 2 canonical field-execution identity/current state/immutable
  evidence/server authority only.
- Excluded: Parts 3–12, all UI, provider/configuration/production mutations, and
  every downstream authority retained by Missions 20–32.

## Requirement mapping

| Requirement | Durable evidence | Writer result |
| --- | --- | --- |
| Exact isolated base and no overlapping Part 2 writer/PR | Fresh non-shallow WSL/ext4 worktree `/home/joshv/codex-writers/mission23-part2-field-execution`; exact creation base `935a27e94f5df2869308a1b1ac691d212f35ae94`; preflight found no Part 2 branch, PR, writer, or auditor. | Pass |
| Canonical executor/handoff and controlling contract readability | Canonical executor task `019fcfdb-02f5-76d2-8b24-e6af82135a12` was directly readable. `NORTHSTAR_MONITOR_HANDOFF.md` plus complete Mission 23, M23 Part 1 ledgers, Mission 21, Mission 22, and relevant M20–M22 schema/runtime/route/auth contracts were read before editing. | Pass |
| Additive canonical execution identity and exact upstream pins | Migration 038 creates one tenant-scoped current execution per appointment/assignment and retains exact appointment, operation, graph, opportunity, and Mission 22 assignment identity/revision/digest. Tenant-composite foreign keys use `ON DELETE RESTRICT`. | Pass in disposable PostgreSQL; independent audit pending |
| Bounded Part 2 lifecycle only | Database and JavaScript contracts allow only `initialize`, `start`, `pause`, and `resume`, with only `not_started`, `in_progress`, and `paused` states. Unit/DB tests reject a later-part `complete` action. | Pass |
| Immutable, gap-free, atomic evidence | Current state, event, revision, audit, and idempotency response share transaction/effect identity; deferred completeness guard rejects partial writes; immutable triggers reject update/delete/truncate. Forced audit failure test leaves all five authorities unchanged. | Pass |
| Server-derived authorization and individual attribution | Route accepts no tenant/role/actor/performer authority fields. PostgreSQL reloads exact tenant user, membership, workforce profile, session, CSRF, subscription, onboarding, assignment, crew, appointment, and non-demo transcript evidence. Actor and performer are persisted separately and database-derived. | Pass |
| Scope matrix | Owner/admin tenant-wide; member direct/current-crew assignment only; dispatcher operational role grants nothing; viewer mutation denied; inactive/stale/forged/cross-tenant authority fails closed. Read entry point is tenant-private and member assignment-bounded. | Pass for covered adversarial cases |
| Revision/digest/idempotency/concurrency | DB-computed SHA-256 current/request digests, exact current/source pins, hashed bounded idempotency key, advisory replay lock, serializable writes, repeatable-read read-only reads, bounded retries. Exact replay returns the stored response only after current authority revalidation; a benign assignment revision preserves replay while reassignment, crew removal, dispatch/assignment loss, appointment ineligibility, demo-source invalidation, subscription/session/account/membership/permission loss fail closed. Rejected replays leave current state, every immutable evidence count, and both stored responses byte-for-byte unchanged. Mismatched key reuse rejects; concurrent different keys yield one winner; same key yields one effect. | Pass in disposable PostgreSQL; independent re-audit pending |
| Minimum mounted HTTP contract | Raw boundary precedes the general parser. Two POST routes and one GET route are mounted before legacy retirement. Authenticated routes use the existing internal-API availability rate limiter keyed by server-derived tenant/account; database timeouts and locks bound concurrent work. Tests cover exact JSON, duplicate keys, compression, 32 KiB, injected authority, stored replay response, and fail-closed missing boundary. | Pass |
| Runtime least privilege | `src/db.js` revokes direct privileges to five tables and all helper functions; runtime receives only the initialize/transition/read entry points. Runtime direct select/insert/helper execution fails with `42501`. | Pass |
| Legacy/demo isolation and predecessor preservation | Demo/simulation transcript sources cannot create/read Part 2 authority; `/api/v1/jobs`, workflows, and legacy assets remain retired; protected migrations 001–037 are unchanged and checksum regression is green. | Pass for source/DB boundary; no browser UI exists |
| Exact migration identity | `MIGRATION_IDENTITY.md`: blob `9601ae8219f29da02440282dd9a5a3b13076ed34`, 65,393 bytes, SHA-256 and runner checksum `84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`. | Pass |
| Fresh automatic application | Production-path `initDatabase()` against separated migration/runtime roles on disposable PostgreSQL 18.4 applies 001–038, records one exact 038 checksum row, and verifies runtime grants. | Pass in disposable PostgreSQL only |
| Interrupted upgrade transaction, retry, exact-once ledger, and zero-op | A database first receives 001–037, an explicit 038 transaction is forced to fail and rolls back with no table/ledger row, then the normal runner applies 038 once. A second runner invocation leaves the same one row and timestamp. The primary suite closes/resets/reinitializes the application database path, then rechecks the unchanged row/timestamp. | Pass in disposable PostgreSQL only |
| PostgreSQL/time compatibility | Disposable PostgreSQL 18.4 reports UTF8, `TimeZone=UTC`, `lc_collate=C`, and data checksums on. The dated production receipt reports PostgreSQL 18.6, `Etc/UTC`, UTF8, and `en_US.utf8` collation/ctype with exact history compatibility. | Pass for pre-application compatibility; post-application evidence pending |
| Authoritative production pre-application reconciliation | `PRODUCTION_MIGRATION_READINESS_RECEIPT.md` records the dated Railway CLI v5.30.3 read-only receipt: PostgreSQL 18.6, Etc/UTC, UTF8, en_US.utf8, 35 exact ledger rows through 037, zero checksum/source mismatches, and exactly frozen 038 pending. No private row was accessed and no mutation occurred. | Pass for pre-application readiness only; application still pending |
| Recovery truth | No dated backup receipt or isolated restore rehearsal exists. The same receipt records the founder-authorized conservative disposition: keep/restore healthy app `935a27e9` with 038 source retained, leave additive schema inert, correct schema only by a new reviewed forward-fix, no destructive rollback, root coordinator responsible, and block Part 3 pending health/exact receipt. | Authorized alternative disposition recorded; backup/restore remains unavailable |
| No premature release claim | Root status says Part 2 is a writer candidate only; unavailable ledger blocks production claims; this PR remains draft for a different fresh auditor. | Pass |

## Exact local writer test results

### Focused Part 2 contract and HTTP boundary

`tests/unit/m23-part2-field-execution.test.js`

- Test suites: 1 passed / 1 total
- Tests: 15 passed / 15 total
- Snapshots: 0
- Failures: 0

### Disposable PostgreSQL 18.4 adversarial and migration suite

`tests/integration/m23-part2-field-execution-postgres.test.js`

- Test suites: 1 passed / 1 total
- Tests: 12 passed / 12 total
- Snapshots: 0
- Failures: 0
- Server: PostgreSQL 18.4, `127.0.0.1:55483`, UTF8, UTC, locale C,
  data checksums on
- Disposable data directory:
  `C:/Users/joshv/Documents/Codex/2026-09-04/m23-p2-pg18-data`

### Related M21/M22/protected-migration regression

- `tests/unit/m23-part2-field-execution.test.js`
- `tests/unit/m21-part1-knowledge-contract.test.js`
- `tests/unit/m22-part1-scheduling-contract.test.js`
- `tests/unit/m22-part1-scheduling-time-contract.test.js`
- `tests/unit/protected-migration-checksum.test.js`

Result:

- Test suites: 5 passed / 5 total
- Tests: 91 passed / 91 total
- Snapshots: 0
- Failures: 0

### Mission-wide ratification regression

`tests/ratification`

- Test suites: 17 passed / 17 total
- Tests: 314 passed / 314 total
- Snapshots: 0
- Failures: 0

### Broad unit regression

`tests/unit`

- Test suites: 89 passed / 89 total
- Tests: 5,282 passed / 5,282 total
- Snapshots: 0
- Failures: 0

### PostgreSQL predecessor cross-contract regression

- `tests/integration/m23-part2-field-execution-postgres.test.js`
- `tests/integration/m22-part1-schedule-assignment-postgres.test.js`
- `tests/integration/m22-part4-human-approval-postgres.test.js`

Result:

- Test suites: 3 passed / 3 total
- Tests: 43 passed / 43 total
- Snapshots: 0
- Failures: 0

### PostgreSQL account, security, and role-authority regression

- `tests/api/account-authority-gates-postgres.test.js`
- `tests/api/m20-phase7-lane1-security-postgres.test.js`
- `tests/api/m20-phase7-lane3-role-authority-postgres.test.js`

Result:

- Test suites: 3 passed / 3 total
- Tests: 20 passed / 20 total
- Snapshots: 0
- Failures: 0

All counts are writer evidence, not an independent audit or release verdict.
