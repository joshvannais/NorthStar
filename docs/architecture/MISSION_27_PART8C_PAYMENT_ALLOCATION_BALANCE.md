# Mission 27 Part 8C — exact payment allocation and balance readiness

## Frozen authority

Original Part 8C owns exact invoice allocation and balance projection from
accepted current payment evidence. A projection requires one exact current
issued invoice, the immutable current payment-initiation plan, authenticated and
normalized provider evidence, exact tenant/account/mode and payment-object
identity, exact invoice/amount/currency/digest equality, duplicate disposition,
the exact provider-session and idempotency lineage, and the current unapplied
invoice-balance revision. A duplicate, replay, stale plan, wrong tenant,
provider account, mode, invoice, currency or amount, or an unmatched event must
fail closed without changing a balance.

The launch contract supports one USD/card invoice only. Partial and
multi-invoice provider payments remain disabled, the amount must equal the
allocation total, an allocation cannot exceed the current balance, and missing
money never becomes zero. The browser return cannot mark an invoice paid.
Payment success, capture, settlement, payout, accounting acknowledgement and
earned-revenue recognition remain separate facts. Manual matching, mismatch
resolution, settlement override and allocation override require dual control;
provider evidence is not a human action and cannot bypass that control.

## Value-free invoice-bound projection

Released Part 7C proves there is no issued invoice, scoped customer session,
provider checkout, amount, allocation or payment-session identity. Released
Part 8B proves there is no authenticated provider receipt, normalized current
payment state, event/object identity, occurrence time, sequence or replay
disposition. Part 8C therefore cannot allocate a payment, project a numeric
balance, persist an allocation row, call a provider or claim that an invoice is
paid.

`GET /api/v1/customer-financial/editable-estimates/:estimateId/payment-allocation-balance`
is a private no-store owner/administrator read with the exact reviewed handoff
receipt identity and digest. It revalidates the complete released Part 7C
invoice source and consumes the exact released Part 8B normalization witness.
It accepts no caller-authored invoice, amount, currency, allocation, provider
account, provider event/payment identity, mode, session, URL or secret.

The response freezes the exact ordered matching, allocation, balance and
dual-control rules while returning
`accepted_payment_evidence_unavailable`. Every invoice identity, balance,
payment amount, allocation, provider identity and projection revision/digest is
null; duplicate disposition and all exact-match facts remain unavailable. All
allocation, balance, payment, capture, settlement, payout, accounting and
revenue effects remain false or zero. No POST, public, customer or demo route,
provider transport, database table or migration is added.

## Acceptance evidence and unavailable gates

Acceptance requires strict source-witness, ordered-requirement, exact-arithmetic,
mismatch, privacy and no-effect contract tests plus a mounted fresh disposable
PostgreSQL 17 journey through migration 272. The journey must cover paid owner
and administrator reads, unauthenticated/member/viewer/cross-tenant/query/
subscription/method denial, restart determinism, non-reflection of caller money
and provider identities, no Part 8 residue and zero provider transport. There is
no rendered, public, customer or demo surface, so browser evidence is not
applicable to Part 8C.

Issued invoice and balance authority, customer session, provider account,
credential, adapter, checkout, authenticated event receipt, positive
normalization, payment success/capture, settlement, payout, accounting,
provider sandbox/private production, legal/provider/security opinions, hosted
CI/load, physical Safari/devices, manual assistive-technology review, disaster
restore, first-paying-customer live-money validation and founder visual approval
remain unavailable and unclaimed.
