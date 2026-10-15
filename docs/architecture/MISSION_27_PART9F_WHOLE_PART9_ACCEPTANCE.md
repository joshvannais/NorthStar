# Mission 27 Part 9F — whole-Part-9 acceptance

## Frozen authority

Original Part 9F owns concurrent payment, refund, dispute and offline-receipt
adversaries; correction and recovery; customer receipts; accounting
compatibility; and independent whole-Part-9 acceptance. It does not create a
payment, receipt, correction, recovery, accounting export, reconciliation,
provider call or money movement.

The released Part 1D launch policy remains controlling. One aggregate may have
one concurrent writer. An effect requires the exact aggregate revision,
request digest and idempotency receipt; a duplicate or replay cannot repeat an
effect, arrival order cannot grant authority, and missing evidence never
becomes zero. Corrections are append-only. A read-only recovery requires the
exact original request and receipt and creates no financial or external
effect. Recovery that could restore either effect requires two different
current eligible humans and cannot exceed the original request.

Customer receipt numbers remain server-assigned immutable
`RCT-{tenant_monotonic_10_digit_sequence}` values. Gaps are allowed, reuse and
annual reset are forbidden, and a check receipt must say exactly
`check received — clearance unknown`. A refund request is not a completed
refund, a dispute does not erase its original payment, and negative balances,
credits, revenue and expense remain separate.

Accounting remains an export-and-acknowledgement boundary through
`quickbooks_online.accounting_export.v1`. Its sandbox runtime is unavailable.
NorthStar cannot invent a chart of accounts, recognition or tax policy, or
bank-clearance evidence. One export is bounded to 1,000 records and
100,000,000 minor units; up to 100 records and 10,000,000 minor units can use
single control only with one exact current minimized fact set and adapter.
Larger in-bounds exports require dual control, and every manual reconciliation
requires dual control. An adapter acknowledgement is evidence, not a human
action.

## Atomic value-free bundle

`GET /api/v1/customer-financial/editable-estimates/:estimateId/payment-part9-acceptance`
is a private no-store paid owner/administrator read with one exact handoff
receipt identity and digest. The repository revalidates the complete released
Part 7 bundle before and after it reads Parts 9A–9E. It strictly validates the
exact Part 9 source contracts and their current lineage before returning one
`m27-payment-part9-preview-bundle-v1` response. A changed or contradictory
source fails closed rather than mixing revisions.

The Part 9 acceptance contract is `m27-payment-part9-acceptance-v1`. It exposes
five exact value-free source witnesses, plus separately typed concurrency,
correction/recovery, customer-receipt, accounting, access and acceptance
boundaries. Every receipt, correction, recovery, export and reconciliation
identity remains unavailable; all durable-row, provider, receiver,
accounting-mutation and live-money counts remain zero. Role alone never grants
a financial action, staff access cannot substitute for scoped customer access,
and paid/demo or tenant crossing is forbidden.

`GET /api/demo/customer-financial/invoice-drafts/:estimateId/part9-acceptance`
returns the same semantic contract over the isolated fictional demo graph. It
never calls a paid route or adopts paid state. No POST, public or customer
receipt route, database table or migration is added.

## Rendered acceptance and clearing

The existing mounted invoice preview consumes only the atomic Part 9 bundle.
Before rendering, the client validates the complete exact ordered server-owned
contract, including every policy identity, source digest, concurrency rule,
recovery rule, receipt rule, accounting bound, access boundary and zero-effect
field. Missing, reordered, renamed, malformed, contradictory or widened data
is rejected.

The rendered paid and demo surfaces show the five value-free source
boundaries, correction/recovery rules, customer receipt semantics and
accounting limits without exposing financial values or consequential controls.
Source mismatch, request rejection, collapse, stale mount generation and
delayed response clear preview values, private prices, Part 5, Part 6, Part 7
and Part 9 state and DOM before recovery. Paid data never falls back to demo.

## Acceptance evidence and unavailable gates

Local candidate evidence includes focused policy, source-lineage, contract,
repository, route, client and static checks; a fresh disposable PostgreSQL 17
journey through migration 272 with no 273; and genuine mounted paid/demo
Chrome and Playwright WebKit campaigns across five layouts. The browser
campaigns use real session, CSRF, routes and database state with zero mocked
responses, request interception, response interception, paid calls from demo,
provider calls, receiver mutations or money movement. They cover exact
contract rejection and recovery, keyboard, responsive light/dark layouts,
currentness, collapse/reopen, demo reset and database-delayed stale-response
suppression.

Independent whole-head audit and release remain pending. Accepted financial
facts, issued customer receipts, scoped public receipt access, accounting
adapter runtime and acknowledgements, provider/accounting effects, sandbox and
private-production evidence, hosted CI/load, physical Safari/devices, manual
assistive-technology review, disaster restore, professional opinions,
first-paying-customer live-money validation and founder visual approval remain
unavailable and unclaimed. Founder visual approval is separate from functional
mounted browser acceptance.
