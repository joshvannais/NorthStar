# Mission 27 acceptance ledger

Canonical roadmap: [Mission 27 — Customer financial lifecycle](MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md).

This ledger tracks all 64 frozen slices. A part is full only when every slice in that part has the required evidence and no unresolved P0-P3 finding. Missing evidence stays explicit; a part row, demo, sandbox run, or local test cannot substitute for a slice row. Natural provider timing, production deployment, live money, and the founder's visual verdict remain separate.

The 64 original rows and their order are unchanged. The additive Polaris quoted-job gates below are mandatory sub-gates of the named original rows; they do not replace or defer any original financial requirement and do not create a parallel slice count.

## Additive Polaris quoted-job acceptance overlay

| Gate | Closes with original slice(s) | Required evidence | Initial status |
| --- | --- | --- | --- |
| Q1 authority and inventory | 1A–1B | Exact Mission 24/22/23/25/27/32 ownership map; complete call/photo/estimate/calculator/proposal/signature/handoff inventory; duplicate and legacy paths quarantined | Released through 1B |
| Q2 threat and launch contract | 1C–1D | Capability matrix and launch choices for sources, files, extraction/provider mode, retention, options, signatures, team actions, handoffs, learning, mobile layouts, and adapter version | Released through 1D |
| Q3 tenant-private identity | 2A–2B | Exact tenant/customer/prospect/location/source/actor identities, minimized snapshots, corrections, no silent customer creation, paid/demo separation | Released through Part 2D |
| Q4 shared editable model | 3A | One canonical estimate/revision/option/line/input/provenance contract and versioned Mission 24/Mission 32 adapter; source/build/config/currentness retained; no parallel estimate | Released |
| Q5 capacity and risk | 3B | Current source-owned advisory reads, missing/conflicting evidence, zero Mission 22 booking/assignment/reservation/dispatch mutation and zero Mission 23 work mutation | Released |
| Q6 mobile edit, options, signature, handoff | 3C | Authorized editing of every required field, multi-option proposal, exact-version signature/acceptance, explicit accepted-estimate-to-work handoff, simple phone workflow | Released with signature and receiving adapters explicitly unavailable |
| Q7 provenance and learning | 3D | Immutable source original versus every human revision, replay/concurrency/currentness protection, minimized same-tenant Mission 25 observations, exact versioned Mission 32 seam | Released through PR #489, exact main `abe247f7c8ee628424aef549dcc3cc4a6a0436a1`, deployment `84e5da38-36a1-4145-91e7-5ad4505d8747`, and migration 267. |
| Q8 invoice separation | 4A–4E | Exact current accepted Mission 24 option only; no quote/invoice revision confusion, cross-run mixing, amount-authority bypass, or missing-as-zero | Part 4A released; Part 4B candidate; Parts 4C–4E planned |
| Q9 customer-safe separation | 6A–6D | Mission 24 proposal/signature boundary and Mission 27 invoice/document/token/portal boundary both remain exact, accessible, private and independently accepted | Planned |
| Q10 downstream isolation | 12C–12D | Purpose-limited same-tenant learning/reporting, provenance/currentness/coverage, no automatic price/schedule/invoice/policy mutation and no cross-tenant training | Planned |
| Q11 integrated paid/demo/security | 14A–14D | Complete paid and resettable fictional demo journeys, all additive denials, zero provider/receiver/operational mutation outside explicit authority | Planned |
| Q12 mobile visual and final audit | 14E–14G | Chrome and Playwright WebKit five-layout state matrix, independent whole-head audit, exact release evidence, founder visual verdict kept separate | Planned |

An additive gate cannot close from a mockup, static page, seeded value, direct database write, dead link, browser arithmetic, caller-provided authority, or a screenshot alone. The underlying original slice and the bound additive gate close together at one accepted and deployed exact head.

| Slice | Acceptance scope | Local implementation | Focused mounted evidence | Independent audit | Immutable head | Production deployment | Live/provider evidence | Founder visual verdict | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1A | Mission authority, exclusions, dependency map, terminology, exact-money rules, sequence | Complete (documentation only) | N/A — no mounted behavior | Accepted; no P0–P3 | `7a16a4fbd833d4695d0dc79289d5e074551d3eea` | PR #478; main `2c2dfd5e25d4c9ee991ee60b2871ae66f948e4ae`; deployment `f0ac5be6-69b2-4fb7-a9eb-662f91b4785e`; migration 259; health/root/demo 200 | N/A | N/A | Released |
| 1B | Exact inventory, quarantine, and misleading-finance-surface suppression | Complete | Focused containment plus Chrome/WebKit desktop/mobile light/dark paid-copy and keyboard checks | Accepted; no P0–P3 | `afa98228b97cc1ad2b9f9aea76c7859f9a432765` | PR #479; main `f3fb7f60dae916c19189b815ed6563965a2a8f2d`; deployment `8f16cf9c-003f-40f8-963a-ac92c1653b3c`; migration 259; PostgreSQL startup and health/root/demo 200 | N/A | Suspended/unavailable | Released |
| 1C | Threat model and action-capability/recent-auth/dual-control matrix | Complete (documentation and static ratification only; zero grants/actions) | Focused static authority/threat/capability/sequence checks | Accepted; no P0–P3 | `54a31eb4f31a0118d8153aefc7a04bd356dd7f70` | PR #480; main `204b40793b72c412a47632af54c323437fe8a40e`; deployment `444c7436-80ab-4a90-9aee-e0f7bcee58ee`; migration 259; PostgreSQL startup and health/root/demo 200 | N/A | N/A | Released |
| 1D | Frozen launch matrix including method-specific offline/check-clearance rules, unsupported states, ledger, and release rules | Complete (versioned policy, architecture record and static ratification only; zero grants/actions) | Focused policy/schema/limits/authority/sequence ratification | Accepted; no P0–P3 | `29a745f79a914924a7d72d542dfb10c46a8af590` | PR #481; main `a85107b68a880dee603270145e9dbb77362afa9d`; deployment `e5add6e7-8222-4e8e-a2b4-0f9fa47661f0`; migration 259; health/root/demo 200 | N/A | Suspended/unavailable | Released |
| 2A | Tenant-private billing identity and immutable document snapshots | Complete: guarded canonical-customer binding, immutable unreviewed origin, action-specific grant, exact replay/currentness, and effect-time entitlement | Accepted focused contract and fresh PostgreSQL install/upgrade/restart/concurrency/replay/conflict/rollback/access evidence | Accepted; no P0–P3 | `729a7dc8d2ca2d72500df51ebc2de88977183373` | PR #482; main `cc1bd643d51fc61883b643e194e3b8c9948c5189`; deployment `3bcf9e6c-b8ce-4b5e-a067-381784d24837`; migration 260; health/root/demo 200 | Live money deferred until first real paying customer | N/A | Released |
| 2B | Reviewed billing contacts, addresses, references, and correction lineage | Complete: guarded owner/admin review, exact provenance/currentness, append-only corrections, minimized history, and no silent customer creation | Accepted focused server contract plus fresh disposable PostgreSQL 17 migration261/authority/currentness/correction/replay/concurrency/cancellation/immutability/restart evidence | Accepted; no P0–P3 | `ad1eb5c366ae29541cd51dcf6f033b8330ff1044` | PR #483; main `de2a71fb0f167bce7b41fa9f74ea1a57a5ec77b7`; deployment `6dd63eec-34a4-488c-b7cd-8cd9b797ebbc`; migration 261; health/root/demo 200 | Live money deferred until first real paying customer; no provider action | N/A | Released |
| 2C | Currency, exact money, numbering, reservation, issue, void, and recovery | Complete: exact USD minor-unit contract, separately versioned owner-reviewed numbering policy, private atomic no-reuse sequences and bounded exact-request recovery | Accepted focused contract and fresh disposable PostgreSQL 17 migration262/authority/idempotency/concurrency/cancellation/grant-race/immutability/restart evidence | Accepted; no P0–P3 | `f1661b26ccda527119b17707eeffab82dfd7615e` | PR #484; main `035b67349baf1a2eca870692a1a9ff4dab818e4c`; deployment `c849cf08-7e88-4d09-a36e-a5cc86c34756`; migration 262; health/root/demo 200 | Live money deferred until first real paying customer; no provider action | N/A | Released |
| 2D | Paid/demo identity journey, privacy, roles, correction, Part 2 acceptance | Complete: server-resolved paid owner/admin journey plus isolated deterministic fictional demo; zero financial, customer, provider, communication, scheduling, work, estimate, or learning mutation | Accepted authority/unit evidence; fresh disposable PostgreSQL 17 migrations through 263 and Parts 2A–2D; Chrome and Playwright WebKit paid/demo five-layout keyboard, forced-colors, correction/review/reset/state-clearing evidence | Accepted; no P0–P3 | `2b8f185f58a8f7975f595863757b78b5dab4cdee` | PR #485; main `d93b8af884625ce461904bbccc29a0f232e7f245`; deployment `8046f472-8abd-4755-b8f2-b7213313175d`; migration 263; health/root/demo 200 | Live money deferred until first real paying customer; no provider calls | Suspended/unavailable | Released |
| 3A | Current Mission 24 commercial/customer/work lineage read | Complete: private paid owner/admin current-lineage read plus canonical editable estimate/revision/option/line/provenance projection and unavailable Mission 32 seam; zero source or receiver mutation | Accepted focused unit/static and disposable PostgreSQL 17 evidence through migration 264 covering real Mission 24 lineage, exact money, grant/currentness races, tenant isolation, RLS and runtime privileges | Accepted; no P0–P3 | `5a1e815f58e4d66f39f216ef1790ab31f3596c0f` | PR #486; main `2269998e122b44c5b777728b777cb42aaa6d5fd4`; deployment `7a857025-8f1d-46aa-a602-a9cad83ef9ec`; migration 264; health/root/demo 200 | Phone/photo/extraction provider runtimes unavailable; zero provider calls; live money deferred | N/A | Released |
| 3B | Current Mission 23 completion/reopening/handoff lineage read | Complete: private current completed-work context joins the exact Part 3A basis to source-owned Mission 23 assignment, execution, evidence, risk advisory and inert reviewed-handoff pins; reopening or source change clears value; compatible combined capacity remains named unavailable; zero scheduling, work, provider, receiver or financial mutation | Accepted focused unit/read-orchestration and disposable PostgreSQL 17 evidence through migration 265 covering actual field/labor/material writers in both fence orders, deterministic reread/restart, rollback, reopening, roles, tenant isolation and zero mutation | Accepted; no P0–P3 | `5fb4638f84ca389043f3b21140be7bc6b0061e63` | PR #487; main `c3ce248efba03d7f3202e799e27b0e6318865445`; deployment `604600ed-524f-42bb-9a4f-51110fe00574`; migration 265 with no 266; health/root/demo 200 | Combined live capacity and private production history unavailable; zero provider calls; live money deferred | N/A | Released |
| 3C | Human source-class billable-work review plus Q6 mobile edit/options/signature/handoff | Complete: exact current final-balance or accepted-deposit human review; milestone remains named unsupported; paid mobile Polaris quote edits every required field against the exact source-owned current Mission 24 issued proposal while signature and work receiving remain value-free | Accepted focused unit/static suites; disposable PostgreSQL 17 through migration 266 using real Mission 24/22/23 sources, database-owned reconstruction, control/replay/currentness/privacy/RLS and owner/member authority; Chrome and Playwright WebKit five-layout keyboard/light-dark/error/recovery and race-clearing evidence | Accepted; no P0–P3 | `6e7f19d1ca93b232e197f5454448b4ae52c025e9` | PR #488; main `686ee0514fbdde9e5ccc873b3ebdfe6ae8aa6735`; deployment `2f1c2df7-6741-4774-94fa-28f7fb736e03`; migration 266 with no 267; health/root/demo 200 | External signature legal review, Mission 23 receiving adapter, phone/photo/extraction providers, private production and live money unavailable; zero provider/receiver/operational/financial mutation | Suspended/unavailable | Released |
| 3D | [Immutable handoff and revision history](../architecture/MISSION_27_PART3D_HANDOFF_AND_REVISION_HISTORY.md) | Complete: immutable reviewed handoff, append-only bounded exact history and inert Mission 25/Mission 32 seams. | Accepted unit/static, disposable PostgreSQL 17 and Chrome/WebKit five-layout evidence. | Accepted; no P0–P3 | `4fcd7d23ff5f6b768e401c77e86ac042f6e8d65a` | PR #489; main `abe247f7c8ee628424aef549dcc3cc4a6a0436a1`; deployment `84e5da38-36a1-4145-91e7-5ad4505d8747`; migration 267; health/root/demo 200 | External receivers, private production and live money unavailable | Suspended/unavailable | Released |
| 4A | [Immutable invoice-draft origin and customer-safe lines](../architecture/MISSION_27_PART4A_INVOICE_DRAFT_ORIGIN.md) | Complete: database-owned reconstruction of one exact-current Part 3 handoff and Mission 24 commercial basis; immutable customer-safe lines reconcile exactly before tax while later financial actions remain unavailable. | Accepted focused authority/static and fresh disposable PostgreSQL 17 evidence through migration 268, including exact source reconstruction, direct-call tampering, owner/admin capability, concurrency/replay/source invalidation, immutability, runtime denial and restart. | Accepted; no P0–P3 | `892d4644daa03c89e280b91ae7273d5ef024b9d0` | PR #490; main `94bb85ab61d8e614268e2ec52d3660607675f42e`; deployment `e1cfc4f0-16a1-4ad5-a883-5922c42d5fbe`; migration 268; health/root/demo 200 | Live money deferred; external/provider/receiver/accounting evidence unavailable and zero external mutation | N/A — Part 4A adds no rendered surface; Part 4E owns browser acceptance | Released |
| 4B | [Append-only wording, grouping and allocation revisions](../architecture/MISSION_27_PART4B_INVOICE_DRAFT_REVISIONS.md) | **Candidate** — owner/admin edits retain every exact Part 4A source line, recalculate exact USD allocations, preserve the accepted Mission 24 subtotal, and append immutable reasoned revisions; approval, tax, number, issue, receivable and downstream actions stay unavailable. | Focused unit/static and fresh disposable PostgreSQL 17 through migration 269: mounted origin-to-revision, wording/group/allocation, exact-total rejection, optimistic concurrency, exact and superseded replay, source staleness, privacy/access, immutability, runtime denial and restart evidence. | Pending | — | No | Live money deferred; external/provider/receiver/accounting evidence unavailable and zero external mutation | N/A — Part 4B adds no rendered surface; Part 4E owns browser acceptance | Independent exact-head audit remains pending. |
| 4C | Typed commercial changes, deposits/payments/credits, exclusions, anti-double-counting | No | No | No | — | No | N/A | No | Planned |
| 4D | Taxable basis, jurisdiction, evidence, rounding, liability, unavailable states | No | No | No | — | No | No | No | Planned |
| 4E | Exact totals, amount due, preview, paid/demo, Part 4 acceptance | No | No | No | — | No | N/A | No | Planned |
| 5A | Capability-gated final review and explicit confirmation | No | No | No | — | No | N/A | No | Planned |
| 5B | Atomic number assignment, immutable issue, uncertain retry | No | No | No | — | No | N/A | No | Planned |
| 5C | Orthogonal lifecycle projections and display precedence | No | No | No | — | No | No | No | Planned |
| 5D | Post-issue credit/debit/replacement/void lineage | No | No | No | — | No | No | No | Planned |
| 5E | Concurrency, correction, reopening, cancellation, replay, ACL, Part 5 acceptance | No | No | No | — | No | No | N/A | Planned |
| 6A | Customer-safe accessible immutable invoice HTML/PDF | No | No | No | — | No | N/A | No | Planned |
| 6B | Hashed scoped public token, privacy, cache, bearer limitations | No | No | No | — | No | N/A | No | Planned |
| 6C | Customer view/download/question/correction-request and protected mutations | No | No | No | — | No | N/A | No | Planned |
| 6D | Explicit delivery/resend/revoke/recovery, Mission 28 handoff, Part 6 acceptance | No | No | No | — | No | No | No | Planned |
| 7A | Merchant/funds model and provider-neutral account/mode/method contract | No | No | No | — | No | No | N/A | Planned |
| 7B | Capability-gated hosted onboarding, secrets, rotation, disconnect, no instrument storage | No | No | No | — | No | No | No | Planned |
| 7C | Authorized exact-balance or launch-enabled partial/multi-invoice payment initiation plan | No | No | No | — | No | No | No | Planned |
| 7D | Disabled-by-default sandbox, drift, rollback, unsupported methods, Part 7 acceptance | No | No | No | — | No | No | No | Planned |
| 8A | Authenticated provider-event receipt, mode/account checks, replay safety | No | No | No | — | No | No | N/A | Planned |
| 8B | Deterministic out-of-order event normalization | No | No | No | — | No | No | N/A | Planned |
| 8C | Exact allocation and balance projection with fail-closed mismatch handling | No | No | No | — | No | No | No | Planned |
| 8D | Settlement and payout reconciliation kept separate from capture | No | No | No | — | No | No | No | Planned |
| 8E | Delay/correction/concurrency/recovery/raw-event ACL, Part 8 acceptance | No | No | No | — | No | No | N/A | Planned |
| 9A | Concurrent attempts and exact initiated partial/multi-invoice allocation, overpayment recovery | No | No | No | — | No | No | No | Planned |
| 9B | Launch-approved deposit application and milestone unsupported boundary | No | No | No | — | No | No | No | Planned |
| 9C | Capability-gated credit note and refund request/acknowledgement | No | No | No | — | No | No | No | Planned |
| 9D | Reviewed offline cash/check intake, accepted-at/occurred-at, clearance states, allocation/evidence, idempotency, correction | No | No | No | — | No | No if enabled; documented N/A if disabled | No | Planned |
| 9E | Failures, NSF, disputes/outcomes/fees, reversal, write-off, reopened balance | No | No | No | — | No | No | No | Planned |
| 9F | Concurrent adversaries, correction/recovery, receipts, accounting, Part 9 acceptance | No | No | No | — | No | No | No | Planned |
| 10A | Complete/incomplete current receivable population and aging | No | No | No | — | No | N/A | No | Planned |
| 10B | Capability-gated human collection review and promise-to-pay | No | No | No | — | No | N/A | No | Planned |
| 10C | Reviewed Mission 28 reminder handoff or ratified manual resend | No | No | No | — | No | No | No | Planned |
| 10D | Failure/retry/revocation/privacy/paid-demo UI, Part 10 acceptance | No | No | No | — | No | No | No | Planned |
| 11A | Export contract including approved offline evidence and all lifecycle facts | No | No | No | — | No | No | N/A | Planned |
| 11B | Selected destination, mapping, preview, idempotent transfer, acknowledgement | No | No | No | — | No | No | No | Planned |
| 11C | Bidirectional matched/unmatched/conflicting/corrected reconciliation | No | No | No | — | No | No | No | Planned |
| 11D | Tax/accounting boundary, holds, disconnect/regrant, UI, Part 11 acceptance | No | No | No | — | No | No | No | Planned |
| 12A | Source-backed invoice/receivable facts with coverage indicators | No | No | No | — | No | N/A | No | Planned |
| 12B | Source-backed provider and offline receipt/clearance/return/correction facts with coverage | No | No | No | — | No | No if offline enabled | No | Planned |
| 12C | Minimized Mission 25/26/33 readers and correction propagation | No | No | No | — | No | N/A | N/A | Planned |
| 12D | Command Center reporting and legacy-fallback removal, Part 12 acceptance | No | No | No | — | No | N/A | No | Planned |
| 13A | Full account health, capability drift, secret/webhook rotation, incident disablement | No | No | No | — | No | No | N/A | Planned |
| 13B | Checkpoints, replay windows, retention/deletion/holds, cleanup/tombstones | No | No | No | — | No | No | N/A | Planned |
| 13C | Migration/restart/failover/outage/queue/recovery/observability/runbooks | No | No | No | — | No | No | N/A | Planned |
| 13D | Capacity, abuse, security, restore, Part 13 acceptance | No | No | No | — | No | No | N/A | Planned |
| 14A | Complete paid-tenant production/provider-disabled journey, including offline receipt path when enabled | No | No | No | — | No | No if offline enabled | No | Planned |
| 14B | Complete resettable isolated fictional demo journey | No | No | No | — | No | N/A | No | Planned |
| 14C | Integrated migration/replay/correction/refund/offline-return/retention/delete/restore journey | No | No | No | — | No | No if offline enabled | N/A | Planned |
| 14D | Integrated tenant/role/CSRF/link/webhook/account/PII/amount/offline-evidence/abuse security | No | No | No | — | No | No if offline enabled | N/A | Planned |
| 14E | Performance, observability, accessibility, responsive/theme/state visual matrix | No | No | No | — | No | N/A | No | Planned |
| 14F | Independent exact-head authority/privacy/security/accounting/provider full audit | No | No | No | — | No | No | N/A | Planned |
| 14G | Backup, reviewed merge, sole deploy, health, named verdict, ledger, founder verdict | No | No | No | — | No | No | No | Planned |

## Named mission verdicts

| Verdict | Required state | Status |
| --- | --- | --- |
| Full local | Every required slice has local implementation, focused mounted evidence, immutable head, and clean independent audit | Not achieved |
| Production deployed / provider disabled | Full local plus reviewed migrations/deployment/health and rendered paid/demo verification with live capability off | Not achieved |
| Provider-sandbox accepted | Production-deployed code plus exact sandbox account/method/webhook/payment/refund/reconciliation evidence | Not achieved |
| Live-payment accepted | Separately authorized controlled live canary proves account, method, webhook, settlement/payout, refund, and reconciliation | Not achieved |
| Mission complete | Every launch-matrix-required slice and mission-wide gate, required provider/live verdict, and founder visual verdict are complete | Not achieved |

## Mission-wide non-waivable gates

| Gate | Required evidence | Current state |
| --- | --- | --- |
| Authority | Exact Mission 20/22/23/24/25/26/28 boundaries; no legacy, demo, or subscription-billing substitution | Slices 1A–1D, whole Parts 2 and 3, and Part 4A released; Part 4B candidate appends exact-total-preserving invoice-draft edits and creates no provider request, schedule, work, invoice, receivable, payment, communication or learning mutation |
| Launch matrix | Merchant/funds model, provider/mode/methods, geography/currency/tax, accounting, retention, refund/dispute, offline/deposit scope and exclusions frozen in 1D | Slice 1D policy and static ratification released; provider, money, invoice, payment and later runtime implementations remain unavailable |
| Tenant and role isolation | Tenant-composite relationships, action capabilities, current session/recent-auth checks, minimized runtime grants, direct-table denial | Slice 1C contract, Slice 1D policy, whole Parts 2 and 3, and Part 4A released; Part 4B candidate reuses the exact owner/admin invoice-draft grant and withholds immutable revision tables and private helpers from runtime |
| Human control | Explicit reviewed issue, send, void, refund, write-off, reconcile/export, and collection actions; no completion-triggered invoice | Slices 1C–1D released; runtime financial-action authority remains pending |
| Money integrity | Exact currency arithmetic, bounded amounts, complete reconciliation, no missing-as-zero, silent FX, or price-authority bypass | Part 2C exact money and Part 4A source composition released; Part 4B candidate server-recalculates every bounded allocation and refuses any subtotal different from the exact accepted Mission 24 total |
| Immutability and replay | Append-only issued documents/events, exact idempotency, uncertain-result recovery, no duplicate invoice/charge/refund | Part 2C numbering and Part 4A origins released; Part 4B candidate appends chained immutable revisions with exact latest-only replay while issued document/payment/refund receipts remain assigned later |
| Provider authenticity | Account/mode/tenant/capability checks, signatures, uniqueness, out-of-order handling, minimized secrets | Planned |
| Cash truth | Authorization, capture, settlement, payout, refund, dispute, reversal, and accounting acknowledgement remain distinct | Planned |
| Customer privacy | Hashed scoped tokens, bounded public data, revocation, recipient policy, rate limits, no secret/private leakage | Planned |
| Tax boundary | Exact taxable-basis and adjustment arithmetic, jurisdiction/evidence snapshots, typed unsupported states, professional review | Planned |
| Correction and lifecycle | Reopening, source correction, void, credit, refund, dispute, disconnect, retention, deletion, and hold propagation | Planned |
| Demo isolation | No paid tenant, live credential, provider object, money, customer link, or record crosses demo boundary | Planned |
| Downstream compatibility | Exact minimized readers for Missions 25/26/33; no earned-revenue or forecast claim by inference | Planned |
| Recovery and rollout | Minimum provider controls precede enablement; bounded migrations, startup, locks, retries, queues, rollback, restore, health | Planned |
| UX and accessibility | Complete paid/demo journeys, desktop/mobile, keyboard, theme, loading/empty/error/recovery, five-layout review | Planned |
| Release | Fresh backup, reviewed PR, sole automatic deploy, migration/health, exact named verdict, final source-linked ledger | Planned |

## Evidence labels

- **Local implementation** means the exact code exists in a clean checkout and relevant static and focused tests pass.
- **Focused mounted evidence** means the relevant production modules are mounted against disposable PostgreSQL where applicable, with a deterministic provider simulator or separately authorized provider sandbox only at the named boundary. Static/unit tests are supplementary; every `N/A` records an exact reason and cannot hide a missing mountable boundary.
- **Independent audit** means a read-only clean exact-head review by an agent that did not write that head.
- **Immutable head** is the exact commit containing the accepted slice evidence.
- **Production deployment** means the reviewed commit is active after the sole automatic deployment and migration/health verification.
- **Live/provider evidence** states the exact sandbox or live account, mode, method, webhook, settlement/refund/reconciliation boundary proven; `N/A` requires a documented reason.
- **Founder visual verdict** is separate from functional and audit evidence.
- **Status** is `Planned`, `Open`, `Bounded`, `Full local`, `Production deployed`, or a named higher verdict; it never advances by implication.
