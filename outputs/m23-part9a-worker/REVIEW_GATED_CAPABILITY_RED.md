# Mission 23 Part 9A review-gated capability red evidence

Captured before correcting migration 053's current-worker capability projection.

Command:

`jest --runInBand tests/integration/m22-part6-mobile-today-postgres.test.js --silent`

Result: 1 suite failed, 6 tests passed, 2 tests failed. The primary failure
proved that a production-sourced, in-progress assignment marked
`needs_review=true` was incorrectly offered five server actions that their
authoritative mutation functions reject:

- `record_equipment`
- `record_progress`
- `record_blocker`
- `record_exception`
- `record_change`

The second failure was the expected cascade after the primary test stopped
before creating its later crew execution fixture. No provider or external call
was made.
