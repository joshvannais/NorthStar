# Mission 25 Part 12C candidate evidence

## Frozen authority

- Base: `ff26d626b0ac111d93ed43fb641465cd4d0995c2`
- Scope: provider-neutral communication evidence import only
- Migration: `115_canonical_external_communication_import_authority.sql`
- Schema: `m25-external-communication-evidence-v1`
- Record classes: communication, delivery and satisfaction

Intent, delivery and satisfaction remain separate source facts. Delivery never becomes satisfaction. A satisfaction label requires explicit customer feedback or a human review of explicit customer feedback; automated sentiment is rejected. Provider-classified intent remains a source claim. No message content is retained. Every 12C external identity/reference uses the same Node/PostgreSQL `ref_` plus 64-lowercase-hex rule, and cursors use `cur_` plus 64 lowercase hexadecimal characters.

## Executed evidence

- Fresh disposable PostgreSQL 17.10 applied migrations 001-115 and passed the mounted Part 12C API journey.
- Mounted coverage passed owner/admin access, member/viewer denial, tenant isolation, entry-only runtime privileges, separate source permission, exact permission pins, maximum 100-record multi-time-zone page, concurrent exact-key replay, changed-key conflict, independent historical/continuous cursors, deterministic duplicate handling, higher-version correction, explicit unknown/unavailable state, same-version conflict, detail-free tombstone, stale cursor, invalid time zone, cross-purpose facts, unsupported intent bases, inferred-satisfaction rejection, revocation masking, regrant non-revival and explicit new-period reimport.
- Node/API and direct PostgreSQL parity adversaries rejected content-bearing values in every 12C identity/reference field: email address, compact phone, formatted phone, customer-name, subject, transcript, body and message-like strings. Strict table constraints use the same representation, so bypassing guarded entry functions cannot persist those values.
- Direct-table adversaries also rejected extra and nested claim keys, unexpected claim types and values, and content-bearing or unknown time zones. Exact claim key/type/value checks and an immutable PostgreSQL 17 time-zone catalog foreign key protect the values returned by the read projection; valid intent, satisfaction and known time-zone cases remained accepted.
- Runtime direct `SELECT`, `INSERT`, `UPDATE` and `DELETE` on that catalog returned SQLSTATE `42501`; guarded imports continued to operate through the four intended entries. Source-pinned clone controls proved that a second source containing both New York and Chicago evidence cannot change the selected fixture or its expected New York zone.
- The corrected final fresh maximum 100-record page completed in 89 ms at the HTTP boundary, below the unchanged five-second statement timeout.
- The same PostgreSQL 17 cluster separately passed the accepted mounted Part 12A CRM/field-service and Part 12B project/change-order API journeys after migration 115.
- Six focused contract/ratification suites passed: 53 tests across Parts 12A, 12B and 12C.
- JavaScript syntax checks and `git diff --check` passed.
- The exact base-to-candidate file inventory contains no `public/`, view, HTML or CSS change. Source assertions confirm that the existing Learning Center does not reference the new routes. The standing wording gate was applied to API errors and business-facing boundary messages; no rendered state changed.

## Preserved boundaries

The candidate stages evidence and has no provider adapter or connection. A later adapter must tokenize identities before calling NorthStar; raw values are not silently transformed. It stores no message content or contact details. Migration 115 remains unreleased and now creates strict token constraints in its first production transaction, so no accepted production migration path can first create permissive immutable rows. It does not infer intent from content, satisfaction from delivery or sentiment, acceptance from a reply, or an operational or financial outcome. It does not reconcile, calibrate or mutate customers, leads, jobs, appointments, executions, estimates, projects, change orders, invoices, payments, schedules, dispatch, communications, provider state or company policy. Parts 12D-K remain unimplemented.

## Unavailable evidence

No live provider, provider credential, private production account, private production data, provider-specific schema validation, production migration, deployment, physical-device review, manual assistive-technology review or founder visual verdict is claimed. Native NorthStar invoice, payment and collection evidence remains unavailable until Mission 27.
