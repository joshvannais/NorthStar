# Mission 27 Part 4C — exact commercial source and typed financial components

Status: released. Accepted head `af14f5cc9feff22c8c9e109919181c0c0501fc4b`, tree `55767bba158fc24d8c835610ea0c5d1e05c45b29`, was normally merged as PR #492 to exact main `90dc034938a8d249daf59a701dd478cd1de2b211`. Sole automatic Railway deployment `32cc565c-77c1-438e-bf06-bd6200844b0b` succeeded with image `sha256:f0c9d0032d694fb06c198ff47dd250cfa8a1e04db1997b8fe2c0ed0577e0f645`, migration 270 after 269 with no 271, and `/api/health`, `/`, and `/demo/` HTTP 200. Part 4D is the current candidate. This record does not authorize tax, calculate amount due, approve or issue an invoice, create a receivable, or perform a provider, payment, credit, refund, accounting or downstream action.

## Exact authority boundary

The private owner/admin read composes one exact-current Part 4B draft with the immutable Mission 24 source already reconstructed by the released Part 4A origin. It returns the pinned issued version and revision, issued and document digests, commercial approval identity and digest, and exact current customer-acceptance identity and digest. It never accepts caller-authored source or amount authority. A stale or malformed origin, Mission 24 source, Part 3 handoff, capability grant, session, membership or subscription returns one named value-free unavailable result.

Mission 27 cannot change the commercial subtotal. A fee, discount, scope change or commercial credit becomes eligible only through a new exact current Mission 24 approved revision and any customer acceptance that source contract requires. The old invoice-draft chain then fails currentness; a newly reviewed upstream handoff and immutable Part 4A origin are required. Part 4C does not relabel a Mission 27 edit as a Mission 24 decision or silently update an existing draft.

## Component vocabulary and anti-double-counting

Migration 270 adds no component table or mutation. Its read-only composition contract preserves the exact USD pre-tax subtotal and names five separate financial components without treating missing evidence as zero:

| Component | Required evidence | Arithmetic role when a later owning slice supplies accepted evidence |
| --- | --- | --- |
| Deposit application | `mission27.native_deposit_payment_receipt` | Subtract from amount due once; an accepted Mission 24 deposit schedule is not a payment receipt. |
| Prior payment | `mission27.native_prior_payment_receipt` | Subtract from amount due once. |
| Credit note | `mission27.native_credit_note` | Adjust document balance once without rewriting commercial price. |
| Refund | `mission27.native_refund_receipt` | Reverse settled-payment effect once; a request is not a completed refund. |
| Tax adjustment | `mission27.invoice_date_tax_review` | Adjust tax liability once without changing the commercial subtotal. |

Each absent component has `state: unavailable`, a stable reason, `value: null`, `provenance: null`, and one exact missing-evidence identity. Component identity and exact provenance are mandatory before any effect, and duplicate effect is forbidden. Retainage, milestone, tip, surcharge, financing and recurring billing remain separately named unsupported shapes. The response deliberately leaves component effect and amount due unavailable for Part 4E. Part 4D alone owns invoice-date tax review. Parts 8 and 9 own accepted payment, settlement, deposit, credit-note and refund evidence.

## Containment and evidence

The mounted `GET /api/v1/customer-financial/editable-estimates/:estimateId/invoice-draft/components` route accepts only the exact handoff receipt identity and digest. It reuses the released owner/admin, subscription, session, capability, purpose and tenant checks inside PostgreSQL. Runtime receives execute privilege only on the guarded read; private helpers and all customer-financial tables remain withheld. The read creates no durable row and reports invoice, receivable and issue authorization as false with provider-call and receiver-mutation counts of zero.

Focused writer evidence covers strict response validation, exact subtotal equality including explicit zero, database-owned Mission 24 identities, missing/unsupported component shapes, caller-field rejection, currentness clearing, mounted access and privacy, direct-helper denial, full migration through 270, retained stale-row upgrade and restart. Part 4C adds no rendered surface, so browser evidence is not applicable here; original Part 4E retains the paid/demo, accessibility, responsive, theme and rendered-state acceptance matrix.

Live-money validation remains deferred until the first real paying customer. Provider/private-production timing, accepted payment or refund evidence, invoice-date tax authority, accounting/receiver behavior, hosted CI, physical Safari/devices, disaster restore, professional opinions and founder visual approval remain unavailable unless separately evidenced. No provider or downstream call occurred.
