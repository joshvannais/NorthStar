# Mission 28 Part 11A — exact-current collection eligibility

Status: **Implementation candidate only.** This is an owner-readable, provider-neutral, no-effect source contract. It does not mount an eligibility resolver, create a collection review or work item, authorize communication, or change any financial, accounting, customer, invoice, balance, payment, settlement, refund, dispute, or upstream record.

## Released baseline

Part 10D was accepted at source `9353c69c176aac4c777804c4da8fe897f2b84b6f` / tree `524169816689bde1f685ac4bd8bcbc09c303fdc0` after a third fresh isolated audit with P0=P1=P2=P3=0. PR #592 merged normally to main `99aee0958d1e7c4097f0a534c8fa6461766b7784`. Railway deployment `77f306ac-caf3-44ee-bcd5-6a8ea4ca0239` is `SUCCESS`, instance `e396317c-8684-4203-92d4-46007ed9a184`, image `sha256:37afa2e518ae71a1cfef11aadc9f59f087f706ca9438c3e4bfd03fb43058d310`. Canonical startup, database/canonical persistence, `/api/health`, `/`, `/dashboard`, `/demo/`, and dashboard/demo 91,314-byte SHA-256 `ab65083c5dd9bac308798171df2e65f711e89df9a6864ea15b569bf9f64ab757` parity passed. Source migrations remain 283 through 287 with no 288. Direct applied production migration history was not re-queried and remains unavailable and unclaimed.

## Exact separated facts

Part 11A never collapses collection eligibility into one status. One candidate resolution must bind the same tenant and exact current issued invoice version across these separately trusted axes:

1. immutable issued, customer-safe invoice version, excluding draft, void, replaced, superseded, or unknown documents;
2. separate exact currency and positive outstanding balance, excluding zero, missing, stale, cross-version, and pending or uncertain tender;
3. separate due and aging projection, including exact due instant, projection revision/digest, aging bucket, and days past due;
4. separate exact delivery evidence; unknown, unavailable, failed, or recalled delivery is ineligible;
5. separate dispute, refund, and post-issue correction states;
6. separate settlement and offline-tender states, including clearance-unknown, returned, and reversed evidence;
7. separate accounting state and any blocking adjustment; and
8. separate current customer relationship and contactability state.

Every axis is immutable trusted source evidence, not permission. Aging is evidence, not permission. Delivery or communication evidence never proves payment, cash, revenue, accounting, or collection success. Settlement, payment, allocation, balance, accounting, and collection outcomes remain distinct.

The complete ordered axis material is bound to one exact Part 4B source set and its latest active Part 4D authoritative head. The aggregate and each axis must be latest exact current at evaluation. Any newer source, correction, replacement, tombstone, reversal, stale/mixed/unavailable currentness, or changed authoritative head invalidates the resolution. Event time and observation time are immutable evidence only and never establish precedence.

## Deterministic eligibility boundary

The closed precedence is source availability, invoice, balance/tender, due/aging, delivery, dispute/refund/correction, settlement/offline tender, accounting, customer state, then owner-review eligibility. All results use fixed nonreflective reason codes and labels. Even the final result is only `eligible_for_owner_collection_review_only`; it does not create a review record, worklist, task, reminder, message, recipient, channel, provider call, fee, write-off, charge, refund, allocation, accounting entry, balance change, external effect, upstream mutation, or money movement.

The accepted Mission 27 sources do not currently supply one mounted complete issued-invoice, delivery, accounting, customer-state, and receivable-population resolver. Consequently the current live result is fixed `ineligible_source_authority_unavailable`. The executable grammar describes what a separately trusted future resolver would have to prove; candidate material cannot create that resolver or establish its own authority.

## Privacy, replay, and shape

Only exact ordinary data with closed keys and primitive types is accepted. Symbols, accessors, `toJSON`, proxies, wrappers, custom prototypes, sparse arrays, aliases, coercion, extra/missing/null fields, oversized values, noncanonical identifiers/timestamps/digests, cross-tenant/customer/invoice/version/currency grafts, and candidate-created authority fail closed before lookup or digest use. The server recomputes the axis-material, material, stable semantic idempotency, and full request digests. Same-identity exact replay is idempotent; a conflicting replay or same semantic material under another identity/time is denied.

## Explicit exclusions and unavailable evidence

Part 11B policy, Part 11C explanation, Part 11D suppression/rebuild, Part 11E worklist/escalation, Part 11F communication/reconciliation, and Parts 12–14 remain unimplemented. No recipient, message, provider, callback, effect, financial mutation, money action, legal conclusion, or founder visual verdict is authorized or claimed. Real customer, provider, payment, settlement, accounting, collection, legal, private-production, hosted-load/SLA, restore, physical-device, manual-assistive-technology, and professional legal/privacy/communications-consent/debt-collection/consumer-protection/tax/accounting/regulatory/security evidence remains unavailable.

Migration 287 remains latest and migration 288 is absent.
