# Mission 23 Part 8 second-correction writer test results

Writer-only evidence; no result is independent audit or production acceptance.
Audited parent: `13f9348312a354835b7a56eddc133d00492b7b53`.
The postcommit handoff seals the new head/tree against the tested file blobs.

## Current verification

- Focused final-schema completion and 051 lifecycle: 2/2 suites, 10/10 tests.
- Fresh read-only writer-side candidate review: no concrete surviving bypass
  or regression. This is not the required different independent PR auditor.
- Complete Mission 23 matrix: 28/28 suites, 488/488 tests; zero skipped/failed.
  Unit/ratification: 17 suites, 320 tests. Mounted/migration: 11 suites, 168 tests.
  One combined run completed in 145.689 seconds.
- Broader regressions: 7/7 suites, 92/92 tests; zero skipped/failed, 26.993 seconds.
  The retained five shared-path suites contribute 62 tests; canonical graph
  contributes 21 and canonical identity contributes 9.
- Final diff whitespace and changed JavaScript syntax checks passed.

The new mounted assertions cover no-op runtime UPDATE rejection for every
provenance/binding column, DELETE denial, unchanged stored row, scheduling
FOR SHARE, all five valid source ingestion/replay controls and invalid source
rejection by the shared ingestion normalizer. SQL tests reject false/true,
numbers, objects, arrays and missing values for all three textual fields;
JSON null is rejected for note and reopening, but retained for annotation
nextAction. Every rejection compares current execution and eight evidence/
receipt table counts. Valid strings commit and replay, including reopening.

## Reproducible commands and environment

From the repository root:
`node_modules/.bin/jest.cmd --config jest.config.js --runInBand --silent --runTestsByPath <enumerated files>`

Mission 23 inventory is every tracked tests/unit/m23-part*.test.js,
tests/ratification/m23-part*.test.js and tests/integration/m23-part*.test.js,
plus the new 051 lifecycle test. Broader files are the five previously required
shared-path regressions plus canonical graph and identity PostgreSQL suites.

Exact broader files: tests/unit/m19-part3-tenant-audit.test.js,
tests/unit/m20-phase7-lane5-observability.test.js,
tests/unit/pre-m23-p2-support-repository.test.js,
tests/unit/protected-migration-checksum.test.js,
tests/integration/m22-part7-mission-wide-postgres.test.js,
tests/integration/m19-part3-canonical-graph-postgres.test.js,
tests/integration/m19-part3-canonical-identity-postgres.test.js.

- Node.js 24.18.1.
- Disposable PostgreSQL 18.4; UTF8, UTC, locale C, checksums enabled.
- Loopback admin URL: postgresql://postgres@127.0.0.1:55523/postgres.
- M19_EXPECTED_PG_PORT=55523.
- M19_EXPECTED_PG_DATA_DIR=C:/Users/joshv/Documents/Codex/2026-09-06/northstar-m23-part8-correction/work/pg18-writer/data.
- Unique M19_TEST_RUN_ID per run; inherited DATABASE_URL/MIGRATION_DATABASE_URL
  are removed before the required matrix.
- Mounted suites create and clean synthetic databases/roles. No provider access.

## Earlier observations, not current acceptance evidence

The original candidate was 26/481; corrected parent 13f9348 was 27/484.
Those counts describe historical heads, not this correction.
An earlier Windows LF checkout failure belongs to the prior correction.
During this stage, starting pg_ctl without the retained loopback/UTC options
failed; using port 55523 and UTC succeeded. Two focused red runs caught an
unparsed PostgreSQL name[] assertion and the old blanket table-DML verifier.
The authority projection now uses text[] and transcripts are checked by the
narrow authority verifier. Both focused suites then passed in full.
