# Mission 27 Part 4E — exact totals and invoice-draft preview

Status: implementation candidate for original Part 4E and the remaining Q8 gate. It does not accept Part 4 or Part 4E, begin Part 5, approve or issue an invoice, create a receivable, establish professional tax policy, calculate an amount due from missing evidence, generate an immutable customer invoice or PDF, deliver a document, recognize revenue, or perform any provider, payment, credit, refund, accounting or downstream action.

## Exact-current paid composition

`GET /api/v1/customer-financial/editable-estimates/:estimateId/invoice-draft/preview` is an owner/admin, paid-entitlement, current-session read. It accepts only the exact reviewed Part 3 handoff receipt identity already required by Parts 4A–4D. The guarded PostgreSQL entry point composes, within one database statement, the current Part 4B draft, Part 4C typed components, and Part 4D invoice-date preparation. It rejects a mismatched origin, revision, draft digest, history-chain digest, component digest, preparation digest, line set or line digest with a named value-free unavailable result.

The server reconstructs every displayed line from the immutable draft and reviewed tax preparation. It verifies that allocated line amounts sum to the exact accepted pre-tax subtotal, preserves collected tax as a separate liability, and adds the exact USD minor-unit subtotal and prepared-tax values only inside the database. The browser formats returned decimal strings; it performs no money arithmetic.

The prepared document total remains `preparation_only` because professional tax policy is unavailable. Amount due remains named unavailable because accepted native deposit, prior-payment, credit-note, refund, professional-tax and invoice-issue evidence do not exist yet. Missing evidence never becomes zero. Exact zero is displayed only when an authoritative component explicitly carries exact zero.

## Read-only document preview and later authority

The rendered document preview contains bounded customer-safe descriptions, grouping, quantities, exact amounts, prepared tax and the preparation-only total. It clearly states that the draft is not issued and cannot be approved, delivered, collected or treated as a receivable. Immutable invoice HTML/PDF generation remains assigned to Part 6A after Part 5 has approved and issued one exact version; Part 4E therefore reports the PDF as value-free unavailable instead of manufacturing an issued document.

The preview creates no number reservation, invoice, receivable, payment, schedule, work record, estimate revision, tax decision, credit, refund, communication, accounting record or learning observation. Runtime receives execute permission only on the guarded read entry point. The value-free helper remains private, and all source tables retain their released access and row-isolation boundaries.

## Fictional demo and rendered behavior

The account-free demo route projects the same preview contract from one deterministic fictional canonical graph. It is explicitly labeled fictional, never reads paid/customer rows, never calls a paid or external provider, and never falls back to paid data. Demo reset recreates the deterministic source through the existing isolated demo authority; the preview itself is read-only.

The shared mounted module appears on every paid estimate surface and the fictional demo. Each load has a mount and request generation, so an older delayed response cannot replace a newer preview. Every denial, conflict, stale or failed load clears lines, prices, totals, capability implications and actions before exposing a focused status and retry. Recovery reloads exact current evidence. Keyboard operation, genuine skip navigation, stable focus, light/dark themes, reduced motion, forced colors, responsive tables and phone controls are covered across the frozen five layouts in Chrome and Playwright WebKit.

## Candidate evidence and remaining boundary

Focused writer evidence covers strict server and browser contracts, exact subtotal/tax/prepared-total reconciliation, explicit zero versus unavailable, source/digest/currentness conflicts, mounted owner/admin and tenant boundaries, runtime/private-helper denial, source staleness, read-only repeatability, restart, resettable fictional demo isolation, delayed same-mount races, clearing, retry and accessibility. Fresh disposable PostgreSQL 17 applies migration 272 after 271 and retains the released inclusive- and exclusive-tax paths.

Independent whole-head audit, PR, normal merge, sole automatic deployment, migration/health verification and Part 4 acceptance remain pending. Professional tax review, compatible live providers, native deposit/payment/credit/refund receipts, invoice issue, immutable invoice PDF, accounting and receiver behavior, private production, hosted CI, physical Safari/devices, disaster restore, professional opinions, live-money validation and founder visual approval remain unavailable. Live-money validation remains deferred until the first real paying customer.
