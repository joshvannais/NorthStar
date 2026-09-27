# Mission 27 — Customer financial lifecycle

Objective: give each NorthStar business a trustworthy, tenant-private path from an exact launch-approved billable source to an invoice, customer payment, collection follow-up, refund or dispute record, and accounting handoff without turning operational completion, provider messages, estimates, or predictions into financial truth. A final balance requires accepted commercial terms plus current completion evidence; a launch-approved pre-work deposit requires exact accepted commercial deposit terms and makes no completion claim.

Mission 27 owns the native customer financial lifecycle: invoices, customer-facing balances, payment evidence, collections, credits, refunds, disputes, settlement reconciliation, receipts, and accounting handoff. It does not replace Mission 24 customer-price authority, Mission 23 field-execution authority, Mission 25 external-source learning, Mission 26 predictions, Mission 28 automation, or a licensed accounting or tax professional's policy.

## Frozen implementation structure — 14 parts, 63 slices

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
| 9 | Partial payments, deposits, credits, refunds, failures, disputes, and reversals | 5 | Planned |
| 10 | Accounts-receivable aging and human-controlled collection workflow | 4 | Planned |
| 11 | Accounting and tax handoff, export, acknowledgement, and reconciliation | 4 | Planned |
| 12 | Financial reporting and exact downstream evidence for Missions 25, 26, and 33 | 4 | Planned |
| 13 | Provider lifecycle, observability, retention, deletion, recovery, and operational controls | 4 | Planned |
| 14 | Complete paid/demo journeys, migration proof, accessibility, independent audit, and release | 7 | Planned |

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
| D | Freeze the first-supported-launch matrix, acceptance ledger, unsupported-state contract, performance bounds, migration rules, audit independence, and release sequence before Part 2. The matrix names merchant/funds model, provider and mode, methods, countries, currencies, tax jurisdictions, accounting adapter, offline payments, refunds/disputes, retention, deposit/progress scope, rollout flags, legal/provider/accounting reviews, and every typed exclusion. Unless separately authorized and reviewed, NorthStar does not take custody or control of contractor customer funds. |

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
| C | Customer-initiated payment session for one exact current issued balance with amount, currency, invoice digest, expiration, idempotency, and return/cancel boundaries. |
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
| A | Multiple and concurrent payment attempts, partial and multi-invoice allocations, safe overpayment handling through an explicit unapplied-credit/refund-review path, and exact race reconciliation when settled money cannot be refused retroactively. |
| B | Launch-matrix-approved deposit application with exact Mission 24 schedule lineage and no double counting in the final balance. Milestone/progress application remains unavailable until separately accepted Mission 23 source authority exists. |
| C | Owner-reviewed credit note and refund request with amount bounds, reason, original payment/allocation lineage, idempotency, and provider acknowledgement. |
| D | Failure, cancellation, returned/NSF offline payment, dispute deadline/fee and won/lost outcome, chargeback, reversal, refund settlement, bad-debt/write-off review, and reopened-balance projection as distinct append-only facts or explicit launch-matrix unsupported states. |
| E | Concurrent payment/refund/dispute adversaries, correction and recovery, customer receipts, accounting compatibility, and independent Part 9 acceptance. |

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
| B | Source-backed payment and cash facts: authorized, captured, settled, refunded, disputed, reversed, and provider-fee amounts kept separate. |
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
| A | Complete paid-tenant production path with live capability disabled: exact launch-approved billable handoff, human invoice review/issue, secure customer delivery, deterministic in-process provider simulation, simulated settlement evidence, receipt, correction/refund, receivable update, accounting handoff, and downstream evidence. Actual provider-sandbox account evidence belongs to the Provider-sandbox accepted verdict. |
| B | Complete resettable fictional demo path with realistic lifecycle states and strict isolation from paid data, credentials, providers, and money. |
| C | Migration, restart, replay, out-of-order event, uncertain response, source correction, reopening, dispute, refund, retention, deletion, and restore journey. |
| D | Tenant, role, CSRF, public-link, webhook, provider-account, direct-table, secret, PII, amount-tampering, duplicate-charge, and denial-of-service security acceptance. |
| E | Mission-wide performance, observability, accessibility, keyboard, responsive, light/dark, empty/loading/error/recovery, and five-layout-per-page rendered review. |
| F | Independent clean exact-head authority, privacy, security, accounting-boundary, provider, migration, regression, and full-scope audit with no unresolved P0-P2 findings. |
| G | Fresh verified pre-migration backup, normal reviewed PR merge, sole automatic deployment, migration/health, production-safe rendered verification, founder visual verdict, source-linked final ledger, and the exact named verdict earned. A separately authorized controlled live canary is required only for live-payment acceptance and mission-complete status. |

Mission 27 cannot be called complete because a demo works, an API returns an invoice, a provider says a payment succeeded, or an accounting export was sent. Slice G requires the complete accepted paid and demo journeys, exact source/currentness evidence, independently reviewed recovery and security behavior, and production deployment verification. A controlled live canary must use an explicitly authorized tenant, provider account, currency, method, bounded amount, customer identity, refund path, webhook, settlement/payout observation, reconciliation owner, stop condition, and cleanup record without exposing customer or payment secrets. Asynchronous settlement, payout, dispute, or refund evidence cannot be replaced by deploy health.

## Named acceptance verdicts

| Verdict | Minimum evidence | What it does not prove |
| --- | --- | --- |
| Full local | All 63 slice rows close for code, focused mounted evidence, and independent clean exact-head audit | Production configuration, provider account, live money, or founder visual approval |
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
