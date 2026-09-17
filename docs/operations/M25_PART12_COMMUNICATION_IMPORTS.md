# Mission 25 Part 12C communication evidence imports

## Purpose

This authority stages normalized communication evidence from an external business system. It does not connect to that system, retain message content or change NorthStar customers, leads, jobs, appointments, estimates, projects or communications.

Owners and administrators grant separate permission for one opaque source key. Revocation immediately hides that permission period and blocks new pages. A later grant creates an empty permission period; old records do not return.

## Import contract

- Schema: `m25-external-communication-evidence-v1`
- Record classes: `communication`, `delivery` and `satisfaction`
- Page size: 1 to 100 records
- Modes: `historical_backfill` and `continuous_update`
- Confirmation: `m25-external-communication-import-batch-v1`
- Source permission: `m25-external-communication-import-consent-v1`

Every external record identity and customer, lead, job, appointment, estimate, project or communication reference uses one exact non-content representation: `ref_` followed by 64 lowercase hexadecimal characters. A source adapter must create that value as a non-reversible, source-scoped token before calling NorthStar, such as an HMAC-SHA-256 value made with a source-specific secret that NorthStar does not receive or store. Import cursors use the parallel `cur_` plus 64 lowercase hexadecimal representation. Raw provider identifiers, names, contact details and message-like text are rejected rather than transformed or stored.

Intent and satisfaction evidence accept exactly `status`, `value` and `basis`; extra or nested content is rejected at both the import and table boundaries. Time zones must be present in the PostgreSQL 17 time-zone catalog frozen when the authority is installed. The guarded import and immutable record foreign key therefore accept the same known names, and direct table writes cannot substitute free-form text.

Every active record also retains its increasing source version, exact event and update times, IANA time zone, evidence class and evidence digest. Customer, lead, job, appointment, estimate and project tokens are optional. No text matching creates a NorthStar relationship; every active record stays `unmatched` until Part 12E reviewed reconciliation.

## Intent, delivery and satisfaction boundaries

A communication record carries its channel and direction. Its intent is either explicitly unavailable or recorded with one source basis: customer-explicit, human-reviewed or provider-classified. A provider classification remains a provider claim; it is not a verified customer outcome.

A delivery record carries only a recorded delivery state such as sent, delivered, failed, bounced, read or unknown. Delivery does not establish intent, customer satisfaction, estimate acceptance, job completion or payment.

A satisfaction record is accepted only when the source identifies explicit customer feedback or a human review of explicit customer feedback. Automated sentiment is not an accepted satisfaction basis. Satisfaction may remain explicitly unavailable or unknown. The import stores no message body, subject, transcript, email address, phone number, customer name or other communication content. Node and PostgreSQL enforce the same exact token grammar before any immutable history is written.

## Corrections, removals and recovery

An exact source identity and version may replay only with identical content. A changed record requires a higher source version and appends immutable history. A removal is a higher-version tombstone with no retained communication or relationship detail.

Historical and continuous cursors advance independently within the current permission period. Each page pins the current permission revision and digest. A stale cursor, permission or record version fails closed. Exact idempotent retries return the prior receipt; the same request key with different content is rejected.

## Access and boundaries

Only current owners and administrators with operations permission may use the four guarded entry functions. Runtime has no direct access to consent, run, record or time-zone catalog tables and no projection-helper access. Pages use a source-scoped transaction lock, serializable writes and the existing five-second statement timeout.

This slice stages evidence only. It does not call a provider, store provider credentials, reconcile opaque references, interpret message content, calculate a customer-response outcome, or change customers, leads, jobs, appointments, executions, estimates, projects, change orders, invoices, payments, schedules, dispatch, communications or company policy. External finance, reviewed reconciliation, observations, calibration, lifecycle cleanup and the Learning Center remain Parts 12D-K. Native NorthStar invoice and payment evidence remains unavailable until Mission 27.
