# Mission 23 Part 8 third-correction writer tests

Writer-only evidence from the same correction campaign, based on audited
c96e710d60a14ba4d39ed78c854ac91e5318303e over current main/base
a5bc90ddede95d0a88e6f857f8c75c9637dd8245. Independent Daybreak re-review remains
required at the final published head. No old-head exploit was executed.

## Current gates

- Red tests-first: 3 suites, 4 expected failures, 11 intentionally filtered
  skips. Old startup accepted a surviving text grant/rejected zero grants;
  mounted has_column/has_any_column checks observed true before any mutation.
- Focused green: 4/4 suites, 16/16 tests; no failures/skips, 16.799 seconds.
- Complete Mission 23: 30/30 suites, 492/492 tests, zero failed/skipped/todo,
  138.309 seconds. Unit/ratification: 18 suites/323 tests; integration/migration:
  12 suites/169 tests.
- Broader seven-suite set: 7/7 suites, 93/93 tests, zero failed/skipped/todo,
  20.927 seconds. The added scheduling concurrency assertion accounts for the
  increase from the previous 92-test baseline.
- Scheduling-focused unit/Part 8 ratification: 4/4 suites, 46/46 tests,
  6.188 seconds; zero failures/skips.
- Every completed test invocation reported externalAttempts=0 through the
  test-only transport boundary. Zero provider calls were made.
- Diff whitespace and changed runtime JavaScript syntax checks passed.
- Separate local candidate-review pass found no concrete regression in the
  bounded correction; not independent audit.

## Meaningful coverage

Unit authority tests require zero UPDATE columns and fail closed if text
privilege survives. Mounted completion asserts every column UPDATE denied
without changing data, exact text/fingerprint/row equality, valid shared
ingestion/replay for lead/retell/voice/demo/simulation and invalid-source denial.
Existing typed completion mutation, source gates, replay, concurrency and
tenant/session/assignment denials remain.

Mounted production scheduling tests send simultaneous authenticated conflict
requests and compare canonical evidence digests. A held production evaluation
continues to exclude an assignment FOR UPDATE contender, while an owner
transcript lock contender succeeds without changing any populated row.
Ordinary conflict/approval/Calendar/Command Center/Today flows remain covered.

Migration 052 tests initial pre-reconciler revocation, rollback/restored stale
ACL, exact retry/checksum, and stale PUBLIC/runtime removal on zero-op startup.
Previous migration lifecycles remain independently checked. Ratification pins
all 001–051 bytes, 052 identity, current base and the compatibility merge's two
parents; final PR-body equality is checked after publication, not inferred.

## Commands and environment

From the existing checkout:
node_modules/.bin/jest.cmd --config jest.config.js --runInBand --silent
--json --outputFile <same-campaign evidence file> --runTestsByPath <exact files>.

Complete Mission 23 enumerates every tests/unit/m23-part*.test.js,
tests/ratification/m23-part*.test.js and tests/integration/m23-part*.test.js.
The seven broader files are:
- tests/unit/m19-part3-tenant-audit.test.js
- tests/unit/m20-phase7-lane5-observability.test.js
- tests/unit/pre-m23-p2-support-repository.test.js
- tests/unit/protected-migration-checksum.test.js
- tests/integration/m22-part7-mission-wide-postgres.test.js
- tests/integration/m19-part3-canonical-graph-postgres.test.js
- tests/integration/m19-part3-canonical-identity-postgres.test.js

Focused scheduling unit suites: m22-part2-conflict-authority,
m22-part4-human-approval and m22-part5-owner-dispatcher-ux, plus Part 8 ratification.

Node 24.18.1. Fresh PostgreSQL 18.4, UTF8, locale C, UTC, checksums on, separate owner/runtime
roles per suite, loopback 127.0.0.1:55583 only. Data:
C:/Users/joshv/Documents/Codex/2026-09-06/northstar-m23-part8-correction/work/pg18-third-correction/data.
M19_PG_ADMIN_URL=postgresql://postgres@127.0.0.1:55583/postgres;
M19_EXPECTED_PG_PORT=55583; expected data directory as above; unique run IDs.
Inherited DATABASE_URL/MIGRATION_DATABASE_URL removed before invocations.
NODE_OPTIONS preloads the same-campaign loopback-only transport guard for
Jest and child processes. Red and focused green report externalAttempts=0.
No dependency or production/test configuration was changed for the guard.

Historical 26/481, 27/484 and 28/488 results belong to earlier heads.
They are not represented as results for this correction.
