# Mission 27 Part 12B — payment and cash reporting

Status: implementation candidate. Part 12A is released. This slice adds one
tenant-private, read-only, value-free reporting boundary. It does not create a
payment, receipt, bank fact, accounting entry, downstream observation or money
effect.

## Authority

The controlling Part 12B roadmap requires source-backed payment and cash facts.
Provider-authorized, captured, settled, refunded, disputed, reversed and fee
amounts remain separate from accepted offline cash, received checks whose
clearance is unknown, cleared checks, returned checks, offline reversals and
offline corrections. Every aggregate carries its own source coverage and launch
matrix support. Offline evidence never supplies provider settlement or bank
clearance.

Released Parts 8B, 8D, 9D and 9E remain the source-contract authorities:

- Part 8B owns authenticated provider-event normalization.
- Part 8D keeps capture, settlement, provider fee, payout and bank arrival
  separate.
- Part 9D owns accepted cash/check receipt, clearance, return and append-only
  correction meanings.
- Part 9E owns provider outcomes, returned checks, refund settlement, offline
  reversal and reopened-balance meanings.

Part 12B only projects those exact released contracts. It does not accept
caller-authored payment, receipt, bank, provider, amount, currency or identity
inputs.

## Contract

`m27-payment-cash-reporting-v1` freezes thirteen ordered facts:

1. `provider_authorized_amount`
2. `provider_captured_amount`
3. `provider_settled_amount`
4. `provider_refunded_amount`
5. `provider_disputed_amount`
6. `provider_reversed_amount`
7. `provider_fee_amount`
8. `offline_cash_received_amount`
9. `check_clearance_unknown_amount`
10. `check_cleared_amount`
11. `check_returned_amount`
12. `offline_reversed_amount`
13. `offline_correction_amount`

Each fact has one exact source version and digest, incomplete coverage, one
launch-support state, one named authority and a null value/currency. Missing
values never become zero. Incomplete facts cannot be summed, compared or netted.
The report remains `incomplete` until every required accepted source population
and currentness proof exists.

The launch matrix remains Stripe Connect test-mode card/USD for provider facts.
Offline cash and check receipt are supported within the frozen launch bounds.
Check clearance remains disabled and projects the exact
`check_clearance_authority_unavailable` state. Returned-check processing remains
supported but projects `returned_check_authority_unavailable` until an accepted
bank source exists. Offline reversal and correction remain append-only.

## Read boundary

Paid owner/admin sessions may read:

`GET /api/v1/customer-financial/reporting/payment-cash`

The read is private and `no-store`. It accepts no query or body. A bounded
pre-parser path matcher follows the actual case-insensitive Express route,
optional trailing slash and one-or-two slash mount boundary. An exact GET with
any framed body is rejected with one fixed nonreflective response. Every other
method is rejected with one fixed nonreflective method response, with or without
body bytes. Both decisions happen before JSON parsing, auth, throttle, source or
repository access. The shared bounded HTTP policy also limits CORS to GET, so
OPTIONS continues to fixed method denial instead of an automatic widened CORS
response.

The repository validates the exact tenant, actor, owner/admin role and session
shape, reads all four released source contracts before projection, reads them
again after projection and rejects source drift. The boundary exposes no tenant,
customer, invoice, payment, receipt, provider, bank, actor or accounting
identity.

## Deliberately unavailable

The current code has no complete accepted provider or offline source population.
Provider account/runtime, authenticated provider events, capture, settlement,
refund settlement, disputes, reversal, fee disclosure, accepted cash/check
receipts, bank clearance/return evidence, offline reversal/correction records,
private production, hosted CI/load, physical devices, professional review and
first-paying-customer live-money validation remain unavailable. No migration,
table, action route, demo route, public/customer surface, provider transport,
receiver mutation, accounting mutation or live-money effect is added. Part 12D
retains rendered reporting authority and founder visual approval remains a
separate later verdict.
