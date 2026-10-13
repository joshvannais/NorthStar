# Mission 27 Part 4D — invoice-date tax preparation and immutable review

Status: implementation candidate for original Part 4D and the tax portion of Q8. It does not accept the candidate, begin Part 4E, establish professional tax policy, authorize a tax-bearing invoice, calculate amount due, approve or issue an invoice, create a receivable, file or remit tax, recognize revenue, or perform any provider, payment, credit, refund, accounting or downstream action.

## Exact source authority

The private owner/admin read reconstructs one exact-current Part 4B invoice draft inside PostgreSQL. It pins the immutable Part 4A origin, complete Part 4B revision and history-chain digests, current accepted Mission 24 issued version and commercial terms, reviewed billing identity, service and billing jurisdictions, and the exact Part 3 handoff receipt. Caller-authored prices, rates, source identities, jurisdiction claims, registration claims or tax outcomes are never authority.

The supported geography remains a United States transaction in one of the 50 states or District of Columbia, with USD exponent two. Other countries and subdivisions return the named value-free `geography_unsupported` state. A stale draft, handoff, billing review, Mission 24 version, commercial terms, tax profile or capability returns a named value-free unavailable state. Exact zero remains a valid recorded amount and missing evidence never becomes zero.

## Preparation, evidence and money

Migration 271 records the exact invoice-date preparation without becoming a second tax engine. For every current Mission 24 charge or fee line it preserves the source line digest, Mission 24 line and tax-group identities, treatment, inclusive/exclusive behavior, exact reviewed rate string, exact taxable basis, exact collected-tax allocation, source class and dates. It verifies that the line set, accepted subtotal, tax and total still match the current issued Mission 24 document. All durable amounts use the released exact USD minor-unit contract; the line allocations must sum exactly to the separately typed collected-tax liability.

The preparation also stores the reviewed service and billing jurisdiction snapshots, an exact matching Mission 24 tax-profile registration snapshot when one unique source exists or `registration_evidence_unavailable`, the customer-exemption snapshot and its evidence reference, and the canonical half-away-from-zero rounding identity. Nexus remains `professional_tax_policy_unavailable`. Credit-note and refund adjustment lineage remains value-free because later owning slices have supplied neither accepted evidence nor an arithmetic effect.

The frozen professional tax policy has not been accepted. Every candidate and saved review therefore reports `tax_authority_unavailable`, `taxAuthorityCurrent: false`, `taxBearingInvoiceAuthorized: false`, and invoice, receivable, issue, filing and revenue-recognition authorization as false. Recording that a human reviewed the preparation does not turn owner-recorded Mission 24 tax evidence into professional policy or a jurisdiction-wide legal conclusion.

## Immutable review and containment

`GET /api/v1/customer-financial/editable-estimates/:estimateId/invoice-draft/tax-review` returns the current candidate or a current saved review. `POST` requires the exact current owner/admin invoice-draft capability grant, membership, session, paid entitlement, CSRF token, purpose, policy version, handoff identity, candidate digest, bounded reason and idempotency key. The database rechecks all authority at effect time, serializes each request and invoice-draft origin, and appends one immutable review plus one minimized request receipt. Exact replay returns the same result; changed key reuse conflicts; superseded source evidence returns value-free stale/unavailable state.

Runtime has execute rights only on the guarded read and record entry points. The source, money, unavailable and saved helpers and both private tables remain inaccessible. Both tables force owner-only row-level security even if a future direct grant is added, and they reject update, delete and truncate. Part 4D performs zero provider calls and zero receiver mutations. It creates no invoice number, invoice, receivable, payment, schedule, work record, estimate revision, credit, refund, communication, accounting record or learning observation.

## Evidence and remaining boundary

Focused writer evidence covers strict response validation, exact zero and exact line/liability reconciliation, supported and unsupported jurisdiction handling, current Mission 24 and billing reconstruction, mounted owner/admin access boundaries, CSRF, purpose and grant checks, immutable record/replay/conflict, source invalidation, privacy, direct-table/private-helper denial, future direct-grant row denial, full migration through 271 and restart. Part 4D adds no rendered surface, so browser evidence is not applicable; original Part 4E owns exact totals, amount due, preview, paid/demo parity, accessibility, responsive/theme states and whole-Part-4 acceptance.

Professional tax review, live compatible tax/provider evidence, nexus determination, accepted credit/refund lineage, accounting and receiving behavior, private production, hosted CI, physical Safari/devices, disaster restore, professional opinions, live-money validation and founder visual approval remain unavailable. Live-money validation remains deferred until the first real paying customer.
