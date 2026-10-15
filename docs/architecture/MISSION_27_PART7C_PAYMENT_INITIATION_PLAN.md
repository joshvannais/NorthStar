# Mission 27 Part 7C — exact payment-initiation plan boundary

## Frozen authority

Part 7C may initiate only the exact launch-approved payment plan. Under
`mission27.launch.v1`, the customer path is policy-supported for one exact
current issued invoice, one current scoped customer session, one immutable
allocation and provider-hosted checkout. The issued amount and allocation must
be equal, remain within the exact current balance, use USD, use card, and stay
within 50 through 10,000,000 minor units. Partial and multi-invoice provider
payments are disabled. A business owner or administrator cannot substitute for
the customer session, and the staff initiation path remains
`staff_payment_initiation_unsupported`.

Missing money never becomes zero. A valid exact-zero invoice is a different
fact from an unavailable invoice. The browser return URL cannot mark an invoice
paid, and payment success, capture and settlement remain separate later facts.

## Mounted value-free projection

`GET /api/v1/customer-financial/editable-estimates/:estimateId/payment-initiation-plan`
is an authenticated paid owner/administrator read with the exact reviewed
handoff receipt identity and digest. It revalidates the complete released Part
6B source chain through the current private Part 5 bundle, then binds the exact
released Part 7B provider-connection witness. It accepts no caller-authored
invoice value, balance, currency, allocation, provider account, mode, session,
URL or secret.

The released invoice document and customer session are unavailable, and Part
7B has no current tenant provider account or credential authority. The response
therefore remains named and value-free as `issued_invoice_unavailable`. Invoice
identity/version/digest, balance, amount, currency, allocation, expiry,
idempotency key/receipt, provider session, hosted URL and return/cancel URLs are
all null. No POST, customer/public route or demo route is mounted. No provider
transport, durable payment attempt, credential, receipt, downstream mutation or
money effect occurs.

## Evidence and exclusions

Acceptance requires strict policy/source-witness/response tests and a genuine
mounted disposable PostgreSQL 17 journey through migration 272. The journey
builds the exact reviewed Part 3 handoff and current Part 4 draft/tax evidence,
then proves owner/admin read, session/role/tenant/query/subscription denials,
deterministic restart, no database residue and zero provider transport. No
migration 273 or rendered surface exists, so browser and visual evidence are not
applicable to Part 7C.

Issued invoice authority, customer token/session, tenant provider connection,
provider checkout, sandbox/private production, legal/provider/security review,
payment events, success, settlement, payout, reconciliation and live money
remain unavailable. Part 7C was accepted at head
`4f7f409e284a77932511d1951740918dfd697db4`, merged as PR #506 to exact main
`85129675ce0c1e13065255ef2dc85cc862963540`, and released through deployment
`5e56eb5e-0fbc-4f46-b82e-7620641b34f0` with migration 272 latest and health,
root and demo HTTP 200. Part 7D is the current candidate; Parts 8–14 remain
unstarted. Live-money validation stays deferred until the first real paying
customer, and founder visual approval remains separate.
