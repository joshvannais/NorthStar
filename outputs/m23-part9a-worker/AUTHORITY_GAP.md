# Mission 23 Part 9 Slice A authority gap

Date: 2026-09-07

This is writer evidence, not independent audit approval.

## Frozen provenance

- Base/main: `aa728e2631650ffe65340c0332ba94106397eac2`
- Tests-first head: `de069c5f01d4adde817b1c89412f7b510b3b9eb5`
- Branch: `review/m23-part9a-worker-operational-experience`
- No remote branch or pull request existed when this gap was found.
- No implementation commit, push, migration, provider call, production access,
  merge, or deployment occurred.

## Reproducible red

A fresh PostgreSQL 18.4 cluster was initialized outside OneDrive at
`C:/Users/joshv/Documents/Codex/2026-09-07/m23-part9-pg18/data` on loopback port
`55629`. It uses UTF-8, `C/C`, UTC, and data checksums.

The mounted command was:

```text
npm test -- --runInBand tests/integration/m22-part6-mobile-today-postgres.test.js
```

With `M19_PG_ADMIN_URL` pointed only at that disposable cluster, the run applied
the exact migration set through 052 and then failed 5 of 7 cases. The first
failure is SQLSTATE `42501`, `permission denied for table
canonical_field_executions`, at `todayRows()` in
`src/scheduling/todayRepository.js`. The remaining four failures are the same
mounted failure presented as HTTP 503 responses. Two unrelated static-route
cases passed.

This is an intended least-privilege boundary: runtime startup revokes all table
privileges on `public.canonical_field_executions` and grants only selected
security-definer function execution.

## Existing-contract check

The existing `canonical_field_execution_read(...)` requires the execution UUID.
No existing granted function resolves or lists an execution by appointment.

`canonical_field_execution_initialize(...)` is not a reusable discovery read:

1. A replay is accepted only for the original organization, actor user, exact
   idempotency-key hash, exact request digest, and appointment identity.
2. A new request for an appointment with an existing execution raises
   `canonical_field_execution_already_exists` and returns no execution UUID.
3. Another authorized crew member or a later session cannot reconstruct the
   original replay identity.
4. Its creation gate rejects assignment states that do not permit a new
   execution; it cannot discover completed/reopened historical authority.

Therefore neither browser persistence, blind initialization, nor an owner-pool
query can satisfy current reload/deep-link/crew access while preserving Today as
read-only and the runtime least-privilege boundary.

## Required decision

Either explicitly authorize one narrow additive migration that exposes a
tenant/session/current-assignment-scoped security-definer execution projection
by appointment (runtime `EXECUTE` only, still zero table `SELECT`), with full
fresh/upgrade/rollback/checksum/concurrency evidence, or revise the frozen Slice
A contract to exclude durable existing-execution discovery. No workaround is
being used while that decision remains open.

## Unaffected local evidence

- Focused unit/contract set: 6 suites, 178 tests passed.
- Installed Chrome 152.0.7977.82: 7 mounted cases passed across 1440, 390, and
  320 pixels, both themes, lifecycle confirmation/focus, offline behavior, and
  inert hostile text; 64 loopback requests, zero external/provider calls.
- Playwright WebKit 1.62.1/2336 initially exited during launch, and an older
  2311 fallback was stopped after it hung. A bounded official forced reinstall
  of the matching 2336 browser repaired the local runtime. The final actual
  Playwright WebKit run then passed the same 7 mounted cases at 1440, 390, and
  320 pixels in both themes, including lifecycle confirmation/focus, offline
  behavior, inert hostile text, zero page errors, and zero provider calls.
  This is WebKit evidence, not physical Safari evidence or user visual approval.
