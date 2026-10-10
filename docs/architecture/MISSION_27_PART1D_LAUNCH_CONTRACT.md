# Mission 27 Part 1D — first-supported-launch contract

Status: Slice 1D implementation candidate for independent whole-head audit. Slice 1C was accepted at head `54a31eb4f31a0118d8153aefc7a04bd356dd7f70`, merged through PR #480 as exact main `204b40793b72c412a47632af54c323437fe8a40e`, and released by automatic Railway deployment `444c7436-80ab-4a90-9aee-e0f7bcee58ee` with migrations through 259 and PostgreSQL startup, `/api/health`, `/`, and `/demo/` HTTP 200. This candidate freezes policy only. It creates no capability grant, customer-financial row, provider/accounting connection, external call, live-money action, route, permission, schema, migration, or UI claim.

The machine-readable policy is [`config/mission27-launch-contract.v1.json`](../../config/mission27-launch-contract.v1.json). This document explains the frozen choices. The JSON contract is authoritative for exact identifiers, booleans, limits, time windows, amount ceilings, layout dimensions, and unavailable codes. Later code may implement it but cannot widen it without a separately reviewed contract version.

## Authority and launch posture

This contract closes original Slice 1D and the launch half of additive gate Q2 under the [frozen Mission 27 roadmap](../roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md). Released Slices [1A](MISSION_27_PART1A_AUTHORITY_CONTRACT.md), [1B](MISSION_27_PART1B_SOURCE_INVENTORY.md), and [1C](MISSION_27_PART1C_THREAT_AND_CAPABILITY_MATRIX.md) remain controlling.

Mission 24 remains the only commercial estimate, option, proposal, signature-meaning, accepted-price, and customer-acceptance authority. Mission 22 remains the only scheduling, assignment, reservation, and dispatch authority. Mission 23 owns work records, execution, completion, reopening, and field actuals. Mission 25 owns tenant-private learning. Mission 27 may later create only its accepted invoice/payment/accounting lifecycle and the shared editable record seam. Mission 32 later contributes specialized field calculations through that seam. No source, extraction, policy row, signature, payment, provider event, or handoff silently acquires another mission's authority.

The current rollout stage is `disabled`. Selected providers and source classes identify the first contract later slices must implement; they are not evidence that credentials, adapters, privacy terms, legal opinions, sandbox accounts, receiving systems, or live capability exist. Every current missing implementation returns a named value-free state.

## Supported intake and extraction matrix

| Concern | First supported contract | Exact boundary |
| --- | --- | --- |
| Phone source | `retell.inbound.completed.v1` | Same-tenant inbound call with authenticated final completed lifecycle, source occurrence time, current consent/retention and integration identity, immutable final transcript digest, and human review. Maximum four hours and 512 KiB of final transcript text. Outbound, live/incomplete, demo/sample, provider-ID-only, consentless, or caller-authorized data is unsupported. The current runtime reader is unavailable. |
| Photo source | `northstar.quoted_job_photo.v1` | Explicit same-tenant estimate-intake upload bound to exact customer or prospect and location. JPEG, PNG, or WebP only; 10 files, 10 MiB each, 50 MiB total, 24 megapixels and 8,192 pixels on either dimension. Verify magic and digest, scan for malware/polyglots, strip metadata before extraction, and require human review. Raw media expires after 30 days unless a valid hold applies. |
| Unsupported media | Named and value-free | HEIC, PDF, video, audio, animation/multiframe, active/embedded content, signature media, and Mission 23 field evidence relabelled as quote intake are rejected. Missing storage/scanner/privacy evidence is not a soft fallback. |
| Extraction | `openai.responses.structured.v1` | Server-side, schema-constrained, `store:false`, no provider tools, no browser inference, exact provider/model/build/config/schema/source pins, 30-second wall-clock and 200-candidate bounds. Output is untrusted candidate evidence and always requires human review. It cannot accept a fact or perform an action. |
| Current extraction state | `extraction_provider_unavailable` | Provider/privacy review, approved server credentials, exact consent/retention proof, tenant-private mounted adapter, and independent acceptance are missing. No provider call is authorized by this policy slice. |

Mission 27 never copies the raw call transcript into its financial store. Later source adapters retain immutable identity, digest, capture/currentness, consent, retention and extractor pins while the owning call source retains raw content under its own accepted policy. Newest malformed, stale, revoked, deleted, retention-lost, unsupported, or unauthorized evidence blocks use; it never causes an older convenient source or demo fixture to appear.

## Editable option and signature policy

A quoted-job draft may contain at most three active options, 100 lines per option and 300 lines across the estimate. Each option may carry 50 assumptions, a 2,000-character line description, 500-character assumption text, and a proposal validity of at most 30 days. Options share one stable estimate lineage but retain independent lines, totals, assumptions, validity, document digest, signature and acceptance evidence. Archive and reorder operations append revisions; they never reuse an identity or approve a price.

The launch signature method is `typed_name_explicit_consent_v1`: one reviewed recipient, one exact current Mission 24 proposal digest, a typed signer name, versioned consent text, an affirmative **Accept and sign** action, server acceptance time, and a current scoped session lasting at most 168 hours. Drawn or biometric signatures and automatic delivery are unsupported. Signature evidence is not staff authentication, payment authorization, proof about another option, or a legal-sufficiency opinion. Mission 24 decides its commercial meaning; a later communication slice uses the Mission 28 boundary where delivery is required.

## Team capability policy

Role, `operational_role`, browser state, provider ownership, or caller claims never authorize an action. Later implementation must mint current action-specific grants from the `m27.owner.v1` and `m27.admin.v1` templates and recheck them at effect time. Owner status does not bypass recent authentication, MFA, independent approval, limits, currentness, dispute/hold, or exact evidence.

- Owners are eligible for every launch-supported capability but still require the corresponding current grant. Provider connection, record deletion, and recovery are owner-only and retain the Slice 1C assurance and dual-control rules.
- Administrators are eligible for quoted-job review/edit/options/signature/handoff and ordinary reviewed financial workflows through action-specific grants. Provider lifecycle and destructive record controls are excluded from the administrator template.
- Members receive no Mission 27 capability by default. An owner may grant only `customer_financial.source.review`, `customer_financial.estimate.edit_draft`, and `customer_financial.estimate.edit_options`; the grant remains tenant-, purpose-, target-, and time-scoped.
- A customer session can perform only the exact proposal signature act or exact customer-initiated checkout encoded by its scoped capability. It cannot acquire staff authority.

Recent-auth, MFA freshness, and independent approval each last at most 600 seconds. Expiry or any changed actor, membership, grant, source, amount, currency, recipient, provider account/mode, policy version, dispute, or hold cancels authority before effect.

## Mobile, handoff, learning, capacity and Mission 32

Every mounted quoted-job surface must pass Chrome and Playwright WebKit at 360×800 dark, 390×844 light, 768×1024 dark, 1024×768 light, and 1440×900 dark. Keyboard, touch, reduced motion and forced colors are mandatory. Playwright WebKit remains browser-engine evidence, not physical Safari or device evidence.

`mission23.work_intake.review.v1` is the first accepted-estimate-to-work request shape. It binds current Mission 24 acceptance, estimate/revision/option/proposal digests, customer/location identity, requester capability, reason, fresh confirmation, and destination acknowledgement. It is a reviewed request only: it creates no appointment, assignment, reservation, dispatch, execution, invoice, or payment. No accepted receiving adapter currently exists, so the runtime state is `work_handoff_receiver_unavailable` until Mission 23 accepts and exposes that boundary.

`mission25.tenant_edit_observation.v1` may later receive only accepted same-tenant human edit deltas, accepted option identity, Mission 24 acceptance outcome, and Mission 23-owned work outcome/actual cost/duration. Raw photos/transcripts, signatures, contact content, instruments, unreviewed drafts, and other-tenant content are prohibited. Current purpose permission and source currentness are mandatory; there is no automatic application.

Capacity/risk guidance is read-only advice over current Mission 20 business/workforce/assets, Mission 22 schedule/assignment/capacity, Mission 23 execution/actuals, Mission 24 estimate/commercial revision, Mission 25 same-tenant accepted observation, and an exactly compatible current Mission 26 advisory run. Any missing source yields `capacity_source_unavailable`; guidance never books or mutates.

The Mission 32 seam is `polaris.estimate_studio.adapter.v1`, compatible only with version 1. It exchanges the same estimate, revision, option, line, input, assumption and provenance identities. Mission 32 may append specialized calculation evidence and proposed revisions. It cannot create a parallel estimate, repeat accepted mathematics, approve commerce, schedule or dispatch.

## Merchant, provider, tax and accounting matrix

| Concern | Frozen choice | Consequence |
| --- | --- | --- |
| Merchant and funds | The contractor business is merchant of record. NorthStar is software and never takes custody or control. | Hosted direct charges settle to the tenant-bound contractor provider account. No NorthStar balance, escrow, split transfer, pooled fund, or payment instrument store. |
| First provider | `stripe_connect`; provider-hosted onboarding and provider-hosted direct-charge checkout | Test mode is the only supported implementation mode until provider gates pass. Live is server-owned, tenant-scoped, default-off and requires separate authorization. No provider SDK/catalogue label or subscription Stripe ID proves this connection. |
| Online method | Card only, one exact current issued invoice balance, USD | No ACH/bank debit, wallet-specific promise, cash app, financing, recurring, saved instrument, automatic collection, partial provider payment, or multi-invoice provider payment. Customer checkout session expires after 30 minutes. |
| Geography/currency | US contractor account and customer transaction in the 50 states or District of Columbia; USD exponent 2 | Territories, other countries/currencies, FX and cross-currency aggregation are unsupported. Exact zero is valid; missing remains value-free. |
| Tax | Exact current Mission 24 decision only | Jurisdiction, basis, rate, amount, currency, rounding version and decision digest are mandatory. NorthStar/Stripe does not infer nexus, exemption, filing, liability, or tax. Missing evidence is `tax_authority_unavailable`. |
| Accounting | `quickbooks_online.accounting_export.v1`, sandbox first | Export/acknowledgement only. No runtime adapter exists. It cannot invent chart of accounts, tax or recognition policy and cannot prove check clearance. |
| Numbering | Tenant-monotonic 10-digit `INV-`, `CR-`, and `RCT-` sequences | Server-assigned, immutable, gaps allowed, no reuse and no annual reset. Reservation, uncertain result and recovery remain Part 2C/Part 5 responsibilities. |

Provider-sandbox acceptance is required for Mission completion. A live-money canary is not a required Mission-completion gate under this first launch contract and remains separately authorized. Founder visual approval remains a required separate verdict and is currently suspended/unavailable.

The first billable final-balance source is one exact current Mission 24 accepted option/commercial revision plus exact current Mission 23 completion evidence and explicit capability-authorized human review. The deposit exception needs exact current Mission 24 accepted deposit terms and human review but no completion claim. Milestone/progress sources remain unavailable until Mission 23 separately accepts a work-package source. Invoice, payment, completion and provider evidence cannot decide earned revenue; the state remains `earned_revenue_policy_unavailable` until an accepted accounting policy and source exist.

## Offline payment and balance rules

Offline cash receipt and check-received evidence are launch-supported, each at most USD 10,000.00 per receipt. Both require reviewed exact allocation, occurrence time, server acceptance time, actor, reason, bounded evidence/reference, idempotency, duplicate detection and source digest. Corrections append replacements/reversals; no record is edited in place.

- Accepted cash evidence produces `offline_received` and reduces the collectible balance by its exact allocation. It never claims provider authorization, capture, settlement, payout, bank deposit, accounting acknowledgement, or earned revenue.
- Accepted check evidence produces `check_clearance_unknown`. It records a pending tender only: invoice face value and settled/paid balance remain unchanged, and collection action for the pending allocation is blocked to prevent duplicate collection.
- `check_cleared` is disabled until an authenticated bank-owned source is separately accepted. Human attestation, QuickBooks export/acknowledgement, a photo or free text cannot claim bank clearance. A returned/NSF check reverses pending tender and makes the exact balance collectible again; it does not invent fees.
- With missing clearance authority, any cleared-cash, settlement, cash-on-hand or check-paid projection is `check_clearance_authority_unavailable` and value-free. A customer receipt must say **check received — clearance unknown**.

## Deposits, refunds, disputes and exclusions

One pre-work deposit is supported only from an exact current Mission 24 accepted payment schedule. It must be a separate invoice and cannot exceed the lesser of 50% of the accepted total or USD 25,000.00. It carries no completion claim and is reconciled exactly once into the final balance.

Progress/milestone billing, retainage, tips, surcharges, financing, recurring billing, saved payment methods and automatic collection remain unsupported. A future milestone requires separately accepted Mission 23 work-package authority and a new reviewed contract version.

Card refunds may be full or partial only to the original settled card charge, never exceeding the current refundable remainder or USD 100,000.00 per action. Offline cash reversal records a bookkeeping correction only and never asserts money was physically returned. A check cannot be refunded as cleared money while clearance is unknown. Disputes are authenticated provider evidence; no event automatically submits evidence, concedes, refunds, writes off, contacts a customer, changes tax or recognizes revenue. A write-off is capped at USD 10,000.00 and cannot decide tax or revenue recognition.

## Exact amount and human-control bounds

All amounts below are exact USD minor-unit policy values in the machine contract. Invoice total and card checkout cap at USD 100,000.00; checkout has a USD 0.50 minimum. An invoice may validly total zero but has no payment session. Commercial correction delta caps at USD 25,000.00.

One current human with the exact capability, required assurance, reason and fresh confirmation may act only at or below these ceilings: USD 10,000.00 for proposal signature request, work handoff, billable-work review, invoice approval/issue/send; USD 1,000.00 for offline cash/check evidence, refunds and commercial correction delta; and USD 500.00 for write-off. Above the applicable ceiling, two different current eligible humans must approve the same unexpired digest. Provider live connection and record deletion always require two humans. A solo tenant receives `dual_control_unavailable`; no owner or emergency bypass exists.

Provider/accounting batch export is capped at 1,000 records and USD 1,000,000.00. Single control ends at 100 records or USD 100,000.00; exceeding either requires two humans. The limits are product safety bounds, not legal, tax, accounting, provider or insurance opinions.

## Retention and operational bounds

Raw quoted-job media and raw provider-event payloads retain for 30 days; public-session tombstones retain for 30 days. Immutable accepted financial records, source-minimized proofs, idempotency receipts and audit history retain for seven calendar years after their terminal lifecycle event. A valid legal, tax, provider, dispute or audit hold suspends eligible deletion without silently changing the baseline. This baseline is not a professional-retention opinion; live rollout remains blocked pending named reviews.

JSON requests cap at 64 KiB, provider events at 256 KiB, reads at 100 records, accounting exports at 1,000 records, synchronous mutations at five seconds, provider sessions at 30 minutes, webhook clock tolerance at 300 seconds, and writers at one per aggregate transaction. Extraction timeout persists no accepted fact or action. Later implementation must fail closed, roll back atomically, return retry/currentness evidence and preserve exact uncertain-result recovery.

## Unsupported-state contract

Every failed prerequisite returns `{ available: false, value: null, code, category, missingEvidence, refreshRequired }`. It exposes no amount, result digest, old value, provider object, token, action preview or demo fallback. The machine contract freezes 52 codes covering source authority/currentness/consent/retention, file rejection, extraction/review, proposal/signature/recipient, capability/assurance/dual control, amount/currency/geography/tax, provider/method/live mode, partial/multi-invoice, accounting/check/settlement/refund/dispute, deposit-adjacent exclusions, handoff/learning/capacity/Mission 32, professional reviews, earned-revenue policy and founder visual approval.

The first failure wins. Newest invalid or ineligible evidence blocks the action; no older-source fallback is permitted. Exact zero remains distinct from unavailable. Loading, denial, expiry, changed authority/currentness, error, retry and recovery clear every dependent value, digest, comparison, signature, proposal, handoff and action before rendering.

## Rollout, migration and release rules

The fixed rollout is: `disabled` → `local_synthetic` → `provider_sandbox` → `production_deployed_provider_disabled` → separately authorized live canary → `live`. Every stage is a server-owned tenant flag and defaults off. Demo stays fictional and physically/logically isolated from paid tenants, accounts, credentials, provider objects, documents and money.

Legal review is required before external signature, live payment and retention launch; provider and security reviews before provider-sandbox acceptance; tax review before a tax-bearing invoice; and accounting review before the accounting adapter or earned-revenue policy. All five reviews are currently unaccepted. A policy choice never substitutes for the named professional evidence.

This candidate adds a versioned JSON policy, this architecture record, roadmap/ledger reconciliation and focused static ratification. It adds no migration 260. The current application remains unable to perform a Mission 27 action. Part 2 may begin only after the same independent auditor accepts this entire exact head with no P0–P3, followed by one normal PR/merge, one automatic Railway deployment, migrations through 259, PostgreSQL startup and `/api/health`, `/`, `/demo/` HTTP 200 verification. The machine contract freezes that one-writer/same-auditor/one-PR/one-deployment sequence. Any later schema slice uses only additive migration 260 with fresh backup, checksum, disposable PostgreSQL, runtime-privilege, restart, rollback/forward-fix and residue evidence.

Directly unavailable evidence remains provider/privacy/legal/tax/accounting/security professional review; live provider or private-production behavior; provider sandbox account/method/webhook/payment/refund/reconciliation; live money, settlement or payout; natural customer/financial history; a real accounting, bank-clearance or work-handoff receiving adapter; production load/latency/SLA; hosted CI; physical Safari/devices; manual assistive-technology review; disaster restore; and founder visual approval. This policy freeze is not evidence for any of them.
