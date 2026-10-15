# Mission 27 Part 9D — offline cash/check intake readiness

## Frozen authority

Original Part 9D owns reviewed, capability-gated owner/administrator intake for
launch-supported cash and check-received evidence. An accepted append-only
receipt must bind the exact tenant, current issued invoice versions and
collectible balances, one immutable allocation equal to the exact USD receipt
amount, method, human-attested occurrence time, immutable server acceptance
time, actor, bounded evidence or reference, bounded reason, idempotency key,
duplicate disposition and source digest. Review and explicit confirmation
precede acceptance. Corrections append a replacement or reversal and never edit
an accepted record in place.

The frozen `mission27.launch.v1` policy enables cash and check receipt evidence
up to 1,000,000 minor units per receipt. One current human may accept at most
100,000 minor units only with the exact capability, recent-auth/MFA, current
invoice allocation and evidence authority. A larger complete request requires
two different current eligible humans. Dual control cannot repair missing
amount, evidence, allocation, identity, currentness or authority.

Cash and check meanings remain separate. Accepted cash becomes
`offline_received` and reduces only its exact collectible allocation; it never
claims provider authorization, capture, settlement, payout, bank deposit,
accounting acknowledgement, earned revenue or physical return after a reversal.
Accepted check evidence becomes `check_clearance_unknown`, records pending
tender only, changes neither invoice face value nor paid/settled balance, and
blocks duplicate collection for the exact pending allocation. Customer copy is
**check received — clearance unknown**.

The exact ordered state vocabulary is `offline_received`,
`check_clearance_unknown`, `check_cleared`, `check_returned`, and
`offline_reversed`; each remains separately projected. `check_cleared` remains
disabled until an authenticated bank-owned source is separately accepted, so
its current value-free projection is exactly
`check_clearance_authority_unavailable`. Human attestation, free text, a photo
or accounting acknowledgement cannot claim clearance. `check_returned` can
later reopen only the exact pending allocation from one of the two frozen
retained bank-source classes; both are unavailable today. `offline_reversed`
remains a separate append-only correction fact and cannot imply a physical cash
return, provider reversal, or balance mutation. Part 9E owns positive
return/reversal outcome processing.

## Value-free readiness boundary

Released Part 9C binds the exact post-issue correction and payment lineage and
proves that no immutable issued invoice, current collectible balance, accepted
payment or financial mutation authority exists. Part 9D strictly consumes that
witness.

`GET /api/v1/customer-financial/editable-estimates/:estimateId/offline-payment-readiness`
is a private no-store owner/administrator readiness read using one exact handoff
receipt identity and digest. It accepts no caller-authored invoice, allocation,
method, amount, time, actor, evidence, reason, receipt, source digest, bank
source, provider object, URL or secret. Its result is
`issued_invoice_allocation_unavailable`: every identity and financial value is
null or explicitly unavailable, every acceptance/correction/clearance/return and
accounting authority is false, and every receipt, mutation, provider, receiver,
accounting and money-effect count is zero.

No mutation route is exposed while current issued invoices, balances,
capability, recent-auth/MFA, evidence authority and review facts are absent. No
table or migration is added. This does not weaken the enabled launch policy; it
prevents missing prerequisites from becoming a zero amount, free-text receipt,
cleared check, paid invoice or fabricated cash position.

## Acceptance evidence and unavailable gates

Acceptance requires strict launch-policy, source-witness, action-control,
amount, allocation, occurrence/acceptance chronology, evidence/reason,
idempotency/duplicate, exact ordered offline-state vocabulary, cash/check
semantic, typed missing-clearance, clearance/return, correction,
privacy, no-effect, repository, route and static tests plus a mounted fresh
disposable PostgreSQL 17 journey through migration 272. The journey covers paid
owner/administrator reads, authentication, role, tenant, subscription, exact
query and method denial, restart determinism, no residue and zero provider
transport.

There is no rendered, public, customer or demo surface in Part 9D, so browser
evidence is not applicable. Issued invoice versions/current balances, exact
allocation, current capability, recent-auth/MFA, independent approval, human
review, retained evidence, accepted receipt/correction, authenticated bank
clearance/return evidence, provider or accounting effects, private production,
professional opinions, hosted CI/load, physical devices, manual assistive-
technology review, disaster restore, first-paying-customer live-money
validation and founder visual approval remain unavailable and unclaimed.
