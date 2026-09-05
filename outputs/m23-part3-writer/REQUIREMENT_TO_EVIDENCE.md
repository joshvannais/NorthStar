# Mission 23 Part 3 — Requirement-to-evidence ledger

## Frozen scope boundary

- Exact deployed base:
  `e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`
- Branch: `mission23/part3-labor-time`
- Worktree: `/home/joshv/codex-writers/mission23-part3-labor-time`
- Exact candidate migration-freeze commit:
  `716ecb5d52f021d644930ffacd0407037274b2ae`
- First independently audited candidate head:
  `a08421e601a0125a89298c3dca68dea2e1d888b1` (changes required:
  P0=0, P1=1, P2=2, P3=0)
- Forward-only migration 040 freeze commit: `d66974d32f6c61849b0a432e02fc82093d4d0628`
- Second independently audited corrected head:
  `b92036215618ef2b26804fc7fce300ea3d34f331` (changes required:
  P0=0, P1=0, P2=1, P3=0)
- Forward-only migration 041 freeze commit: `04e1891195d5ebbbb760210cc080de753163aa19`;
  exact blob/bytes/SHA are recorded in `MIGRATION_041_IDENTITY.md`.
- Scope: additive canonical actual labor/time evidence tied to Part 2 field
  execution and current Mission 22 assignment authority.
- Excluded: materials, inventory, equipment/assets, files/media, notes,
  checklists, inspections, progress, blockers, changes, completion/reopening,
  UI, Polaris, providers, pricing, payroll, invoice/payment, and Parts 4–12.

## Production application receipt follow-up boundary

- Exact deployed base:
  `ee6cac8b729f73a5af22c7d5747fd52c1d1d4035`
- Exact independently accepted Part 3 candidate:
  `8de66512d1baa335e4e7151b6a7232c94de9dc0a`
- Branch: `mission23/part3-production-receipt`
- Worktree:
  `/home/joshv/codex-writers/mission23-part3-production-receipt`
- Scope: documentation, evidence, and ratification assertions only.
- Excluded: runtime, schemas, migrations, routes, UI, providers, credentials,
  configuration, production mutation, calculator work, and Parts 4–12.

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
| Timer/manual interval rules | Server time owns timer start/stop; clients cannot provide timer instants. Migration 040 applies the five-minute future ceiling independently to both manual/correction endpoints; exact offset-bearing RFC3339, order, tenant-zone offset, and 31-day bounds remain required. Timers over 16 hours and owner-entered worker time become `needs_review`, but remain closeable. | Corrected after P2 audit finding; passed focused PostgreSQL |
| UTC, tenant zone, and display evidence | Canonical rows retain UTC instants, exact raw offset strings, Business Profile ID/version/hash, IANA zone, and deterministic local display projection. DST gap is rejected; distinct fold instants remain distinct despite matching local display. | Pass in PostgreSQL 18.4 UTC fixture |
| Correction and review history | `correct` and `review` require exact interval revision/digest. Current rows advance one revision; immutable event, revision snapshot, audit, and replay evidence retain prior facts and actor/performer attribution. Open timers cannot be reviewed. A review restoring non-rejected authority now passes the worker overlap gate under the existing serialization lock before any write. | Corrected after P1 audit finding; exact sequence, race, retry, and zero-effect PostgreSQL tests pass |
| Immutable complete evidence and rollback | Deferred completeness requires matching current/event/revision/audit/idempotency evidence. History rejects update/delete/truncate. A forced audit-insert failure rolls back interval/event/revision/idempotency with zero partial effects. | Pass |
| Idempotency and concurrency | Keys are hashed; request identity is DB-computed; exact replay returns the stored response only after current reauthorization; changed-content key reuse conflicts. Serializable writes plus idempotency/worker locks make concurrent identical requests one effect and worker-wide record/review overlap and open-timer races one winner. Rejected review retries create no current/history/audit/idempotency effect. | Corrected and passed focused PostgreSQL |
| Current actor, performer, assignment, crew, and dispatch authority | Server derives tenant/account/role/session/CSRF. PostgreSQL reloads active membership/account/workforce/session/subscription/onboarding and exact non-demo execution/assignment. Members act only as themselves on direct/current-crew work; owner/admin on-behalf entry remains attributed and needs review. Forged performer, cross-tenant access, revoked assignment/dispatch, and removed crew fail closed, including replay. | Pass for adversarial cases |
| Safe operational summaries | Read authority returns bounded interval projections and category totals/counts. It explicitly labels observations as operational evidence, not payroll, wage, billable, price, profitability, overtime/break, tax, or legal conclusions. | Pass |
| Strict HTTP boundary | Raw boundary owns only `POST /api/v1/field-executions/:executionId/labor-actions`; it rejects compressed, duplicate-key, malformed UTF-8/JSON, oversized, or pre-parsed bodies. Contract uses exact keys, NFC/control checks, fixed limits, required idempotency, revision/digest/source pins, and rejects injected/inapplicable authority fields. `GET /:executionId/labor` rejects query strings. | Passed focused unit |
| Safe response/oracle behavior and bounded resources | Existing tenant authentication, permission and server-derived rate limiting apply; route responses are `no-store`; unavailable errors are generic; PostgreSQL statement/lock/transaction timeouts and capped reads bound work. | Passed focused unit and PostgreSQL |
| Runtime least privilege | `src/db.js` revokes direct privileges on all five labor tables and every helper, including the 041 source classifier, grants only labor mutate/read entry points, and verifies the privilege boundary on startup. Runtime direct SQL/helper calls fail with `42501`. | Pass |
| Demo/simulation and ambiguous-source exclusion | Mutation and read entry points join the exact execution graph to its transcript and invoke the single 041 classifier before idempotency replay or disclosure. The classifier explicitly removes ASCII TAB/LF/VT/FF/CR/space and Unicode White_Space edges, recognizes only `demo`, `lead`, `retell`, `simulation`, and `voice`, and permits labor only for `lead`/`retell`/`voice`. Demo, simulation, unknown, embedded-control, and ambiguous values fail closed for fresh mutation, exact replay, and read with zero current/history/audit/idempotency effects. | Corrected after terminal P2 audit finding; table-driven focused PostgreSQL pass |
| No payroll/legal inference | Roadmap, read response, schema comments, and unavailable ledger distinguish observed/entered operational time from payroll, wages, overtime/break compliance, billable/customer price, employment, tax, union, monitoring/consent, geolocation, and profitability conclusions. No wage/rate fields exist. | Pass |
| Part 2/M20–M32 preservation | Migrations 001–040 are unchanged. Migration 041 adds one Part 3 classifier and replaces only the two Part 3 entry functions. Part 2 lifecycle remains `not_started`/`in_progress`/`paused`, and Part 3 adds no later-domain authority. | Pass in focused and protected-migration regression |
| Rendered-surface boundary | The candidate changes no `public`, `views`, browser, CSS, or UI files. This proves no Part 3 rendered-surface diff, not browser/founder visual approval. The Part 9 contract now requires the current deployed NorthStar design system as the minimum bar. | Pass for source scope; visual acceptance not applicable |
| Migration runner, exact-once, retry, and local restart zero-op | Normal application runner applies 001–041 using separated migration/runtime roles. Forced 039, 040, and 041 transaction interruptions leave no target effect/ledger row; retry applies each exactly once; rerun preserves one row/checksum/timestamp. Primary runtime restart verifies the normal runner and privileges. | Pass in disposable PostgreSQL 18.4 |
| Production history/recovery truth | Exact 039, 040, and 041 Git identities are recorded separately after freeze. A bounded combined read-only receipt proved pre-application compatibility for exact 039+040 against corrected head `b920362...`: 36 applied rows, no source/history mismatches, and only 039/040 pending. It predates 041. The later post-application ledger proves 39 rows and exact one-row identities for 039–041, but cannot retroactively prove an unsupplied terminal 039+040+041 pre-application inspection. No backup receipt or restore rehearsal is available; conservative forward-fix/no destructive rollback disposition remains. | 039+040 historical preflight and 039–041 post-application ledger recorded; terminal pre-application and recovery evidence remain unavailable |
| Independent acceptance and normal merge | The terminal Part 3 candidate `8de66512d1baa335e4e7151b6a7232c94de9dc0a` was independently accepted. PR #163 merged normally at `2026-09-04T14:29:12Z` as `ee6cac8b729f73a5af22c7d5747fd52c1d1d4035`; accepted and merge trees both equal `2abaf5251a16e52afac0bf1a4f2b1da7783ea460`. | Achieved for the Part 3 implementation |
| Sole automatic deployment and first application | Railway deployment `e1d88caa-339e-49b6-a08a-60cd20eddcf9` reached `SUCCESS` at the exact merge using image `sha256:35bc3cf838052c911a93ca01bd2892a3f6db054da67b7742fc462aac4970082a`. Its complete ordinary startup log contained exactly one application entry for each of 039, 040, and 041. | Achieved for the first production start |
| Exact production migration ledger | Read-only production verification reported PostgreSQL 18.6, Etc/UTC, UTF8, en_US.utf8, `migrationCount = 39`, and exactly one row for each of 039, 040, and 041. Checksums exactly match their frozen identities and every row retains `applied_at = 2026-09-04T14:30:01.345Z`. | Achieved for exact one-row first application |
| Production health | Three credential-free `GET https://northstar-os.ai/api/health` requests each returned HTTP 200 with status `ok`, PostgreSQL persistence, and `database` plus `canonicalPersistence` healthy. | Achieved for the observed automatic deployment |
| Later-start migration zero-op | PR #164 receipt head `2abef4be3e31c2c468762598edc0e79859f67c2f` merged normally as `15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`. Automatic Railway deployment `2b498fe1-d025-4be7-bd90-cef6154f9bb8` produced a later ordinary start with no migration-application entry. Read-only verification retained the exact 39-row ledger, one row per 039–041, all three checksums, all three original timestamps, and healthy canonical persistence. See `LATER_START_ZERO_OP_RECEIPT.md`. | Achieved; Part 4 progression gate passed |
| Receipt-follow-up scope | `PRODUCTION_APPLICATION_RECEIPT.md`, this ledger, unavailable evidence, roadmap status, migration identity cross-references, and ratification assertions only. No runtime/schema/migration/route/UI/provider/calculator or later-part source was changed by that receipt release. | Independently accepted and released through PR #164 |
| No premature release claim | The implementation's independent acceptance, normal merge, first automatic application, exact ledger, health, and separate later-start zero-op are recorded. The released receipt does not manufacture missing terminal pre-application history, backup/restore evidence, or acceptance of Part 4. | Truthful release boundary |

## Production application receipt follow-up test results

### Focused Part 1/Part 2/Part 3 receipt ratification

- Test suites: 4 passed / 4 total
- Tests: 31 passed / 31 total
- Snapshots: 0
- Failures: 0

### Complete ratification regression

- Test suites: 20 passed / 20 total
- Tests: 336 passed / 336 total
- Snapshots: 0
- Failures: 0

### Mission 21–23 and protected-migration cross-contract regression

- Test suites: 7 passed / 7 total
- Tests: 113 passed / 113 total
- Snapshots: 0
- Failures: 0
- Included the new production-receipt ratification plus Part 2/Part 3 HTTP
  contracts, Mission 21 and Mission 22 contract/time suites, and protected
  migration checks.

These follow-up runs used the repository's locked dependencies and Windows Node
through the native WSL/ext4 worktree. They are writer evidence, not an
independent exact-head audit or release verdict.

## Part 3 implementation writer test results

### Focused Part 2/Part 3 unit boundary

- Test suites: 2 passed / 2 total
- Tests: 31 passed / 31 total
- Snapshots: 0
- Failures: 0

### Disposable PostgreSQL 18.4 Part 2/Part 3 authority

- Test suites: 1 passed / 1 total
- Tests: 44 passed / 44 total
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
source staleness, control-byte rejection, rejected-review overlap reproduction,
concurrent review one-winner and retry zero-effects, future end rejection for
manual/correction, explicit ASCII/Unicode edge normalization and fail-closed
demo/simulation/unknown-source mutation/read/replay denial with complete
zero-effect snapshots, 039/040/041 interruption/retry/exact-once/rerun zero-op,
and PostgreSQL 18 UTC identity.

### Complete ratification regression

- Test suites: 19 passed / 19 total
- Tests: 330 passed / 330 total
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

- Focused Part 2/3 suite: 1 passed / 1 total; 44 passed / 44 tests
- Predecessor/security segment: 4 passed / 4 total; 40 passed / 40 tests
- Isolated account-authority segment: 1 passed / 1 total; 11 passed / 11 tests
- Aggregate exact-head result: 6 passed suites; 95 passed tests; 0 assertion failures
- Snapshots: 0
- Failures: 0
- Included Part 2/Part 3 field execution, Mission 22 assignment/human approval,
  account authority, and Mission 20 security/role authority on PostgreSQL 18.4.

At predecessor corrected head `b920362...`, the first all-six invocation passed
77/78 before one long-standing account-capability case exceeded its 300-second
per-test timeout under accumulated suite load; that exact account suite then
passed 11/11 in isolation. The terminal 041 candidate was run in the same
conservative segmented form from the outset: focused Part 2/3, four predecessor/
security suites, and the long account-authority suite each completed green.

All counts are writer evidence, not an independent audit or release verdict.
