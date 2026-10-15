# Mission 27 Part 10A — tenant-private receivable population and aging

Status: implementation candidate for original Part 10A. This slice adds one owner/administrator, tenant-private, read-only `GET /api/v1/customer-financial/receivables` boundary. It does not add a collection action, customer/public route, demo route, financial record, provider call or external effect. Part 10D owns rendered paid/demo acceptance.

## Source and coverage truth

The route requires the current PostgreSQL-backed tenant session, membership and subscription. It never treats invoice drafts, estimates, simulated labels or legacy revenue fields as issued receivables. The runtime has no immutable issued-invoice/receivable population, so the response is the typed, value-free `receivable_population_incomplete` state. `coverage.complete` and `coverage.completenessProven` remain false; total population, as-of time and every money aggregate remain null. The emitted row count is zero, but that fact never claims the tenant has zero receivables.

The exact incomplete states separately name unavailable population, balance, due-date, trusted-clock, dispute/refund-hold, contactability and projection-currentness evidence. A partial result can never be presented as complete. Every eventual row must bind the current issued invoice and version, customer identity, USD issued and outstanding amounts, issued due date, aging bucket/days, separate dispute and refund holds, reviewed contactability, and append-only projection revision/digest.

## Aging, holds and contactability

Aging uses an exact issued due date in the tenant business timezone and a trusted server clock. Its ordered vocabulary is `not_due`, `due_today`, `overdue_1_30`, `overdue_31_60`, `overdue_61_90`, and `overdue_91_plus`. An absent due date never becomes due today, an absent balance never enters a bucket, and exact zero is not an open receivable. Due or overdue status grants no reminder, fee, collection, suspension, retry or charge authority.

Dispute and refund holds remain separate from the issued and outstanding amounts. A pending hold blocks collection review; it does not erase or rewrite the balance and does not authorize contact. Contactability requires current reviewed recipient evidence and is separately `contactable`, `not_contactable` or `unknown`. Delivery evidence and a staff role cannot substitute for recipient review or consent. The current response exposes no customer, recipient, invoice, amount, due-date, dispute, refund, collection-note or promise value.

## Effects and later ownership

The frozen launch contract supports internal aging review and a later promise-to-pay record. Part 10B owns the capability-gated human collection review and promise-to-pay workflow; Part 10C owns reviewed Mission 28 reminder handoff or separately ratified manual resend; Part 10D owns failure/recovery, privacy, paid/demo UI and whole-Part-10 acceptance. This slice authorizes none of those actions and creates no provider, receiver, accounting or money effect.

Focused unit/static and fresh disposable local PostgreSQL 17 evidence cover the exact ordered contract, missing/reordered/contradictory/leaked rejection, owner/admin access, tenant/subscription/query/method denial, private no-store headers, restart, zero residue, migration 272 remaining latest with no 273, and zero provider transport. Browser evidence is not applicable because Part 10A adds no rendered or demo surface.
