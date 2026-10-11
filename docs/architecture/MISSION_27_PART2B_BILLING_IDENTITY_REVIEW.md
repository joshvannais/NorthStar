# Mission 27 Part 2B — reviewed billing identity

Status: implementation candidate. Independent whole-head audit, merge, deployment, migration 261, and production health evidence are pending.

## Authority

Part 2B lets a current paid owner or administrator explicitly review the billing contact, service address, billing address, purchase-order reference, and customer reference for one Part 2A billing party. A successful review is the first state that may be pinned by a later financial document. The review does not create or merge a customer, infer a prospect, set currency or money, reserve a number, create an invoice or payment, contact a customer, invoke a provider, or mutate any operational receiver.

The source remains one existing same-tenant `canonical_customers` row and its immutable Part 2A origin. Every reviewed field records whether it exactly matches that source or is a human revision. The retained record also pins the source digest and revision time, origin snapshot, actor, membership, session, exact capability grant and revision, business purpose, policy version, reason, and review time.

The accepted launch geography is limited to the United States and District of Columbia. Both addresses therefore require a normalized US state/DC code and ZIP or ZIP+4. A review needs a nonempty contact name and at least one valid email or E.164 phone. Missing optional references remain `not_supplied`; they are never converted to zero or an empty value.

## Durable contract

Migration `261_customer_financial_billing_identity_review_v1.sql` adds two append-only private relations:

- `canonical_customer_financial_billing_identity_reviews_v1` retains each reviewed snapshot, stable billing-contact/service-address/billing-address identities, source currentness, actor authority, and an exact sequence and predecessor.
- `canonical_customer_financial_billing_review_requests_v1` retains minimized actor/session-scoped idempotency receipts without the raw request key.

The runtime role has no direct table access. It can execute only guarded candidate, read, history, and accept entries. Validation, projection, digest construction, and unavailable-state helpers remain private. Both tables reject update, delete, and truncate. Tenant-qualified foreign keys bind every review to its Part 2A party, origin, actor session, and capability grant.

Candidate and read require the released Part 2A `customer_financial.billing_identity.review` capability, its exact current grant revision, the customer scope, `customer_financial.billing_identity` purpose, `mission27.launch.v1` policy, and a current paid owner/admin session. Accept additionally requires CSRF, a bounded reason, strict payload shape, a serializable transaction, exact source expectations, exact predecessor expectations, and a durable idempotency receipt. Entitlement is locked and revalidated at effect time. A subscription cancellation that wins serialization leaves no review or receipt.

## Currentness and corrections

The first review has sequence one and no predecessor. Every correction appends a new review, retains the previous review identity and digest, increments the sequence, and reuses the stable contact and address identities. History exposes minimized lineage metadata; it does not return prior private contact or address values.

When the canonical customer changes, the saved reviewed snapshot remains historical but is no longer returned as current. Read and replay return the named, value-free `billing_identity_review_source_changed` state with `documentUseAuthorized: false`. The next correction must use a newly generated candidate bound to the new source digest and time. Stale source, stale predecessor, stale capability revision, conflicting idempotency reuse, cross-tenant scope, wrong purpose or policy, and concurrent overwrite all fail closed.

The canonical prospect source remains unavailable, so every result states `canonical_prospect_source_unavailable` and `automaticCustomerCreationAuthorized: false`. Part 2B never silently converts an intake, caller claim, contact value, or address into a customer or prospect.

## Boundaries and evidence

Part 2C still owns currency, exact money, document-number reservation, issuance, void, and recovery. Part 2D owns the mounted paid and isolated fictional-demo review journeys and whole-Part-2 acceptance. Mission 24 remains estimate, proposal and approved-price authority; Mission 22 owns scheduling and dispatch; Mission 23 owns work evidence; Mission 25 owns tenant-private learning; Mission 32 remains the later deep calculator through the shared canonical model.

Candidate evidence covers strict server normalization, migration/runtime privilege checks, fresh PostgreSQL install through 261, paid authority, source currentness, correction lineage, replay/conflict/concurrency, effect-time cancellation, immutability, restart recovery, tenant isolation, and zero customer or receiver mutation. No live-money validation was run or fabricated. The controlled live-money validation remains unavailable and deferred until the first real paying customer. Provider sandbox/private production, real customer traffic, CI, physical Safari/devices, disaster restore, and founder visual approval remain unavailable.
