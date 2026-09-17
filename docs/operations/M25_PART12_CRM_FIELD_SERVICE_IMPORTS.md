# Mission 25 Part 12A CRM and field-service imports

## Purpose

This authority stages normalized evidence from a business's CRM or field-service system. It does not connect to a provider by itself and does not change NorthStar operating records.

Owners and administrators explicitly grant permission for one opaque source key. A grant creates a permission period. Revocation immediately hides that period's imported records and blocks new pages. Granting permission later creates a new period; earlier records do not return.

## Import contract

- Schema: `m25-external-crm-field-service-v1`
- Record classes: `customer`, `lead`, `job`, `appointment`, `issued_estimate`
- Page size: 1 to 100 records
- Modes: `historical_backfill` and `continuous_update`
- Confirmation: `m25-external-crm-field-service-import-batch-v1`
- Source permission: `m25-external-crm-field-service-import-consent-v1`

Historical and continuous cursors advance independently inside one permission period. An incomplete historical page and every continuous page must return a next cursor. A completed historical page must not. The next request must provide the exact prior cursor for that mode. A new permission period starts with empty cursor and record lineage; evidence appears only after an explicit new-period import, even when the provider reports the same source version.

Each active record supplies an opaque identity, increasing source version, strict record class and state, only the opaque related references allowed for that class, exact event and source-update timestamps, an IANA time zone, evidence class and evidence digest. The schema has no fields for names, contact details, addresses, notes, financial values or currency; source adapters must not place business details inside opaque references. `unknown` is retained as a real source state. Every active record remains `unmatched` until separate reviewed reconciliation is implemented.

## Corrections and removals

An exact source identity and version may replay only with the same content. Different content at the same version is rejected. A correction uses a higher version and appends history. A removal uses a higher-version tombstone containing no business detail beyond source identity, version, removal state and source-update time.

## Access and recovery

Only current owners and administrators with operations permission may read or write this authority. The application role can call four guarded entry functions and has no direct table or helper access. All writes are serializable, bounded by the existing five-second statement timeout and protected by one source-scoped transaction lock.

If a cursor, permission pin or current record changes, refresh the source and retry with a new request key. An exact retry with the same key and body returns the original receipt. Reusing a key for different content is rejected.

## Boundaries

The import stages evidence only. It does not call a provider, store provider credentials, match records, infer missing states, or change customers, leads, jobs, appointments, estimates, dispatch, schedules, invoices, payments, provider records or policy. Project and change-order data, communications, finance, reviewed reconciliation, outcome learning, calibration, retention, deletion and the Learning Center belong to later Part 12 slices.
