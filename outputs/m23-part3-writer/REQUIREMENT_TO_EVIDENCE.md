# Mission 23 Part 3 — Requirement-to-evidence ledger

## Frozen scope boundary

- Exact deployed base:
  `e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`
- Branch: `mission23/part3-labor-time`
- Worktree: `/home/joshv/codex-writers/mission23-part3-labor-time`
- Exact candidate migration-freeze commit:
  `716ecb5d52f021d644930ffacd0407037274b2ae`
- Scope: additive canonical actual labor/time evidence tied to Part 2 field
  execution and current Mission 22 assignment authority.
- Excluded: materials, inventory, equipment/assets, files/media, notes,
  checklists, inspections, progress, blockers, changes, completion/reopening,
  UI, Polaris, providers, pricing, payroll, invoice/payment, and Parts 4–12.

Part 2's later-start gate passed before editing: PR #162 merged normally at
`2026-09-04T09:47:56Z` as
`e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`; GitHub deployment `6261881255`
and Railway deployment `8ea1badb-3a7f-49bd-a0f8-0fa0a94865df` ran the exact
commit. The complete later startup log at
`2026-09-04T09:48:41.774970382Z` contained no migration-application entry.
Read-only receipt `2026-09-04T09:49:39.687Z` retained 36 migration rows,
exactly one 038, checksum
`84a0b65ec8cd01ff97043b66a543e30540e9a0bbb68a48c4b49415db3b766724`, and
original `applied_at = 2026-09-04 06:42:56.965851+00`, with database/canonical
health healthy. No private row, credential, provider mutation, or production-
data mutation was involved.

## Requirement mapping

| Requirement | Durable evidence | Writer result |
| --- | --- | --- |
| Exact base and serialized writer | Clean, non-shallow WSL/ext4 worktree and new branch were created from exact deployed `origin/main` `e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`; preflight found no overlapping Part 3 writer, branch, or PR. | Pass at writer preflight |
| Individually attributable labor tied to exact field authority | Migration 039 uses tenant-composite restrictive links to Part 2 execution, Mission 22 assignment, workforce profile, actor, session, and Business Profile. Every interval pins source execution and assignment revision/digest. | Passed focused unit and disposable PostgreSQL |
| Explicit versioned categories | Contract permits only `break`, `cleanup`, `other`, `production`, `setup`, and `travel` under `m23-labor-category-v1` / SHA-256 `298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738`. Wrong identity fails as stale before replay. | Pass |
| Timer/manual interval rules | Server time owns timer start/stop; clients cannot provide timer instants. Manual/correction instants require exact offset-bearing RFC3339, ordered instants, tenant-zone offset agreement, no more than five minutes in the future, and a bounded 31-day maximum. Timers over 16 hours and owner-entered worker time become `needs_review`, but remain closeable. | Pass |
| UTC, tenant zone, and display evidence | Canonical rows retain UTC instants, exact raw offset strings, Business Profile ID/version/hash, IANA zone, and deterministic local display projection. DST gap is rejected; distinct fold instants remain distinct despite matching local display. | Pass in PostgreSQL 18.4 UTC fixture |
| Correction and review history | `correct` and `review` require exact interval revision/digest. Current rows advance one revision; immutable event, revision snapshot, audit, and replay evidence retain prior facts and actor/performer attribution. Open timers cannot be reviewed. | Pass |
| Immutable complete evidence and rollback | Deferred completeness requires matching current/event/revision/audit/idempotency evidence. History rejects update/delete/truncate. A forced audit-insert failure rolls back interval/event/revision/idempotency with zero partial effects. | Pass |
| Idempotency and concurrency | Keys are hashed; request identity is DB-computed; exact replay returns the stored response only after current reauthorization; changed-content key reuse conflicts. Serializable writes plus idempotency/worker locks make concurrent identical requests one effect and worker-wide overlap/open-timer races one winner. | Pass |
| Current actor, performer, assignment, crew, and dispatch authority | Server derives tenant/account/role/session/CSRF. PostgreSQL reloads active membership/account/workforce/session/subscription/onboarding and exact non-demo execution/assignment. Members act only as themselves on direct/current-crew work; owner/admin on-behalf entry remains attributed and needs review. Forged performer, cross-tenant access, revoked assignment/dispatch, and removed crew fail closed, including replay. | Pass for adversarial cases |
| Safe operational summaries | Read authority returns bounded interval projections and category totals/counts. It explicitly labels observations as operational evidence, not payroll, wage, billable, price, profitability, overtime/break, tax, or legal conclusions. | Pass |
| Strict HTTP boundary | Raw boundary owns only `POST /api/v1/field-executions/:executionId/labor-actions`; it rejects compressed, duplicate-key, malformed UTF-8/JSON, oversized, or pre-parsed bodies. Contract uses exact keys, NFC/control checks, fixed limits, required idempotency, revision/digest/source pins, and rejects injected/inapplicable authority fields. `GET /:executionId/labor` rejects query strings. | Passed focused unit |
| Safe response/oracle behavior and bounded resources | Existing tenant authentication, permission and server-derived rate limiting apply; route responses are `no-store`; unavailable errors are generic; PostgreSQL statement/lock/transaction timeouts and capped reads bound work. | Passed focused unit and PostgreSQL |
| Runtime least privilege | `src/db.js` revokes direct privileges on all five labor tables and every helper, grants only labor mutate/read entry points, and verifies the privilege boundary on startup. Runtime direct SQL/helper calls fail with `42501`. | Pass |
| Demo/simulation exclusion | Mutation and read entry points join the exact execution graph to its transcript and exclude `demo`/`simulation`; no demo result can become Part 3 authority. | Pass at schema and cross-contract boundary |
| No payroll/legal inference | Roadmap, read response, schema comments, and unavailable ledger distinguish observed/entered operational time from payroll, wages, overtime/break compliance, billable/customer price, employment, tax, union, monitoring/consent, geolocation, and profitability conclusions. No wage/rate fields exist. | Pass |
| Part 2/M20–M32 preservation | Migration 039 is additive; migrations 001–038 are unchanged. Part 2 lifecycle remains `not_started`/`in_progress`/`paused`, and Part 3 adds no later-domain authority. | Pass in focused and protected-migration regression |
| Rendered-surface boundary | The candidate changes no `public`, `views`, browser, CSS, or UI files. This proves no Part 3 rendered-surface diff, not browser/founder visual approval. The Part 9 contract now requires the current deployed NorthStar design system as the minimum bar. | Pass for source scope; visual acceptance not applicable |
| Migration runner, exact-once, retry, and local restart zero-op | Normal application runner applies 001–039 using separated migration/runtime roles. A forced 039 transaction interruption leaves no table/ledger row; retry applies exactly once; rerun preserves the one row/checksum/timestamp. Primary runtime restart also verifies the normal runner and privileges. | Pass in disposable PostgreSQL 18.4 |
| Production history/recovery truth | Exact 039 Git identity is recorded separately. Read-only receipt `2026-09-04T10:35:08.764Z` reports production PostgreSQL 18.6, Etc/UTC, UTF8, en_US.utf8, 36 applied rows, 37 candidate sources, zero name/checksum mismatches, and exactly frozen 039 pending at 56,232 bytes / SHA-256 `2204695c9be757a66094897f6bb9e86bee9c84f1582a3bc27812d7bbdebdf13a`. No private row, credential, or mutation was involved. No backup receipt or restore rehearsal is available; conservative forward-fix/no destructive rollback disposition remains. | Production pre-application history/compatibility pass; recovery unavailable |
| No premature release claim | This ledger reports writer evidence only. Independent exact-head audit, ready, merge, deployment, production ledger, health, and passive acceptance are not claimed. | Pass |

## Current writer test results

### Focused Part 2/Part 3 unit boundary

- Test suites: 2 passed / 2 total
- Tests: 31 passed / 31 total
- Snapshots: 0
- Failures: 0

### Disposable PostgreSQL 18.4 Part 2/Part 3 authority

- Test suites: 1 passed / 1 total
- Tests: 21 passed / 21 total
- Snapshots: 0
- Failures: 0
- Server: PostgreSQL 18.4, loopback port 55433, UTF8, UTC, locale C,
  data checksums on
- Disposable data directory:
  `C:/Users/joshv/AppData/Local/Temp/northstar-m23p3-pg-1af2154436314475b933b24270307f98`

The suite covers the Part 2 predecessor plus Part 3 timer/manual/correction/
review, DST gap/fold, summaries, overlap/open-timer races, exact/mismatched/
concurrent replay, forced audit rollback, stale/cross-tenant/forged/revoked/
crew-revoked replay, direct privilege denial, immutable history, category/time
source staleness, control-byte rejection, migration interruption/retry/exact-
once/rerun zero-op, and PostgreSQL 18 UTC identity.

### Complete ratification regression

- Test suites: 19 passed / 19 total
- Tests: 328 passed / 328 total
- Snapshots: 0
- Failures: 0

### Broad unit regression

- Test suites: 90 passed / 90 total
- Tests: 5,298 passed / 5,298 total
- Snapshots: 0
- Failures: 0

### M21–M23 and protected-migration cross-contract regression

- Test suites: 6 passed / 6 total
- Tests: 107 passed / 107 total
- Snapshots: 0
- Failures: 0
- Included Part 2/Part 3 HTTP contracts, Mission 21 and Mission 22 contract/time
  suites, and protected migration checks.

### PostgreSQL predecessor, account, and security regression

- Test suites: 6 passed / 6 total
- Tests: 72 passed / 72 total
- Snapshots: 0
- Failures: 0
- Included Part 2/Part 3 field execution, Mission 22 assignment/human approval,
  account authority, and Mission 20 security/role authority on PostgreSQL 18.4.

All counts are writer evidence, not an independent audit or release verdict.
