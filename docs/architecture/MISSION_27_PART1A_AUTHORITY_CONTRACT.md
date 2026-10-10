# Mission 27 Part 1A — authority and vocabulary contract

Status: Slice 1A released. The authority contract was accepted at head `7a16a4fbd833d4695d0dc79289d5e074551d3eea`, merged through PR #478 as exact main `2c2dfd5e25d4c9ee991ee60b2871ae66f948e4ae`, and released by automatic Railway deployment `f0ac5be6-69b2-4fb7-a9eb-662f91b4785e` with migrations through 259 and startup, `/api/health`, `/`, and `/demo/` HTTP 200. It added no route, schema, migration, provider call, customer-financial record, permission, UI, or product behavior. Slices 1B–1C are also released; Slice 1D is the current first-supported-launch gate.

## Controlling authority

This contract ratifies Slice 1A of the [frozen Mission 27 roadmap](../roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md) and its [64-slice acceptance ledger](../roadmap/MISSION_27_ACCEPTANCE_LEDGER.md). It preserves the original customer-financial lifecycle and the additive Polaris quoted-job gates without replacing or reprioritizing either.

The following released contracts remain controlling at their own boundaries:

- [Mission 22](../roadmap/MISSION_22_SCHEDULING_AND_DISPATCH.md) owns scheduling, assignment, reservation, and dispatch.
- [Mission 23](../roadmap/MISSION_23_OPERATIONS.md) owns work execution, field actuals, completion, reopening, and execution evidence.
- [Mission 24](../roadmap/MISSION_24_ESTIMATING.md), its [estimate architecture](MISSION_24_ESTIMATE_ARCHITECTURE.md), and its [customer quote contract](MISSION_24_CUSTOMER_QUOTE_CONTRACT.md) own canonical estimates, commercial revisions, approved customer prices, options, customer-safe proposals, customer acceptance, and the commercial meaning of signature evidence.
- [Mission 25](../roadmap/MISSION_25_OUTCOME_LEARNING.md) owns purpose-limited tenant-private observations and learning. Mission 27 may publish minimized accepted observations; it cannot silently train from drafts or apply a learned change.
- Mission 26 owns forecasts and advisory distributions. A forecast is never invoice, payment, price, schedule, or execution authority.
- Mission 27 owns the native contractor-to-customer invoice, balance, payment-evidence, collection, credit, refund, dispute, settlement-reconciliation, receipt, and accounting-handoff lifecycle. It also establishes the shared editable Polaris estimate/line-item vocabulary, provenance and human-revision contract, and versioned Mission 32 adapter seam while leaving commercial decisions in Mission 24.
- [Mission 32](../roadmap/MISSION_32_ON_THE_FLY_CALCULATOR.md) later owns deeper field quantity, labor, material, assembly, production, equipment, scenario, and execution-plan calculations through that seam. It cannot create a parallel estimate, repeat mathematics owned by an accepted engine, approve a commercial revision, or book work.

Mission 20 organization, workforce, location, business-profile, and explicit operating-policy facts remain upstream identity and policy evidence. Mission 21 reviewed knowledge remains distinct from tenant facts. Mission 28 later owns only separately accepted automation and communications. Mission 33 owns NorthStar platform administration, not contractor commercial or financial decisions. NorthStar subscription billing remains separate from contractor customer money.

## Ratified ownership and exclusions

| Concern | Owning authority | What Mission 27 may do | What Mission 27 must not infer or mutate |
| --- | --- | --- | --- |
| Customer/prospect and tenant identity | Current canonical customer and organization authorities | Bind exact tenant-private identities and immutable document snapshots after the applicable slice accepts them | Silently create or merge a customer from intake, call, photo, public link, or provider data |
| Appointment, crew, asset, reservation, dispatch | Mission 22 | Read accepted current context and later request an explicit reviewed handoff | Reserve, assign, schedule, or dispatch from a draft, recommendation, signature, acceptance, invoice, or payment |
| Work execution and completion | Mission 23 | Reference exact current execution and completion evidence for an accepted billable handoff | Treat a calendar state, estimate acceptance, invoice, or provider event as work performed |
| Estimate, scope, option, price, proposal, signature evaluation, acceptance | Mission 24 | Preserve the shared editable record contract and consume exact current approved commercial evidence | Turn extraction, navigation, proposal creation, recommendation, signature capture, or invoice editing into commercial approval |
| Tenant-private learning | Mission 25 | Publish minimized, purpose-authorized accepted edit/outcome observations with exact lineage | Pool tenants, learn from unreviewed drafts, or auto-apply changes to price, schedule, invoice, or policy |
| Forecasts and uncertainty | Mission 26 | Consume explicitly compatible advisory evidence where a later slice authorizes it | Treat a forecast as a fact, price, invoice, collection action, or accounting entry |
| Invoice and customer-financial lifecycle | Mission 27 | Create append-only financial records only through later accepted Mission 27 slices and launch-matrix authority | Reuse subscription billing, legacy analytics, demo records, provider claims, or UI labels as customer-financial truth |
| Deep field calculations and execution-plan proposals | Mission 32 | Define and later consume a versioned adapter against the same estimate/revision/option/line identities | Create a second estimate store, duplicate accepted calculations, approve price, or commit schedule/execution |

Extraction converts authorized source evidence into reviewable candidate facts. Navigation opens a permitted record. Proposal creation projects a customer-safe version. Recommendation remains advice. Signature capture records evidence bound to one exact version. None of those operations supplies authority owned by another mission.

## Shared vocabulary

| Term | Ratified meaning |
| --- | --- |
| Source evidence | An authorized tenant-private call, photo/file, current company fact, accepted calculator result, or human entry with source class, identity, version, digest, capture time, and currentness. Source evidence is not approval. |
| Extracted candidate fact | A machine-derived interpretation that retains extractor/build/config identity, confidence or missing-evidence state, and human-review state. It cannot silently become a recorded fact. |
| Editable Polaris draft | A non-binding working projection against one stable estimate lineage. An authorized user may edit scope, quantity, unit, line item, price, assumption, exclusion, and option; each consequential edit creates a revision. A draft is not a customer, booking, work record, invoice, or payment obligation. |
| Estimate identity | The durable Mission 24 commercial lineage shared by options, line items, revisions, proposals, and the Mission 32 adapter. It is not replaced when a new revision is appended. |
| Revision | An immutable ordered version with actor, reason, time, source pins, exact content digest, and predecessor. Changed consequential inputs invalidate dependent calculations, previews, signatures, acceptances, and handoffs until the owning authority rechecks them. |
| Line item | One ordered commercial component with stable identity, customer-safe description, quantity/unit where known, exact amount and currency, assumptions, provenance, and revision lineage. Missing quantity or rate is not invented. |
| Option | One independently reviewable commercial alternative inside the same estimate lineage. Each option retains its own lines, totals, assumptions, validity, presentation, acceptance, and signature evidence. Selecting one option never approves another. |
| Proposal version | A customer-safe Mission 24 projection of one exact reviewed option/revision and document digest. Creating, previewing, downloading, or navigating to it is not acceptance or delivery. |
| Signature evidence | Evidence bound to one exact proposal version, signer/recipient policy, method, time, consent text, and document digest. Mission 24 evaluates its commercial meaning; it is not a generic authentication grant or universal legal-sufficiency claim. |
| Customer acceptance | Mission 24's accepted decision for one exact current proposal/option version under its capability, identity, consent, expiry, and currentness rules. It proves neither work completion nor payment. |
| Accepted-estimate-to-work handoff | An explicit reviewed request carrying exact current commercial lineage to the owning operational mission. The request alone creates no appointment, assignment, dispatch, reservation, or execution record. |
| Billable-work handoff | A later Mission 27 input that satisfies the Part 1D launch matrix and binds exact accepted commercial and operational evidence. Neither estimate acceptance nor completion alone is sufficient unless the launch matrix explicitly defines that source class. |
| Invoice | A Mission 27 customer-financial document derived through later accepted slices from one launch-approved handoff. It is distinct from an estimate, proposal, payment request, settlement, earned revenue, and accounting posting. |
| Payment evidence | A typed provider, customer-session, or launch-approved offline fact. Authorization, capture, settlement, payout, refund, dispute, reversal, and accounting acknowledgement remain separate states. |
| Currentness | A server-evaluated statement that every authority, identity, revision, digest, capability, and source required for the action still matches. A stale record remains historical evidence and cannot authorize a new consequential action. |
| Unavailable | A named value-free state caused by missing, unsupported, stale, conflicting, denied, or unverifiable authority. It is distinct from a numeric or factual zero. |

## Exact money and currency contract

1. Every durable monetary amount is represented by an exact decimal or integer minor-unit value together with one explicit ISO 4217 currency code. JavaScript binary floating point, formatted text, currency symbols, and locale display strings are never durable arithmetic authority.
2. Conversion between major and minor units uses the currency's accepted exponent and an explicit rounding rule at the owning calculation boundary. A later slice must freeze bounded precision, rounding mode, and overflow limits before executable money arithmetic is accepted.
3. `0` is an exact known amount. Absent, unknown, unsupported, withheld, stale, conflicting, and not-yet-calculated amounts stay typed and value-free. They never coalesce to zero.
4. Quantities, rates, bases, percentages, allocations, taxes, discounts, fees, credits, refunds, and totals retain their exact inputs and calculation version. A displayed rounded total cannot replace the exact stored calculation or its digest.
5. Every sum, comparison, allocation, balance, and reconciliation requires one matching currency. Currency mismatch fails closed. No silent foreign-exchange conversion, symbol-based inference, or cross-currency summary is allowed; a future conversion requires a separately authorized source, timestamp, policy, and immutable calculation evidence.
6. A negative number does not explain its meaning. Discounts, credits, refunds, reversals, write-offs, and corrections use separately typed records and rules. Issued customer documents are corrected by append-only replacement, credit, debit, or void evidence rather than in-place mutation.
7. Mission 24 remains the authority for accepted customer price, commercial adjustments, taxes, and payment schedule when those facts are within its contract. Mission 27 may later calculate only separately authorized invoice-native tax, allocation, balance, payment, refund, and credit-note facts; it cannot disguise a price change as financial arithmetic.
8. Contractor customer money and NorthStar subscription money never share authority, identities, provider objects, tables, events, balances, or reporting semantics merely because both use an `invoice` or `payment` label.

## Current source position and quarantine

At the deployed Slice 1A base, the repository has no Mission 27 runtime module, customer-financial migration, or accepted customer-financial authority. Migrations end at `259_demo_forecast_journey.sql`; Slice 1A added no migration 260.

The current code names several invoice/payment/revenue-like surfaces that remain quarantined exactly as the frozen roadmap requires:

- `migrations/001_initial_schema.sql` defines an `invoices` table attached to `subscriptions` and a Stripe subscription invoice identifier. It is NorthStar account billing, not contractor customer-financial authority.
- `src/users/store.js` has an in-memory `recordPayment` path on user subscription history. It is not tenant-private customer payment evidence.
- `src/polaris/analytics-engine.js` contains financial analytics with zero-valued fallbacks. Those values cannot satisfy exact money, missingness, invoice, payment, settlement, or balance authority.
- `src/routes/publicApi.js` labels estimated call-record pipeline amounts as revenue in a legacy public analytics route. It cannot satisfy Mission 27 authority.
- Mission 26 `revenue.approved_price_flow.v1` remains advisory forecast evidence over Mission 24-approved price decisions. It is neither earned revenue nor an invoice/payment source.

This list ratified known exclusions needed for Slice 1A. The released [Slice 1B source inventory and quarantine contract](MISSION_27_PART1B_SOURCE_INVENTORY.md) exhaustively classifies the repository surfaces and records the required paid-copy suppression. The released [Slice 1C threat and action-capability contract](MISSION_27_PART1C_THREAT_AND_CAPABILITY_MATRIX.md) grants no runtime authority. The [Slice 1D launch contract](MISSION_27_PART1D_LAUNCH_CONTRACT.md) is the current candidate.

## Frozen implementation sequence

The original sequence remains fourteen parts and sixty-four slices: Part 1 (4), Part 2 (4), Part 3 (4), Part 4 (5), Part 5 (5), Part 6 (4), Part 7 (4), Part 8 (5), Part 9 (6), Part 10 (4), Part 11 (4), Part 12 (4), Part 13 (4), and Part 14 (7). The additive quoted-job gates remain overlays on the named original slices and create no new slice, parallel release lane, or permission to reorder financial work.

Slices 1A–1C are released. Slice 1D owns the launch matrix and executable unsupported-state contract. No Slice 1A statement enables a provider, financial action, customer communication, scheduling action, estimate approval, learning application, or Mission 32 calculation.

Every slice continues through exactly one writer, the same independent whole-head auditor, one normal PR/merge after no P0–P3 finding, one automatic Railway deployment, and exact migration/startup/`/api/health`/root/demo verification. Documentation-only work still requires that release lane; it does not require invented database or browser evidence.

## Slice 1A acceptance boundary

Slice 1A is sealed by its accepted exact head, normal merge, automatic deployment, and health verification recorded above. Its authority map, exclusions, vocabulary, money/currency rules, and exact sequence remain controlling for later slices.

Unavailable evidence remains explicit: live provider or private-production behavior; natural customer and financial history; empirical accuracy or calibration; a real accounting or receiving adapter; hosted CI; production load, latency, and SLA; physical Safari and physical devices; manual assistive-technology review; disaster-restore execution; legal, tax, accounting, provider, and security opinions; controlled live money; and the founder's final visual approval, which remains suspended.
