# Mission 27 Part 11B — accounting destination and export readiness

Status: implementation candidate for original Part 11B. Released Part 11A remains the provider-neutral source-fact contract. This slice adds one owner/administrator, tenant-private, read-only `GET /api/v1/customer-financial/editable-estimates/:estimateId/accounting-export-readiness` boundary. It does not select a destination, accept an account mapping, transmit an export, record an acknowledgement or partial failure, reconcile an external record, create a journal or tax fact, or expose a demo, customer or public route. Parts 11C–11D own reconciliation and whole-Part-11 acceptance.

## Exact source, destination and mapping boundary

The route consumes the exact released Part 11A export contract and revalidates the complete released Part 10 source around projection. The Part 11A witness remains value-free: every lifecycle fact is unavailable, no export record exists and no amount, currency, source record, timestamp or destination value is exposed.

The launch contract names `quickbooks_online.accounting_export.v1` in sandbox mode, but its runtime is unavailable. An accounting destination must be explicitly selected by an owner under `m27-accounting-destination-selection-v1`. Administrator role may read the readiness boundary but cannot substitute for owner destination selection. Role alone never authorizes selection or transmission. The selected adapter, mode, destination account/company identity, owner, time, revision and digest all remain null.

The ordered Part 11A fact classes each receive one unavailable mapping slot under `m27-accounting-mapping-review-v1`. Every eventual mapping requires an exact current destination, source-fact contract and destination-account identity plus owner review. NorthStar accepts no caller-authored or inferred mapping and cannot invent a chart of accounts, journal classification, tax policy, revenue-recognition policy, filing or books-close authority. No mapping exists; missing mapping count or digest does not become zero or current.

## Preview, transmission and immutable acknowledgement

`m27-accounting-export-preview-v1` requires exact current destination-selection, mapping-review and source-fact digests. The current candidate record count is exactly zero because Part 11A emits no records; amount and currency stay null. A missing amount, currency, mapping, source or preview time cannot become zero, current time or launch authority, and preview never authorizes transmission.

`m27-accounting-export-transmission-v1` preserves the frozen `customer_financial.accounting.export` conditional-dual-control policy and its exact record and absolute-minor-unit bounds. The current capability grant, receiving adapter, preview and transmission authority are unavailable. Every eventual request requires an exact request identity/digest and minimized idempotency-key digest. Same-key changed input conflicts; exact replay returns the same immutable receipt; an uncertain result requires lookup of the original receipt before any retry; and a retry cannot widen the destination, record set or amount. No external effect may be repeated from a duplicate request.

`m27-accounting-export-acknowledgement-v1` binds one exact destination, adapter, transmission request, external batch and per-record disposition counts. Adapter acknowledgement is evidence rather than human approval. It cannot rewrite a NorthStar source, supply payment settlement or check clearance, or decide tax, recognition or books-close authority.

Partial failure uses `m27-accounting-export-partial-failure-v1` with exact `accepted`, `rejected`, `retryable`, `uncertain`, `duplicate_confirmed`, and `unavailable` dispositions. Missing counts stay null. A partial acknowledgement never becomes whole-batch success; an accepted record cannot be retransmitted without exact duplicate proof; retry is restricted to the exact failed subset; and uncertain records require receipt lookup. Every disposition retains the original source and transmission request pins.

## Access, privacy and effects

Only a current paid owner or administrator with a current tenant session and subscription may read this value-free contract. The request accepts exactly one current handoff receipt identity and digest. Cross-tenant, missing-session, member/viewer, widened-query and non-GET requests fail closed. The response is private and no-store and exposes no tenant, customer, source record, amount, destination account/company, external batch/record, credential, secret or raw idempotency key.

The read creates no destination selection, mapping review, preview, transmission, acknowledgement, partial-failure record, accounting mutation, provider call, receiver mutation or money movement. No migration is needed; migration 272 remains latest and no 273 exists. Production adapter performance remains unclaimed. Accounting destination/runtime, accepted source facts, current capability/assurance/control, reviewed mapping, external receipt, private production, professional accounting/tax review and first-paying-customer live-money validation remain unavailable.

Focused unit/static and fresh disposable local PostgreSQL 17 evidence cover exact ordered contracts, destination authority, mapping semantics, preview, idempotency, acknowledgement, partial-failure recovery, strict malformed/contradictory/leaked rejection, before-and-after source revalidation, owner/admin access, tenant/subscription/query/method denial, restart, zero protected residue, migration 272 remaining latest with no 273 and zero external transport. Browser evidence is not applicable because Part 11B adds no rendered or demo surface; Part 11D owns rendered acceptance. Founder visual approval remains separate and ungranted.
