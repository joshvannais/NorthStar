# Mission 27 Part 9E — payment outcomes and reopened-balance readiness

## Frozen authority

Original Part 9E keeps payment failure, cancellation, returned offline payment,
NSF fee, dispute deadline, dispute fee, dispute won/lost outcome, chargeback,
provider reversal, offline reversal, refund settlement, bad-debt/write-off
review and reopened-balance projection as separate append-only facts or exact
launch-matrix unsupported states. None can be inferred from another axis, event
arrival order, a role label, free text, a provider acknowledgement or a missing
amount represented as zero.

Provider outcomes require authenticated normalized provider evidence bound to
the exact tenant, provider account, mode and object, occurrence sequence,
current snapshot, duplicate/replay disposition and correction lineage. The
normalized outcome vocabulary is `failed`, `canceled` and `reversed`; dispute
outcome remains separately typed as `dispute_won` or `dispute_lost`. Failure or
cancellation does not authorize an automatic retry. A dispute never erases the
original payment and cannot automatically submit evidence, concede, refund,
write off, contact the customer, change tax or recognize revenue.

Released Part 9D keeps check clearance, returned check and offline correction
meanings separate. `check_returned` requires one accepted bank-source class and
may reopen only the exact pending allocation. Both frozen source classes remain
unavailable, so the current state is exactly
`returned_check_authority_unavailable`. NSF fees remain exactly
`nsf_fee_unsupported`. `offline_reversed` is append-only bookkeeping and cannot
claim a physical cash return, provider reversal or money movement.

A refund request or provider acknowledgement is not refund settlement.
Settlement requires the exact original settled card charge and allocation,
current refundable remainder and authenticated provider settlement evidence.
A write-off requires the exact current balance component, USD amount, immutable
reason, `customer_financial.write_off.record`, recent authentication and MFA,
fresh review and an append-only receipt. At most 50,000 minor units can use one
current human; more than 50,000 through 1,000,000 requires two different current
eligible humans. A write-off does not move provider or offline money and cannot
change tax or revenue-recognition policy.

## Value-free readiness boundary

Released Part 9D proves there is no accepted offline receipt, returned-check
source, issued invoice, current balance, accepted provider outcome, refund
settlement or write-off authority. Part 9E strictly consumes that exact witness.

`GET /api/v1/customer-financial/editable-estimates/:estimateId/payment-outcome-readiness`
is a private no-store paid owner/administrator read using one exact handoff
receipt identity and digest. It accepts no caller-authored invoice, payment,
allocation, provider account, provider event, outcome, fee, return code,
dispute, refund, write-off, balance, URL, payload or secret. The response keeps
all thirteen outcome axes separately named and value-free. Every identity,
timestamp and amount is null; every acceptance, balance, provider, customer,
accounting, tax and revenue authority is false; every durable-row, provider,
receiver, accounting and live-money count is zero.

No mutation route, outcome table or migration is added. This does not weaken
the frozen launch policy. It prevents missing outcome evidence from becoming a
retry, fee, returned check, won/lost dispute, reversal, settled refund,
write-off, reopened balance, customer communication or accounting effect.

## Acceptance evidence and unavailable gates

Acceptance requires strict source-witness, launch-policy, exact ordered-axis,
provider outcome, dispute won/lost, offline return/reversal, unsupported fee,
refund settlement, write-off control, reopened-balance, privacy, no-effect,
repository, route and static tests plus a mounted fresh disposable PostgreSQL
17 journey through migration 272. The journey covers paid owner/administrator,
authentication, role, tenant, subscription, exact-query and method denial,
malformed or contradictory contract rejection, restart determinism, no residue
and zero provider transport.

There is no rendered, public, customer or demo surface in Part 9E, so browser
evidence is not applicable. Issued invoice and balance, accepted payment or
offline receipt, authenticated provider event, returned-check source, dispute
deadline/fee/outcome, refund settlement, current capability, recent-auth/MFA,
independent approval, accepted write-off or reopened-balance evidence,
provider/accounting effects, sandbox/private production, professional opinions,
hosted CI/load, physical devices, manual assistive-technology review, disaster
restore, first-paying-customer live-money validation and founder visual approval
remain unavailable and unclaimed. Part 9F separately owns concurrent
adversaries, correction/recovery, customer receipts, accounting compatibility
and whole-Part-9 acceptance.
