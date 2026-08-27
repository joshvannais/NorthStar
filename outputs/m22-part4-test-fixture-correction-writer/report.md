# Mission 22 Part 4 test-fixture correction writer report

Status: **WRITER TERMINAL — AUDIT REQUIRED**

This is the narrow test-only correction for validated finding `M22-P4-003`.
It does not constitute independent approval. A different fresh read-only
auditor must inspect the exact pushed head before PR #147 can leave draft.

## Immutable input

- Base/live `main`: `76943b124d4978af5cb7eeaecf9fdfc46307ec6e`.
- Corrected PR head received from the prior writer/auditor cycle:
  `03ba43e30625278a72880c6ae4e0d4fd3ce7c98e`.
- Input tree: `9f8135406345a87ba8d5ab37d258e5feef727fb8`.
- PR #147 was OPEN, DRAFT, CLEAN, and MERGEABLE with no hosted checks.
- Migration 035 SHA-256 remained
  `47b2b9e729e7ad89ce1dd55c2d88dfc25a52d0e720f171476a9552654b671cdb`.
- Migrations 001-034 remained byte-identical to the input head.

## Narrow correction

Only `tests/integration/m22-part4-human-approval-postgres.test.js` changed.
The exact-expiry regression now:

1. seeds a dedicated appointment inside the test;
2. performs a valid, self-contained `assign` transition rather than depending
   on an earlier test to make the shared appointment eligible for `reassign`;
3. samples `clock_timestamp()` once in a one-row CTE;
4. derives `created_at`, exact `expires_at = created_at + 15 minutes`, and both
   digest timestamp inputs from those same derived values; and
5. retains the real inclusive expiry rejection and zero-revision assertion.

No product, migration, package/lock, UI, roadmap, provider, or production byte
changed. The correction adds no retry, tolerance, clock mock, skip, or weakened
assertion.

## Terminal writer evidence

- Exact named test: 1/1 green in three independent fresh database invocations.
- Full mounted Part 4 file: 14/14 green in three normal fresh invocations.
- Mounted Parts 1-4 compatibility: 57/57 green.
- Locally available full Jest: 149/149 suites and 2,081/2,081 tests green,
  in-band, 560.405 seconds.
- Disposable PostgreSQL: 18.4, UTC, data checksums enabled, loopback-only port
  55562; stopped cleanly, `pg_isready` exit 2, no `postmaster.pid`, and the
  validated temporary data directory was removed.
- Part 3 compatibility retained zero provider calls. This test correction did
  not add or invoke any provider path.

The prior exact-head fresh/startup/restart evidence was not rerun because no
runtime, migration, dependency, or package byte changed. It remains preserved
by the independently audited startup artifact identified in
`auditor-artifact-hashes.txt` and by the prior writer evidence identified there.

Exact machine-generated JSON and PostgreSQL diagnostics are retained outside
the public Git branch at workspace-root
`outputs/m22-part4-test-fixture-correction-writer/tests`. Their identities are
pinned in `raw-evidence-hashes.sha256`; the raw payloads are intentionally not
exported to GitHub.

## Preserved non-green evidence

Jest's test randomizer was exercised with seed 2204. The repaired boundary case
passed, but a different pre-existing shared-fixture test (`rejects stale
authority, changed sessions/roles, cross-tenant and employee mutation`) failed
13/14 with an earlier 409. That result is preserved verbatim and was not used as
a green gate or broadened into an unauthorized suite redesign.

An initial exact-name command used anchors that excluded Jest's enclosing suite
title and therefore selected 0/14 tests. Its JSON is also preserved. The three
subsequent correctly selected named invocations are the counted evidence.

## Verdict boundary

`M22-P4-003` is corrected from the writer's perspective, but PR #147 remains
audit-pending. This report does not authorize merge, release, deployment,
production access, visual acceptance, provider readiness, or Mission 22 Part 5.
