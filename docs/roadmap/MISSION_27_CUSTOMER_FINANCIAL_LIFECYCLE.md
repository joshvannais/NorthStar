# Mission 27 — Customer financial lifecycle

Status: frozen plan released. The plan was accepted at head `9d83ff2f9ca276e0b38c2f80c322ea715c02aa6b`, merged through PR #477 as exact main `637b7db4a9e1b2b82520824a2f94b3f0b139b191`, and released by automatic Railway deployment `93b56103-9e7c-45b5-8df9-24055f6c0c2c` with migrations through 259 and startup, `/api/health`, `/`, and `/demo/` HTTP 200. Original Slice 1A is now a documentation-only implementation candidate; independent exact-head audit and its normal release lane remain pending.

Plan provenance: the complete original 14-part, 64-slice financial lifecycle and ledger were recovered from preserved exact plan head `cac1cd3ffa3d9b771285b7a5ba9b468958c26ff6`. All original slice identities and order remain; the only original-row change strengthens the final audit bar from P0–P2 to P0–P3. The quoted-job requirements are additive gates.

Objective: give each NorthStar business a trustworthy, tenant-private path from an exact launch-approved billable source to an invoice, customer payment, collection follow-up, refund or dispute record, and accounting handoff without turning operational completion, provider messages, estimates, or predictions into financial truth. A final balance requires accepted commercial terms plus current completion evidence; a launch-approved pre-work deposit requires exact accepted commercial deposit terms and makes no completion claim. The mission also adds a fast mobile workflow that turns authorized phone-call and photo facts into a fully editable Polaris quoted-job draft while preserving Mission 24 as the commercial authority and every original financial-lifecycle requirement below.

Mission 27 owns the native customer financial lifecycle: invoices, customer-facing balances, payment evidence, collections, credits, refunds, disputes, settlement reconciliation, receipts, and accounting handoff. It does not replace Mission 24 customer-price authority, Mission 23 field-execution authority, Mission 25 external-source learning, Mission 26 predictions, Mission 28 automation, or a licensed accounting or tax professional's policy.

## Frozen implementation structure — 14 parts, 64 slices

The fourteen-part structure and the slice order below are frozen before implementation begins. A later change requires a documented authority or acceptance reason, the affected gates, and an updated slice total before work continues. Work is serialized in this order unless the founder explicitly changes it.

| Part | Scope | Slices | Initial status |
| --- | --- | ---: | --- |
| 1 | Mission authority, source inventory, threat model, and acceptance contract | 4 | Planned |
| 2 | Financial parties, billing identity, currency, and document numbering authority | 4 | Planned |
| 3 | Explicit billable-work handoff from the exact launch-approved commercial and operational source class | 4 | Planned |
| 4 | Invoice draft composition, taxes, deposits, credits, and amount reconciliation | 5 | Planned |
| 5 | Human approval, immutable issue, correction, void, and lifecycle state | 5 | Planned |
| 6 | Customer delivery, secure portal, documents, questions, and acknowledgements | 4 | Planned |
| 7 | Payment-provider boundary, payment initiation, and credential isolation | 4 | Planned |
| 8 | Provider events, payment success, settlement, and cash reconciliation | 5 | Planned |
| 9 | Partial payments, deposits, credits, refunds, failures, disputes, and reversals | 6 | Planned |
| 10 | Accounts-receivable aging and human-controlled collection workflow | 4 | Planned |
| 11 | Accounting and tax handoff, export, acknowledgement, and reconciliation | 4 | Planned |
| 12 | Financial reporting and exact downstream evidence for Missions 25, 26, and 33 | 4 | Planned |
| 13 | Provider lifecycle, observability, retention, deletion, recovery, and operational controls | 4 | Planned |
| 14 | Complete paid/demo journeys, migration proof, accessibility, independent audit, and release | 7 | Planned |

The original 14 parts and 64 slices remain intact and in their original order. The additive Polaris quoted-job workflow is a mandatory acceptance overlay on named original slices, not a replacement part, a second estimate system, or permission to delay or remove invoice, payment, settlement, refund, dispute, receivable, accounting, provider-lifecycle, or final-acceptance work. Every original slice closes only when both its original scope and any overlay gate assigned below are accepted.

## Frozen additive Polaris quoted-job workflow

The product target is most of the speed and simplicity of the reviewed SimplyWise-inspired reference workflow while retaining NorthStar's authority, evidence, privacy, and exact-money rules. An authorized user can begin with phone-call-derived or mobile-photo-derived job facts, inspect their source, correct every scope, quantity, line item, price, assumption, and option, and produce one or more customer-safe proposal options. Nothing extracted, suggested, calculated, signed, or accepted becomes a price, booking, dispatch, billable-work decision, invoice, or payment by implication.

Mission 27 establishes one shared canonical editable Polaris estimate and line-item contract, its source/provenance contract, immutable original-versus-human revision history, and a versioned adapter seam. Mission 24 remains the canonical estimate, customer-quote, approved-price, option, customer-acceptance, and commercial-revision authority. Mission 22 remains the only scheduling, assignment, reservation, and dispatch authority. Mission 23 remains execution and work-evidence authority. Mission 25 owns tenant-private learning. Mission 32 later adds deeper field quantities, labor, material, assembly, production, equipment, scenario, and execution-plan mathematics through the same record and adapter; it cannot create a parallel estimate, duplicate a calculation already owned by an accepted engine, or silently rewrite an accepted revision.

### Additive gates bound to original slices

| Original slice | Mandatory additive gate; original scope remains required |
| --- | --- |
| 1A | Ratify the Mission 24/22/23/25/27/32 boundary, shared editable-record vocabulary, option/signature meanings, and the rule that extraction, navigation, proposal creation, recommendation, or signature capture never supplies authority owned by another mission. |
| 1B | Inventory every current call fact, transcript-derived fact, image/file fact, estimate/quote/line-item store, calculator, proposal, signature, lead/job conversion, permission, learning, and risk/capacity surface. Classify its authority and quarantine legacy, demo-only, duplicated, or provider-dependent paths. |
| 1C | Extend the threat and capability matrix to source spoofing, malicious files, hidden instruction content, tenant crossing, stale extraction, unsafe image metadata, amount tampering, unauthorized edits/options/signatures/conversion, revision loss, cross-tenant learning, and adapter confusion. |
| 1D | Freeze supported phone/photo source classes, file limits and retention, extraction/provider mode, option and signature policy, team capabilities, mobile support matrix, accepted-to-work handoff, learning inputs, capacity/risk sources, and Mission 32 adapter version. Unsupported sources or missing evidence remain named and value-free. |
| 2A–2B | Bind every draft and proposal to exact tenant-private customer/prospect, location, contact, source, and actor identities with minimized immutable snapshots and correction lineage; do not silently create a customer from an intake. |
| 3A | Mount the shared canonical editable Polaris estimate/line-item contract and versioned Mission 24 adapter. Authorized current phone-call and photo facts may prefill a draft, but each fact retains source class, source identity/version/digest, capture time, extractor/build/config identity, confidence or missing-evidence state, and human-review state. |
| 3B | Read current Mission 22/23 capacity, execution, resource, and work context only through their accepted interfaces. Capacity and risk guidance is advisory, explains missing/conflicting evidence, and performs zero booking, assignment, reservation, dispatch, or work mutation. |
| 3C | Provide the fast mobile-first editing and review journey: every scope, quantity, unit, line item, price, assumption, and proposal option is editable by a current authorized user. Multi-option proposals and signatures use Mission 24 authority; accepted-estimate-to-work conversion is an explicit reviewed handoff to the owning mission and creates no appointment, dispatch, or execution record by itself. |
| 3D | Preserve the machine/source original, every human revision, actor/reason/time, option lineage, signature/acceptance evidence, exact money and digests as append-only history. Publish only minimized tenant-private edit/outcome observations to Mission 25 and the versioned Mission 32 seam. Replays, stale/conflicting edits, cross-run mixing, concurrent overwrites, and paid/demo crossing fail closed. |
| 4A–4E | Invoice composition consumes only the exact current Mission 24 accepted option/commercial revision and its immutable handoff. Quote edits, alternate options, signatures, and later Mission 32 calculations cannot be confused with invoice revisions or bypass the original amount-authority, tax, reconciliation, and no-missing-as-zero rules. |
| 6A–6D | Customer-safe proposal option and signature presentation reuses the Mission 24 customer boundary and the shared mobile design language while invoice delivery retains its original separate document, token, portal, privacy, and Mission 28 communication gates. |
| 12C–12D | Downstream readers expose minimized same-tenant provenance, edit/outcome, capacity/risk, and coverage evidence. Learning never crosses tenants, trains from unreviewed drafts, or automatically changes a price, option, estimate, schedule, invoice, or policy. |
| 14A–14G | The paid and resettable-fictional-demo journeys, security audit, five-layout browser matrix, independent exact-head audit, and final release must cover the additive workflow end to end in addition to every original financial path and verdict boundary. |

### Shared editable record and adapter contract

- One durable estimate identity carries ordered options, ordered line items, scope, quantities, units, exact prices, assumptions, exclusions, provenance, and immutable revisions. Original extracted facts and human changes are never collapsed into one mutable blob.
- A field records whether it came from an authorized call source, authorized photo/file source, current company fact, accepted calculator result, Polaris suggestion, or human entry. Missing source, stale source, unsupported media, failed extraction, and uncertain interpretation stay explicit.
- Human editing is full but capability-gated. A human may correct any draft field; changing a consequential field creates a new revision and invalidates dependent calculations, proposal previews, signatures, acceptances, and handoffs until the owning authority rechecks them.
- Options share a stable estimate lineage but keep exact independent lines, totals, assumptions, validity, customer presentation, acceptance, and signature evidence. Selecting or signing one option does not approve another.
- Signature evidence is bound to the exact customer-safe proposal version, signer/recipient policy, time, method, consent text, and document digest. It is evidence for Mission 24 to evaluate, not a generic authentication grant or a claim of jurisdiction-wide legal sufficiency.
- The Mission 32 adapter is explicit and versioned. It exchanges the same estimate, revision, option, line, input, assumption, and provenance identities. Mission 32 may append specialized calculation evidence and proposed revisions; only Mission 24 can accept a commercial revision, and only Mission 22 can commit scheduling or dispatch.
- Tenant-private learning receives minimized accepted observations from that tenant's edits and outcomes only after Mission 25 purpose permission and currentness checks. It cannot pool tenant content or silently self-apply a learned change.

### Mobile experience requirement

The primary phone path minimizes steps from authorized call or photo evidence to a reviewable draft, keeps the next safe action obvious, and allows quick correction without hiding assumptions or source gaps. It must work with keyboard and touch, responsive desktop/tablet/phone layouts, light/dark themes, reduced motion and forced colors where applicable, and clear loading, empty, unavailable, denied, stale, conflict, expiry, failure, retry, and recovery states. Paid data never falls back to demo data. Stale callbacks and authority changes clear values, previews, signatures, proposal actions, and dependent guidance before anything else renders.

## Authority and evidence rules

1. **Action authority is explicit.** Mission 23 completion, a calendar state, a customer estimate acceptance, or a forecast cannot create, issue, send, charge, refund, void, or collect an invoice by itself. A current capability-authorized NorthStar business actor performs business-side consequential actions; a scoped customer session may initiate only the exact permitted checkout or correction request; authenticated provider events contribute evidence; and the system may only project accepted facts. Provider evidence never authorizes a new charge. Mission 28 may later automate only separately accepted actions with explicit policy, limits, approvals, and kill switches.
2. **Commercial and operational facts stay separate.** Mission 24 owns the human-approved customer price and commercial revisions. Mission 23 owns execution, completion, reopening, and actual work evidence. Mission 27 records exact immutable references and never rewrites either source.
3. **Financial meanings stay separate.** Draft amount, issued invoice face value, amount due, authorized payment, captured payment, settled cash, refund, dispute, reversal, recognized revenue, and accounting posting are different facts. A `paid` label does not prove settlement, and an invoice does not prove earned revenue.
4. **No missing value becomes zero.** Missing tax authority, incomplete commercial lineage, unavailable completion evidence, unknown payment settlement, unmatched provider event, missing currency, or incomplete accounting acknowledgement yields a typed unavailable or review-required state.
5. **Money uses exact arithmetic.** Durable amounts use exact decimal or integer minor-unit representations with one explicit ISO currency. No binary floating-point calculation or silent foreign-exchange conversion is allowed. Cross-currency summaries remain unavailable without a separately authorized conversion source and policy.
6. **Issued documents are immutable.** Corrections append a replacement invoice, credit note, debit adjustment, void record, or other explicit revision. They never rewrite a document already presented to a customer.
7. **Customer and provider identities are evidence, not authority.** Public links are scoped, expiring, revocable, rate-limited, and bound to one exact document or payment action. Provider object IDs and webhook payloads do not bypass NorthStar tenant, role, currentness, replay, and source-lineage checks.
8. **NorthStar stores no raw card or bank credentials.** Payment instruments remain with an approved provider. NorthStar stores only bounded provider references and minimized evidence needed for lifecycle and reconciliation.
9. **Customer money is not NorthStar subscription billing.** Contractor-to-customer invoices and payments are isolated from NorthStar's own account subscription, plan, trial, and entitlement billing.
10. **Demo is physically and logically isolated.** Demo documents, links, provider objects, events, money, customers, and receipts cannot reach a paid tenant or a live provider. A paid tenant cannot adopt a demo financial record.
11. **Accounting handoff is not a general ledger.** Mission 27 may export or synchronize accepted customer-financial facts and record acknowledgements. It does not invent accounts, recognition policy, tax filings, journal classification, or books-closing authority.
12. **Retention and deletion preserve required audit evidence.** Legal or audit holds, provider disputes, refunds, and financial-record retention rules can block destructive cleanup. Deletion removes eligible customer detail through bounded, resumable operations while preserving minimized non-sensitive proofs required by accepted policy.
13. **Amount authority remains upstream.** A Mission 27 draft may change customer-safe wording, grouping, and allocation only while preserving the exact accepted Mission 24 commercial total. Any amount-changing fee, discount, scope change, or commercial credit requires a new current Mission 24 approved revision and, where that contract requires it, exact customer acceptance. Mission 27-native tax calculation, payment application, refund, and credit-note adjustments are separately typed facts and cannot be disguised as price edits.
14. **Financial state is multi-axis.** Document revision, delivery, payment/balance, due/aging, dispute/refund, settlement, and accounting-handoff states are separate append-only projections. The UI may calculate a deterministic display label but never collapse one axis into another.
15. **Risky financial actions use explicit capabilities.** A role or `operational_role` label alone never authorizes provider connection, invoice issue, send, void, refund, write-off, reconciliation, export, or accounting actions. Part 1 freezes the action-capability matrix, recent-authentication or MFA requirements, self-approval and dual-control rules, amount limits, and immutable actor reason requirements.
16. **Quoted-job editing preserves its authority chain.** Phone and photo extraction creates sourced draft evidence, not a commercial decision. Every edit is an immutable human revision. Proposal options, signatures, and acceptance stay within Mission 24 authority; work conversion, scheduling, execution, invoicing, and payment each require their own owning-mission handoff.
17. **Advice stays advisory.** Capacity and risk guidance may explain current evidence and propose a next step. It cannot reserve capacity, select a crew, dispatch work, alter an estimate, send a proposal, issue an invoice, or train a cross-tenant model.

## Current-state reconciliation

### Accepted upstream authority

| Source | Mission 27 may consume | Mission 27 must not infer |
| --- | --- | --- |
| Mission 20 | Current organization identity, authorized workforce roles, locations, business profile, and explicit operating policy | Financial permission from a role label alone; accounting or tax policy that was never reviewed |
| Mission 22 | Exact appointment and accepted booking lineage | Completion, billable work, invoice readiness, or payment obligation |
| Mission 23 | Exact current execution, accepted completion/reopening state, labor/material/equipment evidence, and downstream handoff receipt | Automatic invoicing, final customer price, earned revenue, or collectible balance |
| Mission 24 | Exact issued estimate version, customer acceptance, approved commercial decision, change amount, currency, taxes and payment schedule when current | Invoice issuance, final work performed, settled cash, or accounting recognition |
| Mission 25 | Authorized external financial evidence and reviewed reconciliation | Native NorthStar invoice/payment truth or permission to mutate it |
| Mission 26 | Advisory forecasts and exact saved forecast evidence | A fact, invoice, payment request, collection action, or accounting entry |
| Mission 28 | Later accepted automation policy and action authority | Any authority before Mission 28 separately implements and accepts it |
| Mission 32 | Specialized field quantities, labor, material, assembly, scenario, production, equipment, and execution-plan calculations through the Mission 27 versioned adapter | A second estimate/line-item record, duplicated calculations, commercial approval, booking, assignment, dispatch, or invoice authority |

### Existing code that is not Mission 27 authority

- Legacy or simulation-only invoice, payment, revenue, collection, and KPI labels are not native financial records and cannot be promoted by renaming them.
- The current read-only analytics fallback that returns zero when a financial engine is absent is not admissible evidence for a Mission 27 balance or KPI.
- Mission 24 estimate payment schedules describe commercial terms; they are not payment transactions.
- Mission 25 external financial imports remain external evidence even after reviewed reconciliation.
- NorthStar platform subscription billing remains a separate account-lifecycle authority.
- The legacy subscription `invoices` table in `migrations/001`, in-memory subscription `recordPayment` path in `src/users/store.js`, zero-valued absent-engine fallbacks in `src/polaris/analytics-engine.js`, and random public-API `revenue` fallback in `src/routes/publicApi.js` are quarantined in Part 1. They cannot be renamed, reused in place, migrated as customer-financial truth, or shown as Mission 27 facts.

## Part 1 — authority, source inventory, threat model, and acceptance contract

| Slice | Scope |
| --- | --- |
| A | Ratify Mission 27 ownership, exclusions, dependency map, terminology, money/currency rules, and the fourteen-part sequence. |
| B | Inventory and quarantine every current invoice/payment-like route, table, event, KPI, simulation, provider integration, customer link, and account-billing surface; classify each as authoritative, upstream evidence, demo-only, legacy, or unavailable and suppress misleading paid UI before later slices consume financial facts. |
| C | Define the threat model and capability matrix for tenant crossing, amount tampering, replay, duplicate charge, confused-deputy actions, customer-link theft, webhook forgery, settlement mismatch, refund abuse, provider compromise, deletion, recovery, recent authentication/MFA, self-approval, dual control, amount limits, and immutable action reasons. |
| D | Freeze the first-supported-launch matrix, acceptance ledger, unsupported-state contract, performance bounds, migration rules, audit independence, and release sequence before Part 2. The matrix names merchant/funds model, provider and mode, methods, countries, currencies, tax jurisdictions, accounting adapter, offline payments, method-specific cash/check evidence and balance rules, check-clearance authority, refunds/disputes, retention, deposit/progress scope, rollout flags, legal/provider/accounting reviews, and every typed exclusion. Unless separately authorized and reviewed, NorthStar does not take custody or control of contractor customer funds. |

The [Slice 1A authority and vocabulary contract](../architecture/MISSION_27_PART1A_AUTHORITY_CONTRACT.md) ratifies the original ownership, exclusions, dependency map, shared editable-record terminology, exact-money/currency rules, and unchanged fourteen-part/sixty-four-slice sequence. It is an unreleased candidate until independent exact-head audit, normal merge, automatic deployment, and health verification succeed. It adds no runtime behavior and does not begin Slice 1B.

Acceptance requires an exact source inventory with no unexplained invoice/payment surface, a reviewed authority matrix, and executable contract tests proving that legacy/demo/account-subscription data cannot satisfy Mission 27 authority.

## Part 2 — financial parties, billing identity, currency, and numbering

| Slice | Scope |
| --- | --- |
| A | Canonical tenant-private billing-party identity linked to one current customer while retaining immutable name, address, contact, tax/exemption, and delivery snapshots per document. |
| B | Owner-reviewed billing contacts, service/billing addresses, purchase-order or customer reference fields, and exact currentness/correction lineage. |
| C | Currency and exact-money contract, invoice-number sequence, prefix/location policy, uniqueness, reserved/issued/void semantics, and bounded sequence recovery. |
| D | Paid and isolated-demo billing-identity review, role/tenant/privacy gates, source correction behavior, and independent Part 2 acceptance. |

Number assignment must be atomic and tenant-scoped. An unused reservation cannot be silently reused after uncertain failure. Numbering policy is an owner-reviewed business setting and does not claim statutory sufficiency in every jurisdiction.

## Part 3 — explicit billable-work handoff

| Slice | Scope |
| --- | --- |
| A | Private read that joins one exact current Mission 24 commercial version to its customer, opportunity, booking, currency, and approved price lineage. |
| B | Private read that joins the same work to current Mission 23 execution, completion/reopening, and accepted downstream handoff evidence. |
| C | Human owner/administrator billable-work review that selects one explicit source class and records why it is invoiceable: a pre-work deposit from exact accepted Mission 24 terms without a completion claim; a final balance from current Mission 23 completion; or a milestone only after a separately accepted Mission 23 milestone/work-package authority exists. |
| D | Immutable handoff receipt with source digests, replay identity, correction/reopening invalidation, direct-table denial, and independent Part 3 acceptance. |

The first supported path is one NorthStar-native customer, estimate, accepted commercial decision, booked job, current Mission 23 completion, and explicit owner-reviewed final-balance handoff. Pre-work deposits enter only when the Part 1 launch matrix includes them and exact accepted Mission 24 payment terms exist. Progress billing, milestones, retainage, and multiple work packages remain typed unsupported until Mission 23 supplies separately accepted milestone/work-package authority. Reopening after completion requires review and cannot silently cancel or rewrite an issued invoice.

## Part 4 — invoice draft composition

| Slice | Scope |
| --- | --- |
| A | Immutable draft origin from one current Part 3 handoff with customer-safe line descriptions, quantities, exact amounts, currency, source references, and private/internal fields excluded. |
| B | Owner edits as append-only draft revisions with explicit reason, optimistic concurrency, idempotency, bounded lines, and complete recalculation. Customer-safe wording, grouping, and allocations may change only while preserving the accepted Mission 24 commercial total; Part 5 approval cannot create price authority. |
| C | Amount-changing fees, discounts, and scope changes require a current exact Mission 24 approved commercial revision and any required customer acceptance. Mission 27-native deposits, prior payments, credit notes, refunds, and tax adjustments are separately typed components with exact provenance and anti-double-counting rules. Unsupported retainage, milestone, tip, surcharge, financing, and recurring shapes remain unavailable. |
| D | Invoice-date tax review records taxable basis per line, service and billing jurisdiction, registration/nexus evidence, exemption snapshot, inclusive/exclusive treatment, exact rounding, collected-tax liability separation, and credit/refund adjustment lineage. It consumes current Mission 24 preparation only when compatible; unsupported jurisdictions and missing professional policy remain typed unavailable. |
| E | Draft totals, amount-due reconciliation, PDF/document preview, paid/demo parity, missing/conflicting evidence states, and independent Part 4 acceptance. |

The draft never becomes a receivable until Part 5 human approval and immutable issue. A zero balance requires explicit supported arithmetic, not missing lines or unknown tax.

## Part 5 — approval, issue, correction, void, and lifecycle state

| Slice | Scope |
| --- | --- |
| A | Owner/administrator final review with exact draft digest, customer, work, currency, totals, due terms, delivery choice, and explicit confirmation. |
| B | Atomic invoice number assignment and immutable issue receipt; uncertain retry returns the same exact result and cannot issue twice. |
| C | Deterministic orthogonal projections for document/revision, delivery, payment/balance, due/aging, dispute/refund, settlement, and accounting-handoff evidence, plus one tested display-precedence policy that does not erase any underlying axis. |
| D | Post-issue correction through explicit credit/debit/replacement/void records with reasons and complete lineage; no mutation of the issued version. |
| E | Concurrent issue, source correction, reopening, cancellation, replay, role/tenant/ACL, restart, and independent Part 5 acceptance. |

Due and overdue are computed from an issued due date and a trusted clock. They do not authorize a reminder, fee, collection message, or automatic charge.

## Part 6 — customer delivery and portal

| Slice | Scope |
| --- | --- |
| A | Customer-safe immutable invoice document and accessible HTML/PDF rendering with private source, cost, margin, staff, digest, and provider fields excluded. |
| B | High-entropy expiring and revocable public invoice token stored only as a hash, bound to one exact issued version and minimized customer session, with enumeration resistance, rate limits, no token/referrer/log leakage, no third-party content, no-store/private caching, explicit download/session rules, and a documented bearer-identity limitation. |
| C | Customer view/download, question, billing-detail correction request, and delivery/view acknowledgements without granting invoice mutation authority; customer mutations require origin/CSRF protection and the Part 1 recipient-verification policy. |
| D | Email/SMS handoff boundary, resend/revoke/recovery, paid/demo isolation, desktop/mobile/accessibility review, and independent Part 6 acceptance. |

Mission 27 may explicitly deliver one approved invoice or payment receipt when the user chooses that intrinsic financial action. Collection reminder execution, campaigns, cadence, retries, and other broader communications are reviewed handoffs to Mission 28 unless the founder separately moves a named human-triggered reminder action into Mission 27. Every allowed delivery preserves preview, recipient review, idempotency, and delivery evidence.

## Part 7 — payment-provider boundary and initiation

| Slice | Scope |
| --- | --- |
| A | Provider-neutral payment contract covering merchant/funds model, tenant-bound provider account identity, hosted onboarding/KYC boundary, supported methods/currencies, availability, fee disclosure, livemode/testmode, capability status, and disabled-by-default rollout. |
| B | Capability-gated owner-controlled provider connection and credential lifecycle using server-side secrets, least privilege, recent authentication, explicit disconnect/reconnect, secret rotation/revocation, account/mode/tenant binding, and no raw payment-instrument storage. |
| C | Customer-initiated payment session for one exact current issued balance with amount, currency, invoice digest, expiration, idempotency, and return/cancel boundaries. If the Part 1 launch matrix separately enables partial or multi-invoice provider payments, a scoped customer session or current capability-authorized owner/administrator may initiate only an exact bounded payment plan containing the current issued invoice set and version digests, one shared ISO currency, requested total, immutable per-invoice allocation, remaining balances, accepted minimum/maximum rules, expiration, and idempotency key. The provider session amount must equal that accepted allocation total, cannot exceed the selected current balances, and becomes unavailable on any invoice, currency, allocation, actor, or currentness mismatch. |
| D | Provider sandbox journey, capability drift and disconnect behavior, forward/backward-compatible adapter schema, feature-flag rollback, unsupported/unavailable methods, duplicate-click and amount-change protection, role/tenant/ACL checks, and independent Part 7 acceptance. Live payment capability remains off until Parts 8–9 and the required Part 13 controls pass. |

The provider adapter cannot mark an invoice paid from the browser return URL. Live charging stays unavailable until provider configuration, legal/business readiness, and an independently reviewed live canary are complete.

## Part 8 — provider events, settlement, and cash reconciliation

| Slice | Scope |
| --- | --- |
| A | Authenticated raw provider-event receipt with signature verification, bounded payload retention, provider-event uniqueness, livemode/account checks, and replay-safe acknowledgement. |
| B | Deterministic event normalization for created, authorized, processing, succeeded, failed, canceled, settled, reversed, and corrected evidence without trusting arrival order. |
| C | Exact invoice allocation and balance projection from accepted current payment evidence; duplicates, wrong tenant/account/currency/amount, and unmatched events fail closed. |
| D | Separate settlement and payout reconciliation with provider balance-transaction evidence; captured payment is not silently treated as settled cash. |
| E | Out-of-order, duplicate, delayed, corrected, missing, replayed, and concurrent events; restart/recovery, private raw-event ACL, provider sandbox proof, and independent Part 8 acceptance. |

Collected cash is recorded only from accepted payment evidence under a versioned policy. Earned revenue remains unavailable without separately approved recognition authority.

## Part 9 — partial payments, credits, refunds, failures, disputes, and reversals

| Slice | Scope |
| --- | --- |
| A | Multiple and concurrent payment attempts, partial and multi-invoice allocations that consume the exact launch-approved initiation plan from Part 7C, safe overpayment handling through an explicit unapplied-credit/refund-review path, and exact race reconciliation when settled money cannot be refused retroactively. No post-payment allocation creates retroactive authority for an amount or invoice set that was not accepted at initiation. |
| B | Launch-matrix-approved deposit application with exact Mission 24 schedule lineage and no double counting in the final balance. Milestone/progress application remains unavailable until separately accepted Mission 23 source authority exists. |
| C | Owner-reviewed credit note and refund request with amount bounds, reason, original payment/allocation lineage, idempotency, and provider acknowledgement. |
| D | When the launch matrix enables offline cash/check recording, capability-gated owner/administrator intake binds one append-only receipt to the exact tenant and one or more current issued invoices with exact allocation, amount, ISO currency, human-attested occurrence time, immutable server-recorded acceptance time, method, bounded evidence/reference, actor, idempotency key, duplicate detection, and immutable source digest. Review and explicit confirmation precede acceptance; corrections append a replacement, reversal, or return record. Cash received and check received are distinct facts. `offline_received`, `check_clearance_unknown`, `check_cleared`, `check_returned`, and `offline_reversed` remain separately projected under the method-specific balance rules frozen in Part 1D; unknown check clearance never becomes settled cash. This human-attested evidence never claims provider authorization, capture, settlement, payout, or bank clearance. When disabled, incomplete, or missing its required clearance authority, the operation and affected derived balance remain explicitly unavailable. |
| E | Failure, cancellation, returned/NSF offline payment, dispute deadline/fee and won/lost outcome, chargeback, reversal, refund settlement, bad-debt/write-off review, and reopened-balance projection as distinct append-only facts or explicit launch-matrix unsupported states. |
| F | Concurrent payment/refund/dispute/offline-receipt adversaries, correction and recovery, customer receipts, accounting compatibility, and independent Part 9 acceptance. |

A refund request is not a completed refund. A provider dispute does not erase the original payment. Negative balances and credits remain separate from revenue or expense recognition.

## Part 10 — accounts receivable and human-controlled collections

| Slice | Scope |
| --- | --- |
| A | Current tenant-private receivable population with exact issued balance, due date, aging bucket, dispute/refund holds, contactability, and typed incomplete-coverage states. |
| B | Owner/administrator collection review queue, filters, drilldown, notes, promise-to-pay record, and explicit next-step selection. |
| C | Reviewed handoff to Mission 28 for a reminder, or an explicitly founder-ratified human-triggered payment-link resend, with exact invoice version, recipient review, message preview, idempotency, cooldown, and delivery evidence. |
| D | Failure/retry/revocation, role/tenant/privacy checks, paid/demo UI, accessibility/responsive review, and independent Part 10 acceptance. |

No late fee, service suspension, reminder cadence, collection escalation, or automatic retry is applied without a separately accepted policy and, where automatic, Mission 28 authority.

## Part 11 — accounting and tax handoff

| Slice | Scope |
| --- | --- |
| A | Provider-neutral export contract for issued invoices, payments, offline cash/check evidence when launch-approved, credits, refunds, write-offs, disputes, fees, and settlements with exact source IDs, currency, timestamps, and revision lineage. |
| B | Explicit owner-selected accounting destination, mapping review, export preview, idempotent transmission, acknowledgement receipt, and partial-failure handling. |
| C | Bidirectional reconciliation that records matched, unmatched, conflicting, corrected, and unavailable states without letting external records rewrite NorthStar authority. |
| D | Tax/accounting boundary review, retention/hold behavior, adapter disconnect/regrant, paid/demo UI, and independent Part 11 acceptance. |

NorthStar does not create a chart of accounts, journal policy, revenue-recognition rule, tax filing, or books-close event by inference. Those remain unavailable until explicitly supplied by an authorized source and reviewed policy.

## Part 12 — reporting and downstream evidence

| Slice | Scope |
| --- | --- |
| A | Source-backed invoice and receivable facts: issued amount, outstanding amount, aging, disputed amount, and invoice lifecycle counts with complete-coverage indicators. |
| B | Source-backed payment and cash facts: provider-authorized, captured, settled, refunded, disputed, reversed, and provider-fee amounts remain separate from accepted offline cash receipt, check received with clearance unknown, check cleared, check returned, offline reversal, and correction. Coverage and launch-matrix support accompany every aggregate; offline evidence never implies provider settlement or bank clearance. |
| C | Exact minimized Mission 25/26/33 readers with purpose permission, tenant isolation, source/currentness digests, correction propagation, and unavailable states. |
| D | Command Center and customer-finance reporting, drilldowns, paid/demo parity, legacy-zero fallback removal, and independent Part 12 acceptance. |

Mission 26 may forecast collections only after it separately accepts source-complete historical evidence and calibration. Mission 25 may learn only from exact accepted observations. Mission 33 receives platform-level facts only under its own authority and cannot inspect tenant detail through this interface.

## Part 13 — provider lifecycle and operational controls

| Slice | Scope |
| --- | --- |
| A | Full provider lifecycle beyond Part 7's minimum launch gate: adapter registration, account health, capability drift, secret and webhook endpoint rotation, sandbox/live separation, disconnect/reconnect, and incident disablement. |
| B | Bounded checkpoints, replay windows, retention, deletion requests, legal/audit/dispute holds, resumable cleanup, and minimized tombstones. |
| C | Migration, restart, concurrency, failover, uncertain-result recovery, provider outage, queue/backpressure, observability, alerts, and runbooks. |
| D | Load and capacity bounds, abuse resistance, security review, disaster-recovery restore proof, and independent Part 13 acceptance. |

Provider outages degrade to explicit unavailable or pending states. NorthStar must not fabricate success, retry a consequential mutation without idempotency, or convert delayed evidence into failure or zero.

## Part 14 — mission acceptance and release

| Slice | Scope |
| --- | --- |
| A | Complete paid-tenant production path with live capability disabled: exact launch-approved billable handoff, human invoice review/issue, secure customer delivery, deterministic in-process provider simulation, simulated settlement evidence, receipt, correction/refund, receivable update, accounting handoff, and downstream evidence. When partial or multi-invoice provider payment is launch-enabled, this path also proves exact authorized initiation, allocation, concurrency/currentness refusal, balance projection, and receipt. When offline recording is launch-enabled, it proves reviewed cash receipt and check-received-with-clearance-unknown through balance, customer receipt, accounting handoff, and reporting without implying provider or bank settlement. Actual provider-sandbox account evidence belongs to the Provider-sandbox accepted verdict. |
| B | Complete resettable fictional demo path with realistic lifecycle states and strict isolation from paid data, credentials, providers, and money. |
| C | Migration, restart, replay, out-of-order event, uncertain response, source correction, reopening, dispute, refund, retention, deletion, and restore journey. When offline recording is launch-enabled, the integrated journey includes duplicate-safe receipt, append-only correction/reversal, check clearance or explicit continued unknown state, returned/NSF reopening, downstream correction, and recovery. |
| D | Tenant, role, CSRF, public-link, webhook, provider-account, direct-table, secret, PII, amount-tampering, duplicate-charge, duplicate-offline-receipt, offline-evidence tampering, and denial-of-service security acceptance. |
| E | Mission-wide performance, observability, accessibility, keyboard, responsive, light/dark, empty/loading/error/recovery, and five-layout-per-page rendered review. |
| F | Independent clean exact-head authority, privacy, security, accounting-boundary, provider, migration, regression, and full-scope audit with no unresolved P0-P3 findings. |
| G | Fresh verified pre-migration backup, normal reviewed PR merge, sole automatic deployment, migration/health, production-safe rendered verification, founder visual verdict, source-linked final ledger, and the exact named verdict earned. A separately authorized controlled live canary is required only for live-payment acceptance and mission-complete status. |

Mission 27 cannot be called complete because a demo works, an API returns an invoice, a provider says a payment succeeded, or an accounting export was sent. Slice G requires the complete accepted paid and demo journeys, exact source/currentness evidence, independently reviewed recovery and security behavior, and production deployment verification. A controlled live canary must use an explicitly authorized tenant, provider account, currency, method, bounded amount, customer identity, refund path, webhook, settlement/payout observation, reconciliation owner, stop condition, and cleanup record without exposing customer or payment secrets. Asynchronous settlement, payout, dispute, or refund evidence cannot be replaced by deploy health.

## Named acceptance verdicts

| Verdict | Minimum evidence | What it does not prove |
| --- | --- | --- |
| Full local | All 64 slice rows close for code, focused mounted evidence, and independent clean exact-head audit | Production configuration, provider account, live money, or founder visual approval |
| Production deployed / provider disabled | Full local plus reviewed deployment, migrations, health, rendered paid/demo verification, and provider capability default-off | Provider sandbox or live payment acceptance |
| Provider-sandbox accepted | Production-deployed code plus exact sandbox account/method/webhook/payment/refund/reconciliation evidence | Live merchant readiness, settlement, or customer money |
| Live-payment accepted | Separately authorized controlled live canary proves configured account, method, webhook, settlement/payout, refund, and reconciliation | Provider-wide or jurisdiction-wide coverage beyond the frozen launch matrix |
| Mission complete | Every required slice and mission-wide gate closes, including the Part 1 launch matrix's required provider/live gate and founder visual verdict | Unsupported launch-matrix features or future Mission 28 automation |

The acceptance ledger records these verdicts separately. A lower verdict cannot be summarized as a higher one.

## Cross-part release order

1. Parts 1–3 establish authority and a billable source before any invoice table is writable.
2. Parts 4–6 establish human-reviewed invoice creation and customer delivery before any payment session can exist.
3. Parts 7–9 establish provider-safe payment truth, settlement, refunds, and disputes before receivable reporting can claim cash status.
4. Parts 10–12 establish human collections, accounting handoff, and downstream reporting from accepted records.
5. Part 13 proves lifecycle and recovery across the complete source and provider chain.
6. Part 14 proves the integrated mission and performs the only mission-final release.

Each migration batch requires a fresh verified backup before merge, exact checksum review, bounded startup and retry behavior, rollback/forward-fix evidence, and sole automatic deployment verification. Each rendered slice requires desktop/mobile interaction review and preserves the founder's separate visual verdict.

## Seven-calendar-day serialized execution target

The plan-only release is Day 0. Product implementation starts only after this document and the acceptance ledger pass the same independent exact-head audit, normal PR merge, sole automatic Railway deployment, migration check, and `/api/health`, `/`, and `/demo/` HTTP 200 verification. With plan release on October 10, 2026, the concrete target is **October 17, 2026 at 11:59 PM America/New_York**.

| Calendar day | Date | Exact slice range, in order | Planned count |
| --- | --- | --- | ---: |
| 1 | 2026-10-11 | 1A–1D, 2A–2D, 3A–3B | 10 |
| 2 | 2026-10-12 | 3C–3D, 4A–4E, 5A–5C | 10 |
| 3 | 2026-10-13 | 5D–5E, 6A–6D, 7A–7D | 10 |
| 4 | 2026-10-14 | 8A–8E, 9A–9E | 10 |
| 5 | 2026-10-15 | 9F, 10A–10D, 11A–11D, 12A | 10 |
| 6 | 2026-10-16 | 12B–12D, 13A–13D, 14A–14B | 9 |
| 7 | 2026-10-17 | 14C–14G and final exact-verdict reconciliation | 5 |

This is a delivery target, not authority to parallelize slices, combine gates, skip corrections, lower evidence, or claim completion after the clock expires. A failed audit, deployment, migration, health check, provider boundary, or required professional review pauses the sequence; the recorded schedule then slips rather than waiving the gate.

### Per-slice release protocol

Every one of the 64 slices uses the same serialized pair and completes the following sequence exactly once:

1. The one designated writer starts from the exact deployed main of the preceding sealed slice, uses one isolated branch/worktree, maps the slice authority, implements only that slice, runs focused necessary evidence, and freezes one clean pushed head/tree/parent/base.
2. The same designated independent auditor, who did not write the head, audits the whole exact head plus the slice's original and additive gates and reports every P0–P3 finding and unavailable evidence.
3. Findings return only to the same writer; the same auditor re-audits the complete corrected head. No PR opens while a P0–P3 remains.
4. Acceptance creates one PR, uses a normal merge, and observes one automatic Railway deployment. There is no manual deployment, duplicate PR, duplicate auditor, parallel slice, or second documentation gate.
5. Release verification binds the exact accepted head/tree, merged main, deployment ID, migration sequence/checksum and startup result, then proves `/api/health`, `/`, and `/demo/` return HTTP 200. A schema change uses only the next additive migration and includes fresh disposable PostgreSQL, rollback or forward-fix, restart, concurrency, runtime-privilege, and residue evidence.
6. Only after release verification is the slice sealed and the next slice started. Completed evidence is never repeated unless a later change touches the protected behavior or an audit finding requires it.

The same writer and same independent whole-head auditor are reused from the plan freeze through 14G. The one-PR and one-deployment rule applies to each slice even when its accepted change is documentation-only.

### Evidence boundaries

Each slice records what was directly proved and keeps these boundaries unavailable until exact evidence exists: live provider or private-production behavior; natural customer and financial history; empirical accuracy or calibration; a real accounting or receiving adapter; hosted CI; production load, latency, and SLA; physical Safari and physical devices; manual assistive-technology review; disaster-restore execution; legal, tax, accounting, provider, and security opinions; controlled live money; and the founder's final visual approval, which is currently suspended and unavailable. Playwright WebKit does not become physical Safari evidence. A simulated, disabled, or sandbox provider does not become live-money, settlement, payout, or reconciliation evidence. The schedule does not turn an unavailable boundary into a pass.

## Part 1 launch-matrix decisions

Part 1D must resolve and freeze these choices before Part 2 begins:

- merchant/funds model and whether NorthStar ever has custody or control of contractor customer funds;
- first provider, mode, supported methods, hosted checkout/onboarding shape, countries, currencies, tax jurisdictions, numbering rules, retention periods, refund/dispute/write-off rules, and accounting destination;
- offline cash/check recording and multi-invoice allocation support;
- whether deposits enter the first supported scope; progress billing, milestones, retainage, tips, surcharges, financing, recurring billing, saved payment methods, and automatic collection stay unsupported unless individually ratified with exact upstream authority;
- provider, legal, accounting, tax, and security review responsibilities and the required named final verdict;
- the authorized earned-revenue recognition source and policy, which Mission 27 invoice/payment evidence cannot decide; and
- any reminder, retry, fee, escalation, or collections execution that remains a Mission 28 handoff.

Every excluded choice is recorded as a typed unavailable state with matching UI copy and tests. It is not silently approximated, converted into manual free-text authority, or treated as zero.
