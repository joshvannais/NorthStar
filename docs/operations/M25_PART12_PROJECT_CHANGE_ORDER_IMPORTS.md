# Mission 25 Part 12B project and change-order imports

## Purpose

This authority stages normalized project and change-order evidence from an external business system. It does not connect to that system and does not change NorthStar projects, jobs, estimates, schedules or financial records.

Owners and administrators grant separate permission for one opaque source key. Revocation immediately hides that permission period and blocks new pages. A later grant creates an empty permission period; old records do not return.

## Import contract

- Schema: `m25-external-project-change-order-v1`
- Record classes: `project` and `change_order`
- Page size: 1 to 100 records
- Modes: `historical_backfill` and `continuous_update`
- Confirmation: `m25-external-project-change-order-import-batch-v1`
- Source permission: `m25-external-project-change-order-import-consent-v1`

Every active record retains an opaque identity, increasing source version, exact event and update times, IANA time zone, evidence class and evidence digest. Opaque customer, job and estimate references are optional. A project reference is required for both classes, and a change-order reference is additionally required for a change order. No text matching creates a NorthStar relationship; every active record stays `unmatched` until Part 12E adds reviewed reconciliation.

## Contract-value distinction

Project records carry `originalContract` and `currentContract` as independent facts. Change-order records carry `changeOrderValue` as a separate fact. Each value is either:

- `recorded`, with one exact nonnegative decimal string and three-letter uppercase currency; change orders also record whether the value increases, decreases or does not change the contract; or
- `unavailable`, with no amount or currency.

The importer never subtracts, sums, converts currencies or assumes that the current contract equals the original contract plus imported change orders. Deductive change orders remain explicit decreases rather than ambiguous signed amounts. It never treats a proposed change order as approved. Project and change-order lifecycle states remain separate and include an explicit `unknown` state.

## Corrections, removals and recovery

An exact source identity and version may replay only with identical content. A changed record requires a higher source version and appends immutable history. A removal is a higher-version tombstone with no retained project, contract or relationship detail.

Historical and continuous cursors advance independently within the current permission period. Each page pins the current permission revision and digest. A stale cursor, permission or record version fails closed. Exact idempotent retries return the prior receipt; the same request key with different content is rejected.

## Access and boundaries

Only current owners and administrators with operations permission may use the four guarded entry functions. Runtime has no direct table or projection-helper access. Pages use a source-scoped transaction lock, serializable writes and the existing five-second statement timeout.

This slice stages evidence only. It does not call a provider, store provider credentials, reconcile opaque references, calculate project outcomes or financial results, or change customers, leads, jobs, appointments, executions, estimates, projects, change orders, invoices, payments, schedules, dispatch, costs or policy. Communications, external finance, reconciliation, observations, calibration, lifecycle cleanup and the Learning Center remain Parts 12C-K. Native NorthStar invoice and payment evidence remains unavailable until Mission 27.
