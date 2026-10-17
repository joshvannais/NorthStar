# Mission 27 Part 12D — reporting surfaces, downstream boundary and complete Part 12 acceptance

Status: implementation candidate for original Part 12D. Released Parts
[12A](MISSION_27_PART12A_INVOICE_RECEIVABLE_REPORTING.md),
[12B](MISSION_27_PART12B_PAYMENT_CASH_REPORTING.md), and
[12C](MISSION_27_PART12C_DOWNSTREAM_REPORTING_READERS.md) remain the exact,
coverage-aware and value-free reporting authority. This slice adds one atomic
private paid read, one isolated fictional-demo read, complete Command Center
and customer-finance rendering, strict legacy-zero fallback removal and whole
Part 12 functional acceptance. It creates no financial fact, reporting row,
learning observation, forecast, platform fact, provider or receiver action,
accounting entry, downstream mutation or money movement.

## Atomic value-free Part 12 bundle

`GET /api/v1/customer-financial/editable-estimates/:estimateId/reporting-part12-acceptance`
is a private no-store owner/administrator read with the exact current Part 11
handoff receipt identity and digest. The repository reads the complete released
Part 11 bundle and the exact Parts 12A–12C sources before and after projection.
Every source must remain byte-for-byte current. The server validates the full
released source contract and returns one
`m27-reporting-part12-preview-bundle-v1` response. Its
`m27-reporting-part12-acceptance-v1` contract carries the exact Part 11 witness,
ordered Parts 12A–12C source digests, reporting surfaces, drilldowns,
downstream-purpose boundary, access, privacy and zero-effect evidence.

`GET /api/demo/customer-financial/invoice-drafts/:estimateId/part12-acceptance`
returns identical semantics over the isolated deterministic fictional graph.
It never calls a paid route or adopts paid tenant state. Neither read has a
POST, customer or public counterpart. The shared pre-parser boundary owns all
method and body composition before CORS, JSON parsing, authentication,
throttling or repository access. Unsupported methods and body-bearing GETs
return fixed private non-reflective responses. No table or migration is added;
migration 272 remains latest and no 273 exists.

## Coverage-aware surfaces and drilldowns

Command Center and customer-finance surfaces render only exact server-owned
Part 12 facts. The ordered invoice/receivable, payment/cash and downstream
reader drilldowns retain incomplete or unavailable state, reason, required fact
count and zero available fact count. Values and currencies remain `null`.
Partial coverage cannot appear complete, and missing, unknown or unavailable
evidence cannot become zero. The browser performs no financial arithmetic and
has no legacy zero fallback. An invoice cannot imply earned revenue. Provider
or offline intent cannot imply collected cash. Forecasts cannot be presented as
historical facts.

## Purpose-limited downstream evidence

Mission 25 may eventually consume only exact same-tenant accepted observations
under current purpose permission. It cannot automatically change a price,
option, estimate, schedule, invoice or policy and cannot train across tenants.
Mission 26 requires separately accepted source-complete history and calibration
before a collection forecast exists; no forecast is emitted here. Mission 33
may consume only platform-level facts under its own authority and may not
inspect tenant detail. No downstream reader can rewrite source evidence or
apply a value automatically.

## Strict rendered acceptance and clearing

Before rendering, the client validates every semantic and structural leaf of
the server-owned Part 12 contract, the exact Part 11 digest and the immutable
Parts 12A–12C source digests. Wrong, missing, malformed, duplicate, reordered,
renamed, contradictory, jointly forged, leaked, cross-mode or cross-revision
evidence fails closed. The mounted review then shows the exact value-free source
states, surface coverage, drilldowns and downstream restrictions without
inventing amounts or exposing identities, provider/bank details or private
financial evidence.

Request rejection, source mismatch, stale generation, collapse, demo reset and
delayed response clear preview values, private prices, action context and Parts
5, 6, 7, 9, 10, 11 and 12 state and DOM before recovery. Paid data never falls
back to demo, and demo never calls a paid route. Keyboard, responsive,
forced-color, light/dark and recovery behavior are functional acceptance
evidence; founder visual approval remains separate and ungranted.

## Acceptance and unavailable evidence

Acceptance requires exhaustive table-driven contract and composed HTTP-policy
matrices; focused unit/static evidence; a fresh disposable local PostgreSQL 17
journey through migration 272 with no 273; and genuine mounted paid/demo Chrome
and Playwright WebKit campaigns across the five frozen layouts using real
session, CSRF, routes and database state with no interception or shortcut.

Complete issued-invoice/receivable and payment/cash source populations,
provider runtime/events/capture/settlement/refund/dispute/reversal/fee evidence,
accepted offline receipts and bank clearance/return authority, Mission 25
purpose permission and accepted observations, Mission 26 source-complete
history and calibration, Mission 33 platform authority, private production,
professional review, production performance/SLA, hosted CI/load, physical
Safari/devices, manual assistive-technology review, disaster restore,
first-paying-customer live-money validation, independent whole-head audit and
founder visual approval remain unavailable or separately ungranted. Part 12D
does not begin Part 13, Mission 28 or the later Command Center redesign.
