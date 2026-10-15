# Mission 27 Part 10C — Reviewed collection handoff and manual resend readiness

Part 10C adds the tenant-private readiness contract between the released Part
10B collection review and either a later Mission 28 reminder handoff or a
separately founder-ratified, human-triggered payment-link resend. It does not
send a reminder, create or reuse a checkout, resend a link, contact a customer,
charge an instrument, mutate a financial record or create delivery evidence.

`GET /api/v1/customer-financial/collection-handoff` is a private, no-store,
owner/administrator read. It consumes the exact complete Part 10B projection.
The current Part 10B source has no complete receivable population, selected
next step, issued invoice, reviewed recipient or action witness, so Part 10C
returns `receivable_population_incomplete` with no tenant, customer, invoice,
amount, recipient, message, link, request, actor or delivery value.

## Two distinct paths

The server fixes the ordered paths as
`mission28_reviewed_reminder_handoff` and `manual_payment_link_resend`. A Part
10B next-step choice is review evidence only; it never becomes execution
authority.

The Mission 28 path preserves the exact launch requirements: a bounded current
collectible balance; exact invoice version and reviewed recipient; current due,
dispute and pending-tender axes; exact message preview; idempotency and
cooldown; and the current receiving adapter. The reviewed handoff contract is
supported, but `mission28.collections_reviewed_handoff.v1` has no current
receiver, so the exact state remains `mission28_handoff_unavailable`. Mission
27 cannot send the communication, and automatic execution is unsupported.

The manual path is separately unavailable. It requires explicit founder
ratification of this human-triggered behavior, the exact current issued invoice
and document, one current customer-started exact hosted-checkout session, one
reviewed recipient and delivery choice, an exact message preview, both the
collection-action and invoice-send capabilities, current balance and hold
axes, recent authentication/MFA and conditional control, exact idempotency and
cooldown state, current delivery authority and immutable delivery evidence. It
may redeliver that current link only after every gate passes; it cannot reuse a
terminal, expired or superseded provider session or let staff create a checkout. Missing
ratification or authority never degrades into a generic resend.

## Preview, replay, cooldown and delivery truth

The contract freezes server-validated message-preview, action-receipt and
delivery-evidence shapes. A preview binds the current invoice, recipient,
delivery choice and hosted-checkout session by digest; raw URLs, tokens,
provider objects and secrets are forbidden. The idempotency key binds one exact
request digest. Changed invoice, recipient, preview, path or amount requires a
new request. Exact replay cannot exceed the original request, and neither role
nor retry can bypass an unknown cooldown. No cooldown duration is invented:
the current policy version, trusted-clock evaluation and next eligible time
must all exist before an action can become available.

The request receipt and delivery evidence remain separate, immutable records.
A receiver acknowledgement or queued state is not delivery evidence, and
missing or unknown evidence cannot be presented as delivered. Part 10D owns
failure, retry and revocation behavior and the complete rendered acceptance.

## Access and evidence boundary

Role alone never authorizes either path. Both require the exact current tenant
session, active subscription, `customer_financial.collection.action`, recent
authentication and MFA. The manual resend also requires
`customer_financial.invoice.send`. Single control ends at USD 10,000.00;
amounts above it through the USD 100,000.00 maximum require two different
current eligible humans. Missing amount, selected path, balance, hold,
recipient, adapter or currentness evidence denies the action.

HEAD, OPTIONS and every write method fail closed before source/repository
entry. There is no mutation route, database table, migration, demo endpoint,
provider call, receiver mutation, accounting mutation or money movement.
Focused unit/static evidence validates policy, lineage, exact ordered paths and
requirements, preview/receipt/cooldown semantics, malformed-contract rejection
and route denial. Fresh disposable local PostgreSQL 17 evidence covers
owner/admin reads, session/role/tenant/subscription/query/method denial,
restart, migration 272 remaining latest with no 273, zero residue and zero
external transport. Browser evidence is not applicable because Part 10C adds no
rendered, demo, public or customer surface. Founder visual approval remains
separate and ungranted.
