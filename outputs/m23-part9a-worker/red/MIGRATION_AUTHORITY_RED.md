# Mission 23 Part 9A migration-authority red evidence

Date: 2026-09-07 (America/New_York)

This evidence was captured after the explicit one-migration scope amendment and
before creating migration 053 or changing runtime database grants/query code.

## Static contract red

Command:

```text
npm test -- --runInBand tests/unit/m23-part9a-worker-operational-experience.test.js
```

Result: exit 1; 1 suite failed; 1 test failed and 4 passed. The failure required
`migrations/053_current_worker_execution_projection.sql`, which did not exist.

## Mounted PostgreSQL red

The exact disposable PostgreSQL 18.4 cluster was restarted at loopback port
55629 with UTF-8, `C/C`, UTC, and checksums on. Its identity environment pointed
at only the verified data directory under
`C:/Users/joshv/Documents/Codex/2026-09-07/m23-part9-pg18/data`.

Command:

```text
npm test -- --runInBand tests/integration/m23-part9a-execution-projection-migration.test.js tests/integration/m22-part6-mobile-today-postgres.test.js
```

Result: exit 1; 2 suites failed; 7 tests failed and 2 passed.

The independently meaningful failures were:

- mounted Today still failed from production `todayRows()` with SQLSTATE
  `42501`, `permission denied for table canonical_field_executions`;
- a direct runtime call failed because
  `canonical_field_execution_read_by_appointment(uuid,uuid,text,uuid,uuid)` did
  not exist;
- the migration lifecycle test failed because the exact migration 053 file did
  not exist.

The run freshly applied the byte-exact migrations through 052. No migration 053,
runtime grant, owner-pool workaround, browser-held authority, provider call,
production access, remote write, merge, or deployment had occurred at this red
gate.
