# Mission 27 Part 11C — bidirectional accounting reconciliation readiness

Status: implementation candidate for original Part 11C. Released Parts 11A–11B remain the provider-neutral source contract and value-free destination, mapping, transmission, acknowledgement and partial-failure boundary. This slice adds one owner/administrator, tenant-private, read-only `GET /api/v1/customer-financial/editable-estimates/:estimateId/accounting-reconciliation-readiness` boundary. It does not accept an external record, record a match or correction, mutate NorthStar or an adapter, create accounting or tax truth, or expose a demo, customer or public route. Part 11D owns rendered whole-Part-11 acceptance.

## Exact bidirectional record and state contract

The route consumes the exact released Part 11B readiness contract and revalidates the complete released Part 10 source around projection. No accepted Part 11A source fact, Part 11B destination, transmission or acknowledgement exists, so no external accounting record can be matched. Every identity, revision, digest, amount, currency, review and correction value remains unavailable and null; the emitted reconciliation-record count is zero. Zero emitted records does not claim zero financial or accounting activity.

The immutable record version is `m27-accounting-reconciliation-record-v1`. Every eventual record must carry exact NorthStar source, export-request, acknowledgement-receipt and external-record identities, revisions and digests; exact currency and absolute minor units; an immutable reconciliation revision and digest; and exact correction and reviewer lineage when applicable. Missing identity, revision, digest, amount, currency or time never becomes zero, current time, a match or authority. Arrival order cannot supply occurrence, revision, match or authority.

The exact ordered state vocabulary is `matched`, `unmatched`, `conflicting`, `corrected`, and `unavailable`:

- `matched` requires exact pins on both sides plus exact currency and absolute-minor-unit equality. Adapter acknowledgement cannot self-apply the match.
- `unmatched` requires exactly one identified missing side. A side cannot be inferred from arrival order or converted from missing to zero/current.
- `conflicting` requires an exact pinned disagreement. It cannot be resolved silently and an external record cannot override NorthStar.
- `corrected` appends an exact reviewed successor to one exact prior reconciliation while retaining the prior state. It cannot rewrite either source record.
- `unavailable` remains the state when any required source, export, acknowledgement or external evidence is absent. It cannot be promoted without new exact evidence.

## Authority and correction boundary

NorthStar and the receiving adapter remain separate source owners. Reconciliation compares both directions, but the external side cannot rewrite a NorthStar fact state, amount, currency or lineage. Reconciliation cannot create an invoice, payment, settlement, check-clearance fact, tax or recognition policy, filing, journal decision or books-close authority. The adapter acknowledgement remains machine evidence rather than a human action.

The frozen `customer_financial.accounting.reconcile` capability requires dual control for manual match, manual mismatch resolution and manual books-status override. Role alone never authorizes reconciliation. Current capability, recent-authentication, MFA, independent-approval, action-reason and receiving-adapter states are unavailable, so no action route exists and reconciliation remains unauthorized. Any eventual correction is append-only, requires the exact prior reconciliation and exact current records on both sides plus a reviewed reason, and retains the prior reconciliation.

## Access, privacy and effects

Only a current paid owner or administrator with a current tenant session and subscription may read this value-free contract. The request accepts exactly one current handoff receipt identity and digest. Cross-tenant, missing-session, member/viewer, widened-query and non-GET requests fail closed before projection. The response is private and no-store and exposes no tenant, customer, source record, amount, destination account/company, export request, acknowledgement, external record, credential, secret or idempotency-key value.

The read creates no reconciliation or correction row, NorthStar or external mutation, accounting mutation, provider call, receiver mutation or money movement. No migration is needed; migration 272 remains latest and no 273 exists. Adapter runtime and acknowledgement, accepted source facts, exact external record evidence, current capability/assurance/control, private production, production performance/SLA, professional accounting/tax review and first-paying-customer live-money validation remain unavailable.

Focused unit/static and fresh disposable local PostgreSQL 17 evidence cover exact ordered states, both source sides, match/conflict/correction semantics, strict malformed/contradictory/leaked rejection, before-and-after source revalidation, owner/admin access, tenant/subscription/query/method denial, GET-only CORS, restart, zero protected residue, migration 272 remaining latest with no 273 and zero external transport. Browser evidence is not applicable because Part 11C adds no rendered or demo surface; Part 11D owns rendered acceptance. Founder visual approval remains separate and ungranted.
