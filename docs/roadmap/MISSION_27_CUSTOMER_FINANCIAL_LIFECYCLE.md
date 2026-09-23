# Mission 27 — Customer Financial Lifecycle

Mission 27 owns the contractor's **native customer invoice, payment, collection, refund, and accounting-handoff records**. Its purpose is to turn an explicitly accepted commercial obligation into a traceable invoice and then distinguish what was invoiced, paid, credited, refunded, disputed, or still due. It does not treat an estimate, approved quote, completed job, invoice face value, earned revenue, and collected cash as interchangeable facts. This ownership follows the existing [Mission 23 downstream handoff](MISSION_23_OPERATIONS.md), [Mission 24 estimating boundary](MISSION_24_ESTIMATING.md), [Mission 25 learning boundary](MISSION_25_OUTCOME_LEARNING.md), and [Mission 26 forecasting boundary](MISSION_26_PREDICTIVE_INTELLIGENCE.md).

This is a founder-requested **proposed** implementation breakdown of **nine parts and 41 slices** under the existing Mission 27 authority. It is reviewable before adoption and creates no invoice or payment merely by being adopted. Each slice still requires its own evidence, independent review, and normal release gate. Any material scope or count change must be documented before implementation.

| Part | Scope | Slices |
| --- | --- | ---: |
| 1 | Authority, source boundaries, policy, and security | 4 |
| 2 | Commercial and operational handoff | 4 |
| 3 | Native invoice lifecycle | 5 |
| 4 | Customer-safe invoice composition and presentation | 4 |
| 5 | Payment requests, receipts, and allocation | 5 |
| 6 | Balance, adjustments, refunds, and collections | 5 |
| 7 | Accounting and downstream evidence handoffs | 4 |
| 8 | Paid and isolated-demo experience | 4 |
| 9 | Mission-wide acceptance and release | 6 |

## Existing authority and non-duplication

- Mission 20 owns company identity, Business Profile, operating policy, and any authorized invoice branding, tax, fee, and payment-term settings. Mission 27 must read the applicable version, preserve its source, and expose an unresolved setting when authority is missing. It must not invent tax or legal treatment.
- Mission 23 owns field execution, actuals, completion, and discovered conditions. Completion is a potential handoff, never an automatic invoice. Mission 24 owns estimates, human price decisions, and customer-safe quote output. Mission 27 references accepted commercial revisions without rewriting them.
- Mission 25 may consume exact native financial outcomes after Mission 27 releases them. Its already accepted external financial import remains separate evidence and does not become a native invoice or payment. Mission 26 may consume guarded invoice, receivable, and cash evidence only when its own source, coverage, and calibration gates pass.
- Mission 28 owns approved sending, reminders, and automated collection communications. Mission 29 owns cross-workflow governance and permission thresholds. Mission 31 demonstrates an isolated fictional end-to-end journey; Mission 32 may hand over a human-approved commercial result. None of these missions may bypass Mission 27's financial decisions.
- NorthStar's own SaaS subscription billing is separate from a contractor's customer invoices and payments. Reuse of an existing provider integration does not grant contractor payment-processing authority.

## Part 1 — authority, source boundaries, policy, and security (4 slices)

| Slice | Required result |
| --- | --- |
| 1A | Canonical identities and event meanings for draft, approved, issued, corrected, voided, paid, credited, refunded, disputed, and collected states; separate invoice amount, receivable balance, earned-value evidence, and cash. |
| 1B | Versioned applicable Business Profile and company policy inputs for issuer identity, terms, currency, tax/fee/discount treatment, numbering, deposits, and milestones; missing authority is explicit. |
| 1C | Tenant, role, record-scope, session, CSRF, idempotency, immutable-history, retention, and customer-output boundaries; enumerate human decisions and provider actions separately. |
| 1D | Provider-neutral payment/accounting interfaces, failure and replay rules, and explicit live-provider and legal/commercial readiness gates; no card-data storage or simulated provider success presented as real. |

## Part 2 — commercial and operational handoff (4 slices)

| Slice | Required result |
| --- | --- |
| 2A | Guarded reference to the exact current Mission 24 approved quote/price, scope, currency, customer, revision, and provenance; changed or withdrawn commercial authority blocks stale handoff. |
| 2B | Guarded Mission 23 completion, milestone, actual, and change-order evidence where billing terms call for it; distinguish customer additions, corrections, rework, and unapproved work. |
| 2C | Owner-readable billable-work preview that reconciles agreed scope, completed or milestone work, deposits, allowances, prior invoices, credits, and missing conditions without silently creating a debt. |
| 2D | Explicit authorized human acceptance of one exact handoff basis; duplicate, concurrent, cross-tenant, stale, incomplete, or conflicting handoffs fail closed. |

## Part 3 — native invoice lifecycle (5 slices)

| Slice | Required result |
| --- | --- |
| 3A | Tenant-private invoice draft with exact source pins, line items, currency, arithmetic version, issuer/customer identity, and recoverable validation errors. |
| 3B | Deterministic subtotal, authorized tax/fees/discounts, deposits, prior billings, and balance arithmetic with explicit units, rounding, inclusive/exclusive treatment, and duplicate-charge protection. |
| 3C | Human draft review, revision, and approval with immutable prior versions and an inspectable before/after explanation; no AI or job completion silently approves a bill. |
| 3D | Atomic issue event, unique tenant-scoped number, issue/due timestamps, immutable issued snapshot, and exact idempotent replay; issuance is distinct from sending or charging. |
| 3E | Post-issue correction path by explicit void, credit, or replacement linkage according to approved policy, preserving the original and its delivery/payment history. |

## Part 4 — customer-safe composition and presentation (4 slices)

| Slice | Required result |
| --- | --- |
| 4A | Branded invoice document using applicable company identity, customer, scope, line items, dates, terms, and amount due; exclude private margin, wages, Capella analysis, and internal evidence. |
| 4B | Human preview of exact draft/issued content, calculation basis, unresolved fields, and recipient before issue or approved delivery. |
| 4C | Stable download/print artifact and immutable content digest tied to the issued version, with correction and payment status shown as later linked events rather than editing history. |
| 4D | Accessible, responsive customer-safe presentation and denial/recovery states; no fake payment link, tax certification, or provider availability claim. |

## Part 5 — payment requests, receipts, and allocation (5 slices)

| Slice | Required result |
| --- | --- |
| 5A | Explicit owner-approved payment-request terms and provider-neutral request identity linked to an issued invoice; an issued invoice does not charge a customer. |
| 5B | Optional authorized provider adapter and credential boundary, including sandbox/live separation, hosted payment flow where chosen, cancellation, expiry, and unavailable-provider behavior. |
| 5C | Idempotent authenticated provider events and separately labeled human-recorded payment evidence, with event time, amount, currency, fees, status, source, and original payload reference. |
| 5D | Deterministic allocation of deposits, partial payments, multi-invoice payments, overpayments, and failed/reversed payments without double counting. |
| 5E | Reconciliation of request, provider settlement, invoice allocation, and current balance; unresolved, duplicate, delayed, or contradictory events remain reviewable rather than being silently marked paid. |

## Part 6 — balance, adjustments, refunds, and collections (5 slices)

| Slice | Required result |
| --- | --- |
| 6A | Current receivable, aging, due/overdue, partial-payment, and collection-state projections from immutable invoice and payment events. |
| 6B | Explicit human-approved credits, discounts after issue, write-offs, and correction reasons with line-level links and no retroactive invoice rewrite. |
| 6C | Refund request, approval, provider/manual outcome, and reconciliation with original payment and credit; failed or pending refunds never appear completed. |
| 6D | Dispute/chargeback and reversal states, documentary provenance, balance impact, and owner review without automatic assertion of fault or legal outcome. |
| 6E | Reviewed collection/reminder handoff to Mission 28 with recipient, amount, currentness, quiet-hours/consent/policy gates as applicable; Mission 27 records state but does not send autonomously. |

## Part 7 — accounting and downstream evidence handoffs (4 slices)

| Slice | Required result |
| --- | --- |
| 7A | Provider-neutral, versioned accounting export or integration mapping for invoice, payment, credit, refund, fee, and reconciliation events, with explicit tax/accounting classification authority. |
| 7B | Durable outbound event identity, replay, correction, failure, and reconciliation status; an export acknowledgement is not proof of bank settlement or earned revenue. |
| 7C | Guarded tenant-private Mission 25 outcome handoff that separates original quote, invoiced amount, customer change, payment, refund, and actual operational cost. |
| 7D | Guarded Mission 26 financial-source handoff that distinguishes booked work, billed receivables, collected cash, and unresolved recognition/coverage; no forecast is issued by Mission 27. |

## Part 8 — paid and isolated-demo experience (4 slices)

| Slice | Required result |
| --- | --- |
| 8A | Paid owner/admin invoice workspace from the existing customer/job/quote, with few required entries, clear review decisions, and linked history. |
| 8B | Payment and balance view with pending/failed/reversed states, source labels, reconciliation gaps, and actionable recovery without false paid claims. |
| 8C | Resettable fictional demo of quote-to-invoice-to-payment, credits, and refunds using the same domain rules while every simulated action, person, price, and provider result is clearly labeled. |
| 8D | Responsive, keyboard-accessible, light/dark, plain-language experience including loading, empty, error, stale, permission-denied, and conflict states; customer and internal views preserve privacy. |

## Part 9 — mission-wide acceptance and release (6 slices)

| Slice | Required result |
| --- | --- |
| 9A | Fresh and populated migration, immutable history, idempotency, concurrency, bounded-size, recovery, and forward-compatible release proof. |
| 9B | Arithmetic tests for tax/fee policy inputs, rounding, deposits, milestones, partial payments, credits, refunds, reversals, multi-currency denial, and duplicate-cost/payment prevention. |
| 9C | Tenant, role, record, session, CSRF, provider-signature, sensitive-data, customer-output, retention, and paid/demo isolation proof. |
| 9D | Provider sandbox or explicit provider-unavailable evidence, plus complete paid and fictional-demo journeys, accessibility, responsive/theme, and five-layout-per-page visual review. |
| 9E | Genuinely independent exact-head audit of source authority, financial semantics, security, arithmetic, data quality, recovery, UX, and regression with zero unresolved P0–P3 findings. |
| 9F | Normal merge, sole automatic deployment verification, health and passive acceptance, founder visual verdict, and truthful final Mission 27 acceptance; unavailable live/provider/legal evidence remains separately labeled. |

## Sequencing and external decisions

Parts 1–2 establish authority before an invoice can be created. Parts 3–4 establish human-approved issuance and customer-safe output. Parts 5–7 add payment, adjustment, collection, and evidence handoffs. Part 8 ships paid/demo parity alongside each user-facing increment; it is not a promise to postpone demo until the end. Part 9's relevant checks accompany each release and close the mission only after the complete journey is proven.

The founder must select or approve commercial policies that the existing Business Profile does not already settle: supported invoice/deposit/milestone terms, customer payment methods/provider, tax and fee authority, refunds/write-offs, collection policy, and any customer delivery channel. These decisions gate their affected runtime slices, not architecture-only work or synthetic validation. Attorney review and public-provider launch readiness are separate from implementing and testing the system with clearly fictional data. No live customer payment, sending, or provider configuration is authorized by this roadmap alone.
