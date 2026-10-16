# Mission 27 Part 11D — accounting boundary and complete Part 11 acceptance

Status: implementation candidate for original Part 11D. Released Parts
[11A](MISSION_27_PART11A_ACCOUNTING_EXPORT_CONTRACT.md),
[11B](MISSION_27_PART11B_ACCOUNTING_EXPORT_READINESS.md), and
[11C](MISSION_27_PART11C_ACCOUNTING_RECONCILIATION_READINESS.md) remain the
provider-neutral, value-free export and reconciliation authority. This slice
adds one atomic private paid read, one isolated fictional-demo read, strict
rendered acceptance, and explicit tax/accounting, retention/hold, disconnect
and regrant boundaries. It creates no accounting destination, mapping,
transmission, acknowledgement, external record, reconciliation, journal, tax
fact, retention action, deletion, adapter connection, credential, external
effect, or money movement.

## Atomic value-free Part 11 bundle

`GET /api/v1/customer-financial/editable-estimates/:estimateId/accounting-part11-acceptance`
is a private no-store owner/administrator read with one exact handoff receipt
identity and digest. The repository revalidates the complete released Part 10
bundle before and after deriving the exact released Parts 11A–11C contracts.
The server then returns one `m27-accounting-part11-preview-bundle-v1` response.
Its `m27-accounting-part11-acceptance-v1` contract carries exact source
witnesses for Parts 11A–11C and the same preview and Part 10 witness. Missing,
changed, reordered, malformed, contradictory, leaked, cross-mode, or
cross-revision evidence fails closed rather than mixing sources.

`GET /api/demo/customer-financial/invoice-drafts/:estimateId/part11-acceptance`
returns the same semantics over the isolated deterministic fictional graph.
It never calls a paid route or adopts paid tenant state. Neither read has a
POST, customer or public counterpart. No table or migration is added;
migration 272 remains latest and no 273 exists.

## Tax and accounting boundary

The frozen launch contract remains exact. Provider tax calculation is
disabled. Any tax-bearing financial use still requires the exact current
Mission 24 jurisdiction, basis, rate, amount, currency, rounding version and
decision digest. Nexus and filing authority are unavailable. The configured
accounting adapter remains `quickbooks_online.accounting_export.v1` in sandbox
mode, but no runtime exists. NorthStar and the accounting adapter cannot infer
a chart of accounts, journal classification, tax policy, revenue-recognition
policy, check clearance, filing, or books-close event. Legal, tax, accounting,
provider and security reviews remain unaccepted, so no journal, filing,
recognition or books-close action is authorized.

## Retention, hold, disconnect and regrant

The exact launch policy retains financial records and immutable idempotency
and audit evidence for seven calendar years. Legal, tax, accounting, provider
and security holds suspend otherwise eligible deletion. Missing retention,
hold, source or deletion authority cannot authorize deletion. A hold release
cannot rewrite or backdate a record. Any eventual deletion requires the exact
record, policy, hold and source pins plus the separate
`customer_financial.record.delete` capability. No deletion route exists here.

Adapter connection, disconnect and regrant are separately unavailable. A
disconnect must stop new preview, transmission, acknowledgement and
reconciliation work without rewriting either source or deleting immutable
receipts and audit evidence. Automatic reconnect is forbidden. A prior grant,
credential, destination, mapping or receipt cannot be reused after disconnect.
Regrant requires fresh reviewed owner authority, current recent authentication
and MFA, and the exact tenant, adapter, mode, destination, mapping and reason.
Role alone cannot authorize disconnect or regrant. No lifecycle mutation route
exists here.

## Rendered acceptance and clearing

The mounted invoice review consumes only the atomic Part 11 bundle. Before
rendering, the client validates the complete ordered server-owned contract:
policy, preview and Part 10 witnesses; all three Part 11 source witnesses;
tax/accounting pins and unavailable reviews; retention terms and hold
purposes; adapter lifecycle states and denial semantics; access, privacy,
acceptance and every zero-effect count. It renders the value-free truths
without exposing a tenant, customer, source record, amount, destination,
mapping, request, acknowledgement, external record, hold target, credential,
secret, idempotency key, actor, approver or reviewer identity.

Request rejection, source mismatch, stale mount generation, collapse, demo
reset and delayed response clear preview values, private prices, action
context, and Parts 5, 6, 7, 9, 10 and 11 state and DOM before recovery. Paid
data never falls back to demo, and the fictional demo never calls paid routes.
Keyboard, responsive, forced-color, light/dark and recovery behavior remain
functional acceptance evidence rather than founder visual approval.

## Acceptance and unavailable evidence

Focused contract, repository, route, client and static evidence; a fresh
disposable local PostgreSQL 17 journey through migration 272 with no 273; and
genuine mounted paid/demo Chrome and Playwright WebKit campaigns across the
five frozen layouts are required. Browser evidence must use real session,
CSRF, mounted routes and database state without request or response
interception or prebuilt API payloads and must prove paid/demo isolation,
malformed-contract rejection and recovery, collapse/reopen, reset,
currentness, delayed-response suppression, keyboard/accessibility,
responsive/light-dark states and zero external effects.

Accepted source/export/acknowledgement/external records, an adapter runtime,
current destination/mapping/capability/recent-authentication/MFA/independent
approval/action reason, private production, professional legal/tax/accounting/
provider/security review, production performance/SLA, physical Safari/devices,
hosted CI, disaster restore, first-paying-customer live-money validation and
founder visual approval remain unavailable or separately ungranted. Part 11D
does not begin Part 12, Mission 28 or the later Command Center redesign.
