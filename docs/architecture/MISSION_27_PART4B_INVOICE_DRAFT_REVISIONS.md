# Mission 27 Part 4B — append-only invoice-draft revisions

Status: released. The accepted head `fc3157428be6edd1191e720873a22787cd3ac10c`, tree `16b50682ad5c2a99595ecb76529294761855710b`, was normally merged as PR #491 to exact main `50c2eab5dc462739069d28c93b425ef4b02b0b2a`. Sole automatic Railway deployment `07b6e6e9-076c-453b-a9ce-7d3a4c9e1a48` succeeded with image `sha256:8a1341eb5ced77f835fbd80f14e2da08dccc6b95d1149bc4e21ce54a0b2f6824`, migration 269 after 268 with no 270, and `/api/health`, `/`, and `/demo/` HTTP 200. Part 4C is released; Part 4D is the current candidate.

Part 4B lets a current owner or admin revise customer-facing wording, grouping, and allocations over one exact-current Part 4A origin. It does not create or alter Mission 24 price authority. Every revision retains the exact source-line identities and exact line count, and PostgreSQL recalculates every allocation in USD minor units. The resulting subtotal must equal the immutable Part 4A subtotal exactly, including an explicit zero.

## Guarded revision contract

The mounted private read returns either the source-origin revision zero, the latest accepted human revision, or a named value-free unavailable state. A save requires the released `customer_financial.invoice.edit_draft` capability, exact tenant, actor, membership, session, estimate, business purpose and policy, current paid entitlement, CSRF, an idempotency key, explicit confirmation, a bounded reason, and the exact current revision and draft digest. The database reconstructs the current Part 4A and Mission 24/23 source before accepting the edit. Caller-provided source identities and totals are never authority.

Each accepted revision is immutable and chained to the prior exact draft digest. Optimistic concurrency permits one winner. Exact replay succeeds only while its revision remains latest; changed key reuse and replay after supersession fail value-free. Source invalidation clears wording, groups, amounts, lines, grants, and action state from the response. Direct runtime table access and private helpers remain denied.

The edit payload is deliberately narrow: each original line appears exactly once, in deterministic ordinal order, with its original line digest. The authorized user can change the bounded customer-safe description, assign a bounded customer-facing group, and reallocate nonnegative exact minor units among those lines. PostgreSQL reconstructs exact-money objects and refuses missing lines, repeated identities, extra fields, out-of-range values, or a changed total. These revisions do not change quantities, scope, accepted option, tax, amount due, invoice approval, number, issue, receivable, delivery, payment, work, schedule, learning, provider, or receiver state.

## Evidence and later boundaries

Accepted Part 4B evidence covers clean migration 269, the real mounted owner/admin routes, exact-total recalculation, source-line coverage, wording/group edits, allocation changes, exact replay and changed reuse, concurrent optimistic winners, superseded replay, source staleness, tenant/role/CSRF isolation, immutability, runtime privilege denial, restart, and zero invoice/number/provider/receiver mutation. Part 4B adds no rendered surface; Part 4E retains browser, accessibility, paid/demo parity, and visual acceptance ownership.

Part 4C remains the only next slice and owns amount-changing commercial revisions plus separately typed deposits, prior payments, credits, refunds, and tax adjustments. Part 4D owns invoice-date tax review. Part 4E owns amount-due reconciliation and preview. Part 5 owns approval, numbering, issue, and receivable creation. Live-money validation remains deferred until the first real paying customer; no provider or downstream evidence is claimed.
