# Mission 27 Part 9C — credit-note and refund-request readiness

## Frozen authority

Original Part 9C owns an owner-reviewed credit note and refund request with an
exact bounded amount, immutable reason, original payment/allocation lineage,
idempotency, and provider acknowledgement. The two actions stay distinct. A
credit note is an append-only invoice correction and never rewrites issued
bytes or proves money returned. A refund request is not a completed refund, and
a provider acknowledgement is not refund settlement.

The frozen `mission27.launch.v1` policy requires
`customer_financial.invoice.correct` for a credit note and
`customer_financial.refund.issue` for a refund. Both require recent-auth/MFA
assurance and conditional dual control. A credit delta is bounded at 2,500,000
USD minor units and permits a single current human only through 100,000 with an
exact current issued document and current Mission 24 commercial-change
authority. A refund is bounded at 10,000,000 minor units, permits single control
only through 100,000 against one exact current settled original card charge and
its refundable remainder, and requires a different current approver above that
threshold. Missing amount, balance, authority, identity, currentness, charge,
remainder, reason, or approval denies the action.
Offline cash-return claims and check refunds before clearance remain unsupported.

## Value-free readiness boundary

Released Part 5D provides the exact append-only correction boundary. Released
Part 9A provides the exact attempt/allocation/overpayment and original-charge
refund-review boundary. Part 9C strictly consumes both witnesses. They prove
that no immutable issued invoice, current balance, accepted payment/allocation,
settled original charge, refundable remainder, action capability,
recent-auth/MFA fact, independent approval, request receipt, or provider
acknowledgement exists.

`GET /api/v1/customer-financial/editable-estimates/:estimateId/credit-refund-readiness`
is a private no-store owner/administrator readiness read using one exact handoff
receipt identity and digest. It accepts no caller-authored invoice, amount,
currency, payment, allocation, charge, remainder, provider object, reason,
request identity, URL, or secret. Its result is
`credit_refund_source_evidence_unavailable`: all monetary and identity
projections are null or explicitly unavailable, all credit/refund/provider and
accounting authority is false, and every row, provider, receiver, accounting,
and money-effect count is zero.

No mutation route is presented while the required recent-auth/MFA, exact issued
document, accepted payment, settled charge, refundable remainder, and provider
acknowledgement authority are absent. An idempotency key, CSRF token, role, or
caller request cannot manufacture those prerequisites. No provider transport,
table, migration, public, customer, or demo surface is added.

## Acceptance evidence and unavailable gates

Acceptance requires strict source-witness, capability/assurance, amount/control,
credit/refund separation, ordered-prerequisite, idempotency, provider-
acknowledgement, privacy, no-effect, repository, route, and static tests plus a
mounted fresh disposable PostgreSQL 17 journey through migration 272. The
journey covers paid owner/administrator reads, auth/role/tenant/subscription/
query/method denial, restart determinism, no residue, and zero provider
transport. There is no rendered, public, customer, or demo surface, so browser
evidence is not applicable.

Immutable issued invoice/current balance, Mission 24 commercial-change
authority, action grants, recent-auth/MFA, independent approval, accepted
payment/allocation, settled original charge, refundable remainder, credit-note
or refund request receipt, provider acknowledgement/refund settlement,
sandbox/private production, professional opinions, hosted CI/load, physical
devices, manual assistive-technology review, disaster restore,
first-paying-customer live-money validation, and founder visual approval remain
unavailable and unclaimed.
