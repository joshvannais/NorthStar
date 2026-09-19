# Mission 25 Part 12B candidate evidence

## Frozen authority

- Base: `1be699f1fc855d2570df9f9930d3a78667a1990e`
- Scope: provider-neutral project and change-order import authority only
- Migration: `114_canonical_external_project_change_order_import_authority.sql`
- Schema: `m25-external-project-change-order-v1`
- Record classes: project and change order

Original contract, current contract and change-order value are distinct source facts. A value is recorded with its exact decimal string and currency or explicitly unavailable. Change orders separately retain an increase, decrease or no-change effect, including deductive changes without ambiguous signed arithmetic. No contract delta, currency conversion, approval, reconciliation or outcome is inferred.

## Executed evidence

- Fresh disposable PostgreSQL 17.10 applied migrations 001-114 and passed the mounted Part 12B API journey.
- Mounted coverage passed owner/admin access, member/viewer denial, tenant isolation, entry-only runtime privileges, separate source permission, exact permission pins, maximum 100-record multi-time-zone page, concurrent exact-key replay, changed-key conflict, independent historical/continuous cursors, deterministic duplicate handling, higher-version correction, explicit unknown/unavailable state, same-version conflict, detail-free tombstone, stale cursor, invalid time zone, malformed/cross-purpose contract values, revocation masking, regrant non-revival and explicit new-period reimport.
- The maximum 100-record page completed in 73 ms at the HTTP boundary during the retained fresh run, below the fixed five-second statement timeout.
- The same fresh chain passed the accepted mounted Part 12A CRM and field-service API journey after migration 114.
- Four focused contract/ratification suites passed: 22 tests across Part 12A and 12B.
- JavaScript syntax checks and `git diff --check` passed.
- The exact base-to-candidate file inventory contains no `public/`, view, HTML or CSS change. Source assertions confirm that the existing Learning Center does not reference the new routes. The standing wording gate was applied to API errors and business-facing boundary messages; no rendered state changed.

## Preserved boundaries

The candidate stages evidence and has no provider adapter or connection. It does not store credentials, fuzzy-match references, reconcile a record, calculate an outcome, derive financial truth, or mutate customers, leads, jobs, appointments, executions, estimates, projects, change orders, invoices, payments, schedules, dispatch, costs, provider state or company policy. Parts 12C-K remain unimplemented.

## Unavailable evidence

No live provider, provider credential, private production account, private production data, provider-specific schema validation, production migration, deployment, physical-device review, manual assistive-technology review or founder visual verdict is claimed. Native NorthStar invoice, payment and collection evidence remains unavailable until Mission 27.
