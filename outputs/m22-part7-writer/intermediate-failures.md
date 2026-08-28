# Preserved intermediate failures

Intermediate reds were retained rather than rewritten as initial greens. They
were harness/test-design defects unless explicitly classified below; none
validated a new Part 7 production-authority gap.

## Focused record-trace development

The raw `focused-part7-*.json` files preserve these successive failures:

1. queried a nonexistent `last_action` column rather than the revision action;
2. ordinary runtime role correctly lacked `_migrations` read permission, so the
   observer query was moved to the migration role;
3. expected object shape did not match the production response envelope;
4. malformed preview fixture produced HTTP 400 instead of the intended success;
5. collision assertion supplied an invalid payload and reached validation
   before idempotency conflict;
6. wrong response path for a mounted record;
7. hostile-byte assertion used a transformed/nonidentical marker;
8. cross-tenant fixture hit input validation before tenant rejection;
9. revised cross-tenant fixture correctly returned a different fail-closed code
   than the brittle expected code;
10. direct-SQL rejection matcher expected the wrong PostgreSQL error shape;
11. employee revocation assertion incorrectly prohibited hostile identity bytes
    that are legitimately returned as the signed-in employee's own display
    name, even when zero work records remain;
12. upgrade ran 032–035 inside a transaction that retained pending trigger
    events from the legacy fixture; setup was committed before the migration
    boundary, matching supported startup behavior.

The final focused artifact `raw/focused-part7-upgrade-rerun.json` passed 3/3.

## Browser harness development

- The first Calendar marker check compared a presentation-normalized string to
  exact raw hostile bytes. It was corrected to test inert presence without
  pretending the presentation layer preserves case/format bytes.
- The first Command Center marker lookup used an unscoped matching element and
  selected a non-record surface. It was scoped to the mounted record card.
- The Part 5 compatibility matrix crossed a Sunday week boundary and waited for
  an appointment not in the current rendered week. The original retry also
  reproduced the same timeout. The fixture now activates the actual week
  navigation control before interaction. This is a 14-line harness correction,
  not a product Calendar change.

All terminal Chrome/WebKit matrices passed. No intermediate browser red is used
as evidence of a production defect or erased from this ledger.

## Full-corpus reds

Unfiltered full Jest ended at 153/155 suites and 2,136/2,161 tests. The failures
were exactly:

- 24 tests in `account-migration-010-postgres.test.js` because all four required
  `ACCOUNT_MIGRATION_*` disposable identities/URLs were unavailable;
- one `m20-phase7-lane2-email-outbox-postgres.test.js` case whose `beforeEach`
  `DELETE FROM account_email_outbox` hook exceeded 60 seconds late in the
  aggregate run.

The locally available corpus excluding only account-migration-010 again
preserved the same outbox hook timeout: 153/154 suites and 2,136/2,137 tests.
The exact outbox suite then passed alone, 1/1 suite and 14/14 tests in 69.418
seconds. Therefore the aggregate timeout is recorded as timing/resource
contention evidence, not claimed passing and not classified as a validated Part
7 product finding.
