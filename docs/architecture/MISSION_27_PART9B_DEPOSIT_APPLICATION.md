# Mission 27 Part 9B — deposit application readiness

## Frozen authority

Original Part 9B covers launch-matrix-approved deposit application with exact
Mission 24 schedule lineage and no double counting in the final balance. The
frozen `mission27.launch.v1` policy permits only a separately invoiced pre-work
deposit that uses the exact current accepted Mission 24 deposit schedule, has an
explicit capability-authorized human review, does not exceed the lesser of 50%
or 2,500,000 USD minor units, and makes no job-completion claim.

A deposit schedule is not a payment receipt. A completion record cannot
substitute for accepted payment evidence. Applying a deposit requires the exact
separate deposit invoice, an accepted native payment receipt bound to that
invoice and schedule, exact currency and amount, duplicate/race disposition,
and an exactly-once application identity. The final invoice may subtract that
accepted applied deposit once and may never count it twice or infer a missing
receipt, amount, or balance as zero.

Progress and milestone application remain unsupported because the frozen policy
has no separately accepted Mission 23 work-package source. Deposit, invoice,
payment, or completion state cannot decide earned revenue.

## Value-free readiness boundary

Released Part 4A provides the only exact reviewed invoice-origin witness and
released Part 9A provides the current duplicate, race, allocation, and
overpayment readiness witness. Part 9B consumes and strictly revalidates both.
It recognizes a current reviewed deposit schedule only when the Part 4A origin
is current, contains exactly one `mission24_accepted_deposit` line, uses the
`accepted_deposit` unit, and its exact amount is positive and within the frozen
2,500,000-minor-unit ceiling. A final-balance origin is not a deposit schedule.
No source identity or amount is returned.

`GET /api/v1/customer-financial/editable-estimates/:estimateId/deposit-application`
is a private no-store owner/administrator readiness read using the exact
reviewed handoff receipt identity and digest. It accepts no caller-authored
schedule, invoice, amount, payment, allocation, balance, provider identity,
receipt, URL, or secret. The response remains
`deposit_payment_evidence_unavailable`: every application and final-balance
projection is null, every financial authority is false, and every row,
provider, receiver, accounting, and money-effect count is zero. No POST,
public, customer, demo, provider transport, table, or migration is added.

## Acceptance evidence and unavailable gates

Acceptance requires strict launch-policy, Mission 24 origin, Part 9A witness,
deposit-line/bounds, ordered-prerequisite, privacy, no-double-counting,
no-effect, repository, route, and static tests plus a mounted fresh disposable
PostgreSQL 17 journey through migration 272. The journey covers paid owner and
administrator reads, auth/role/tenant/subscription/query/method denial,
restart determinism, no residue, and zero provider transport. There is no
rendered, public, customer, or demo surface, so browser evidence is not
applicable.

An issued deposit invoice, accepted native deposit payment receipt, exactly-once
application identity, final-balance carry-forward witness, accepted Mission 23
milestone/work-package source, provider account/credential/events, sandbox or
private production, professional opinions, hosted CI/load, physical devices,
manual assistive-technology review, disaster restore, first-paying-customer
live-money validation, and founder visual approval remain unavailable and
unclaimed.
