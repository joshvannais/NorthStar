# Mission 27 Part 2A — canonical billing-party identity

Status: released. Accepted corrected head `729a7dc8d2ca2d72500df51ebc2de88977183373` was merged through PR #482 as exact main `cc1bd643d51fc61883b643e194e3b8c9948c5189` and released by automatic Railway deployment `3bcf9e6c-b8ce-4b5e-a067-381784d24837`; migration 260 applied and `/api/health`, `/`, and `/demo/` returned HTTP 200. Live-money validation was not run and remains deferred until the first real paying customer.

## Authority

Part 2A creates one tenant-private billing-party identity for one already-existing current `canonical_customers` row. It captures the exact customer, source operation and graph, customer-source digest and revision time, authorized actor, membership, session, and an immutable unreviewed origin snapshot. It cannot create or merge a customer, accept caller-provided customer details, approve a billing contact or address, authorize document use, create a financial document, or change money.

This is the first half of the frozen Q3 identity gate. Part 2B still owns owner-reviewed billing contacts, service and billing addresses, purchase-order and customer reference fields, currentness correction, and append-only correction lineage. Part 2C still owns currency, exact-money and number reservation. Part 2D still owns the mounted paid and isolated fictional-demo review journeys and whole-Part-2 acceptance.

Mission 24 remains the estimate, proposal, approved-price and commercial-revision authority. Mission 22 owns scheduling and dispatch, Mission 23 owns work evidence, Mission 25 owns tenant-private learning, and Mission 32 remains the later deep field calculator using the shared canonical estimate model. A billing identity grants none of those authorities.

## Durable contract

Migration `260_customer_financial_billing_identity_v1.sql` adds four append-only relations:

- `canonical_customer_financial_billing_capability_grants_v1` holds the minimized server-owned, customer-scoped grant proof for the exact `customer_financial.billing_identity.review` capability. Each proof pins actor, membership, customer, grant revision, exact `customer_financial.billing_identity` business purpose, `mission27.launch.v1` policy, current owner/admin template, and validity window. There is deliberately no runtime grant-issuance entry in Part 2A.
- `canonical_customer_financial_billing_parties_v1` binds one billing party to one existing same-tenant canonical customer.
- `canonical_customer_financial_billing_identity_snapshots_v1` retains sequence-one `party_origin_unreviewed` evidence. A later financial document must pin an immutable reviewed snapshot accepted by its owning slice; it cannot read mutable customer fields as its historical identity.
- `canonical_customer_financial_billing_identity_requests_v1` retains exact actor/session-scoped idempotency receipts without storing the raw request key.

All four relations reject update, delete and truncate, expose no direct runtime table privileges, and use restrictive tenant-qualified foreign keys. The runtime role receives execute access only to the three guarded candidate, read and establish entries. Their helpers remain private. Runtime execution privilege cannot create, replace, or bypass a capability grant.

The server derives every retained field from the same locked canonical customer row. The caller supplies only the customer identity, exact expected source digest and revision time, action reason and request key. The origin keeps:

- the canonical customer, operation, graph and optional upstream external identity;
- name, generic unclassified address, email and phone as `source_candidate` or explicitly unavailable;
- tax, exemption and delivery as value-free `owner_review_required` states;
- actor, access role, membership, session, exact capability grant identity and revision, business purpose, policy version, and capture time;
- `reviewState: unreviewed`, `documentUseAuthorized: false`, and `automaticCustomerCreationAuthorized: false`.

Missing contact or address is never converted to an empty value. A non-object legacy address shape fails value-free. No prospect, location, billing-address, delivery, tax, exemption or document authority is inferred from the canonical customer.

## Access, concurrency and currentness

Candidate and read require a current paid owner/admin session plus the exact current action-specific capability grant, revision, customer scope, business purpose and policy version. Establishment additionally requires onboarding, subscription, CSRF, a printable 16–128 byte idempotency key, a 12–500 byte reason, a serializable transaction, and exact expected source digest and revision time. Missing, expired, superseded, mismatched or wrong-customer grant evidence fails closed.

Establishment locks the actor/session request identity and tenant/customer identity. It revalidates and locks the current subscription/onboarding entitlement immediately before every durable effect, so cancellation that wins the serialization order leaves no party, snapshot or receipt. Every accepted request key receives an immutable minimized receipt, including a `200` reuse of an existing current identity. An identical replay verifies the retained response digest and then evaluates the current canonical customer source; changed source returns a replayed value-free `409` rather than exposing the saved name, contact or address as current. Reusing a key with different customer, grant or request evidence fails as an idempotency conflict. A stale new request returns `billing_customer_source_changed` without writing. Existing changed source returns `billing_identity_source_changed_requires_review`, hides retained values, and waits for Part 2B correction authority. No older snapshot silently becomes current.

Cross-tenant, wrong-customer and other grant-scope mismatches are rejected as authority failures before any customer value is returned. An authorized lookup whose canonical identity cannot be resolved remains value-free as `billing_customer_identity_unavailable`. The migration contains no customer insert/update/delete statement and invokes no provider, receiver, scheduling, work, estimate, invoice, payment, communication or learning mutation.

## Evidence boundary

Part 2A evidence is limited to the server contract, migration/runtime privileges and fresh disposable PostgreSQL behavior. There is no mounted route or UI in this slice because Part 2D owns the paid/demo identity journey. No live-money transaction was run or fabricated. The controlled live-money validation remains explicitly unavailable and pending as a first-paying-customer production gate. Provider sandbox, customer traffic, accounting, Mission 28 automation, physical Safari/devices, CI, disaster restore and founder visual approval remain unavailable or out of scope. Migration 260 is the sole additive migration after 259.
