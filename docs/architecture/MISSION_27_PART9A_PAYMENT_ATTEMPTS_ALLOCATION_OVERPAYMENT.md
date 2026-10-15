# Mission 27 Part 9A — payment attempts, initiated allocation and overpayment readiness

## Frozen authority

Original Part 9A covers multiple and concurrent payment attempts, partial and
multi-invoice allocations that consume the exact launch-approved Part 7C
initiation plan, safe overpayment handling through an explicit unapplied-credit
and refund-review path, and exact race reconciliation when settled money cannot
be refused retroactively. A post-payment allocation can never create authority
for an amount or invoice set that was not accepted at initiation.

The frozen `mission27.launch.v1` policy supports only one exact current USD/card
invoice for its full current balance. Partial provider payments and multi-invoice
provider payments are explicitly unsupported. Part 9A records those limits; it
does not widen them. Each attempt must have a distinct provider identity and
bind the exact accepted plan, invoice version digest, amount, currency,
allocation, scoped customer session, provider checkout and idempotency lineage.
Arrival order is not authority, and duplicate or replay evidence cannot apply an
allocation twice.

If independently authenticated settlement evidence later proves that concurrent
attempts settled, NorthStar cannot pretend that settled money was refused. Only
the amount within the exact accepted current allocation may reduce that invoice.
An amount beyond the accepted current balance cannot reduce another invoice or
become revenue. It must remain an append-only unapplied credit pending an
owner-reviewed original-charge refund request. A refund request is not a
completed refund.

## Value-free readiness boundary

Released Part 7C proves that there is no issued invoice, current customer payment
session, accepted initiation plan, checkout or idempotency receipt. Released
Part 8D proves that there is no accepted payment, capture, settlement, payout or
bank-arrival evidence. Part 9A therefore cannot create an attempt, allocate
money, change an invoice balance, record a credit, create a refund review or
request, call a provider, or claim a financial effect.

`GET /api/v1/customer-financial/editable-estimates/:estimateId/payment-attempt-allocation-overpayment`
is a private no-store owner/administrator readiness read with the exact reviewed
handoff receipt identity and digest. It revalidates the exact released Part 7C
initiation-plan witness and Part 8D settlement/payout witness. It accepts no
caller-authored invoice set, amount, currency, allocation, attempt, payment,
settlement, provider account, overpayment, credit, refund, URL or secret.

The response returns `payment_attempt_evidence_unavailable`, the exact disabled
partial/multi-invoice states, twelve ordered prerequisites, null projections,
false authority and zero row/effect counts. No POST, public, customer or demo
route, provider transport, database table or migration is added.

## Acceptance evidence and unavailable gates

Acceptance requires strict source-witness, launch-shape, attempt, race,
overpayment, privacy, ordered-requirement and no-effect contract tests plus a
mounted fresh disposable PostgreSQL 17 journey through migration 272. The
journey must cover paid owner and administrator reads, unauthenticated/member/
viewer/cross-tenant/query/subscription/method denial, restart determinism,
non-reflection of caller payment and provider identities, no Part 9 residue and
zero provider transport. There is no rendered, public, customer or demo surface,
so browser evidence is not applicable to Part 9A.

Issued invoice/balance, accepted initiation plan, scoped customer session,
provider checkout/account/credential, authenticated attempts/events, payment,
capture, settlement, overpayment, unapplied credit and refund evidence;
partial/multi-invoice launch authority; sandbox/private production;
legal/provider/security/accounting opinions; hosted CI/load; physical
Safari/devices; manual assistive-technology review; disaster restore;
first-paying-customer live-money validation; and founder visual approval remain
unavailable and unclaimed.
