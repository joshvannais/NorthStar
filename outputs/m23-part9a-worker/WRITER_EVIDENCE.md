# Mission 23 Part 9A worker evidence

Date: 2026-09-07 (America/New_York)  
Role: sole implementation writer; this is not independent audit approval  
Branch: `review/m23-part9a-worker-operational-experience`  
Frozen implementation commit: `a8948544b8faf5cf263c687e7d175a6f21b3e896`  
Implementation tree: `976927172529a1e27de516b8108b703d4e169987`  
Implementation parent: `c654c36082378dc77705142027629135b3ebe256`  
Accepted frozen base: `aa728e2631650ffe65340c0332ba94106397eac2`

## Authority

- `serialized-package-plan.md`: `9abe80623032c22f70ec24332666560afbc50e91e6368cc17ddb27795fd7c4cd`
- `backlog-matrix.md`: `48d3fce6f03a026185bceb4e0c87165c3192597fef30fab7c86ff9a1e97d6175`
- `acceptance-gates.md`: `747aab5dfa7d1e235c0690aa7b1c3be36717a03f70d21555c73d771790a387db`
- Part 9A scope receipt: `c0b1de17f0a6145f5cfec40de269a589f839b837a4c9fdd759e18e111656cddf`

The founder separately authorized exactly one narrow additive projection
migration after the mounted runtime-role negative control proved that the
accepted authority could not discover a current execution without direct table
access. The amendment is preserved in `MIGRATION_SCOPE_AMENDMENT.md`.

## Implemented boundary

- Preserves Today as a read-only direct/current-crew list and adds one inert
  `Open work` link.
- Mounts `/dashboard/work` over the accepted Parts 2–8 routes and durable
  PostgreSQL authorities.
- Derives the selected execution pointer and exact mutation capabilities on the
  server under current tenant, user, membership, session, workforce,
  direct/current-crew, subscription, onboarding, assignment, appointment, and
  transcript authority.
- Covers initialization, lifecycle, labor, material, reviewed equipment,
  checklist/observation/note, truthful unavailable file storage, progress,
  blocker/exception/change, completion proposal/withdrawal, and terminal
  read-only history.
- Uses pinned assignment/execution/domain revisions and digests, CSRF,
  idempotency, one pending mutation, confirmations, fresh reads, device-local
  authority-scoped drafts, and fail-closed session/scope changes.
- Renders hostile dynamic text through DOM creation and `textContent`; no
  provider, demo, scheduling, dispatch, canonical pricing, Polaris, Business
  Profile mutation, owner/admin operational view, or cross-page Part 9B/9C work
  was added.

At the implementation commit the candidate range is exactly 19 ordinary linear
commits and zero merges from the accepted base. It changes 42 tracked paths,
adds 16,065 lines, removes 32 lines, and has zero deleted files, renames, or
copies. Most additions are preserved red/browser evidence. The implementation
commit itself changes 19 files, adds 2,042 lines, removes 31 lines, and has zero
deletions or renames.

## Migration 053

- path: `migrations/053_current_worker_execution_projection.sql`
- Git blob: `7428c905405d73c7a01ea376d4e4510ecc66d2ff`
- bytes: `10,934`
- SHA-256 over bytes identical to the Git blob:
  `67cb4dd2a45074944e4dc3f2e4c8ac9fd958b4158e99e58b84371bce921f0753`
- behavior: one read-only `STABLE SECURITY DEFINER` current-worker projection;
  fixed search path; public execution revoked; runtime granted only the entry
  routine; no table/helper/DDL authority
- migration history: migrations 001–052 are unchanged; interruption after DDL
  rolled back both routine and ledger; upgrade preserved sentinel data; apply
  added exactly one ledger row; rerun was zero-op; all constraints validated
- release consequence: disposable PostgreSQL proves local compatibility only.
  Authoritative production-history/UTC reconciliation, automatic deployment
  application, later-start zero-op, and the separately required recovery or
  founder-approved forward-fix disposition remain release hard gates.

## Green verification

- Focused Parts 2–9A unit/contract suites: 11/11 suites, 256/256 tests.
- Fresh/upgrade PostgreSQL matrix for Today and Parts 2–9A: 14/14 suites,
  180/180 tests.
- Account migration controls: 23/23 compatible tests passed; the one exact
  archived `9ec181...` physical-ordinal negative control was skipped and remains
  unavailable, not passing.
- Disposable database identity: PostgreSQL 18.4, server encoding UTF8, database
  locale C/C, timezone UTC, checksums on, loopback port 55629. Every task-created
  database was removed by its harness. The exact task-owned cluster at
  `C:\Users\joshv\Documents\Codex\2026-09-07\m23-part9-pg18\data` was then
  stopped cleanly; `pg_isready` returned no response on port 55629.
- Installed Chrome `152.0.7977.82`: 38 mounted cases, 263 recorded intercepted
  requests, zero provider calls, zero external escapes, zero page errors.
- Actual Playwright WebKit `26.5`: 38 mounted cases, 263 recorded intercepted
  requests, zero provider calls, zero external escapes, zero page errors.
- Both engines covered light/dark, reduced motion, 1440 desktop, 390 and 320
  mobile, plus explicitly labelled device-metrics-equivalent 200% and 400%
  reflow profiles. Those profiles are not physical browser-zoom or physical
  Safari/device evidence.
- Dynamic controls covered every worker action in scope, exact payload
  normalizers, same-key retry, double-submit suppression, conflicting stale
  mutation, acknowledged-mutation refresh failure, empty initialization,
  terminal history, partial storage, mixed execution snapshots, secondary-read
  session expiry, offline, session rotation, stale draft eviction, multiple tabs,
  back/forward, focus restoration, keyboard semantics, ARIA names/status, inert
  hostile text, and zero horizontal overhang.
- Final browser manifest: 22/22 entries verified, SHA-256
  `1252407b40955d2b9f370d94b7e7947ae780336e85fbceba4b04cece7b083169`.
- JavaScript syntax checks and `git diff --check` passed.

## Full Jest truth

The unfiltered compatible-environment run, with only the exact archived `9ec`
test-name exclusion, completed in 921.961 seconds:

- suites: 199 passed, 14 failed, 213 total
- tests: 6,780 passed, 77 failed, 1 skipped, 6,858 total

The 14 non-green suites are preserved exact historical phase/baseline
incompatibilities, not relabelled as passing:

1. `tests/ratification/m23-part1-operations-contract.test.js`
2. `tests/ratification/m23-part2-production-application-receipt.test.js`
3. `tests/ratification/m23-part3-labor-time-evidence.test.js`
4. `tests/ratification/m23-part3-production-application-receipt.test.js`
5. `tests/ratification/m23-part4-material-inventory-evidence.test.js`
6. `tests/ratification/m23-part5-equipment-authority.test.js`
7. `tests/ratification/m23-part6-field-evidence-authority.test.js`
8. `tests/ratification/m23-part7-progress-authority.test.js`
9. `tests/ratification/m23-part8-completion-authority.test.js`
10. `tests/integration/m22-part4-human-approval-postgres.test.js`
11. `tests/api/m19-part3-canonical-api-postgres.test.js`
12. `tests/api/m19-part3-business-profile-postgres.test.js`
13. `tests/api/m20-phase5-financial-configuration-postgres.test.js`
14. `tests/api/m20-phase6a-retell-webhook-containment-postgres.test.js`

Items 1–9 freeze their historical part-only status/diff and intentionally reject
later accepted Mission 23 work. Items 10–13 rely on legacy direct UPDATE or
TRUNCATE cleanup that later immutable Mission 23 authority now denies. Item 14's
single terminal-call serialization case timed out both on this writer and on the
clean exact accepted base; the focused reproduction was 1 failed/46 skipped in
each checkout. It is therefore a pre-existing deterministic baseline failure,
not Part 9A or provider evidence.

## Preserved red evidence

Tests-first and correction evidence is retained for the absent mounted consumer,
missing runtime projection authority, missing server capability contract,
review-gated capability exposure, mixed snapshots, complete mutation flow,
authority-scoped drafts, crew rotation, stale drafts, desktop heading layout,
session rotation, theme authority, zoom-equivalent reflow, completed history,
empty initialization, truthful states, and secondary-read session expiry. The
last red control proved a 401 secondary read was incorrectly treated as partial
evidence before the smallest fail-closed correction.

## Drift and publication stop

Direct Git reports live `main` at
`b84f51b1220b74fc71da0ce07ed3958b9c678d58`, a descendant of the frozen base.
It changes 101 paths from the base, while this candidate changes 42 tracked paths;
the path intersection is zero and live main adds no migration. Nevertheless,
the writer has not integrated, rebased, reset, merged, pushed, or opened a PR.
Publication remains stopped pending canonical coordinator direction for this
base drift. The remote Part 9A branch and pull ref are absent.

Frozen PR pull refs remain exact: #66
`c841a145df4bbf1adb099a96cd6c4bbf9f6aca04`, #80
`a0dd173c313c63c0d2e851f72966a1634822b3b4`, and #81
`c280576eddcb037fbc1ad2f7a0da6c0589aafb7b`. Part 8 branch and pull ref remain
`73a714cbad4f3600d354f66d10e7f24f2d20e411`.

## Unavailable and unclaimed

No hosted CI result, independent audit, PR, merge, deployment, production
migration/history/backup/restore, private production data/log, provider/canary,
physical Safari/device, manual assistive-technology, penetration/load/DR, legal
review, or founder personal visual approval is claimed. The browser inspection is
agent visual evidence only. No credential was inspected, no provider or external
call was made by the Part 9A mounted evidence, and no production state changed.
