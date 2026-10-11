# Mission 27 Part 2A — canonical billing-party identity

Status: implementation candidate. Independent whole-head audit, merge, deployment, migration 260, and production health evidence are pending.

## Authority

Part 2A creates one tenant-private billing-party identity for one already-existing current `canonical_customers` row. It captures the exact customer, source operation and graph, customer-source digest and revision time, authorized actor, membership, session, and an immutable unreviewed origin snapshot. It cannot create or merge a customer, accept caller-provided customer details, approve a billing contact or address, authorize document use, create a financial document, or change money.

This is the first half of the frozen Q3 identity gate. Part 2B still owns owner-reviewed billing contacts, service and billing addresses, purchase-order and customer reference fields, currentness correction, and append-only correction lineage. Part 2C still owns currency, exact-money and number reservation. Part 2D still owns the mounted paid and isolated fictional-demo review journeys and whole-Part-2 acceptance.

Mission 24 remains the estimate, proposal, approved-price and commercial-revision authority. Mission 22 owns scheduling and dispatch, Mission 23 owns work evidence, Mission 25 owns tenant-private learning, and Mission 32 remains the later deep field calculator using the shared canonical estimate model. A billing identity grants none of those authorities.

## Durable contract

Migration `260_customer_financial_billing_identity_v1.sql` adds three append-only relations:

- `canonical_customer_financial_billing_parties_v1` binds one billing party to one existing same-tenant canonical customer.
- `canonical_customer_financial_billing_identity_snapshots_v1` retains sequence-one `party_origin_unreviewed` evidence. A later financial document must pin an immutable reviewed snapshot accepted by its owning slice; it cannot read mutable customer fields as its historical identity.
- `canonical_customer_financial_billing_identity_requests_v1` retains exact actor/session-scoped idempotency receipts without storing the raw request key.

All three relations reject update, delete and truncate, expose no direct runtime table privileges, and use restrictive tenant-qualified foreign keys. The runtime role receives execute access only to the three guarded candidate, read and establish entries. Their helpers remain private.

The server derives every retained field from the same locked canonical customer row. The caller supplies only the customer identity, exact expected source digest and revision time, action reason and request key. The origin keeps:

- the canonical customer, operation, graph and optional upstream external identity;
- name, generic unclassified address, email and phone as `source_candidate` or explicitly unavailable;
- tax, exemption and delivery as value-free `owner_review_required` states;
- actor, access role, membership, session and capture time;
- `reviewState: unreviewed`, `documentUseAuthorized: false`, and `automaticCustomerCreationAuthorized: false`.

Missing contact or address is never converted to an empty value. A non-object legacy address shape fails value-free. No prospect, location, billing-address, delivery, tax, exemption or document authority is inferred from the canonical customer.

## Access, concurrency and currentness

Candidate and read require a current paid owner/admin session. Establishment additionally requires onboarding, subscription, CSRF, a printable 16–128 byte idempotency key, a 12–500 byte reason, a serializable transaction, and exact expected source digest and revision time.

Establishment locks the actor/session request identity and tenant/customer identity. An identical replay returns the saved response. Reusing the key with different evidence fails as an idempotency conflict. A stale source returns `billing_customer_source_changed` without writing. Existing current identity is reused; a changed customer source returns `billing_identity_source_changed_requires_review`, hides retained values, and waits for Part 2B correction authority. No older snapshot silently becomes current.

Cross-tenant and absent customer selection use the same value-free `billing_customer_identity_unavailable` response. The migration contains no customer insert/update/delete statement and invokes no provider, receiver, scheduling, work, estimate, invoice, payment, communication or learning mutation.

## Evidence boundary

Part 2A evidence is limited to the server contract, migration/runtime privileges and fresh disposable PostgreSQL behavior. There is no mounted route or UI in this slice because Part 2D owns the paid/demo identity journey. Provider sandbox, live money, customer traffic, accounting, Mission 28 automation, physical Safari/devices, CI, disaster restore and founder visual approval remain unavailable or out of scope. Migration 260 is the sole additive migration after 259.
