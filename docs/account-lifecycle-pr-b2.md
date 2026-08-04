# Account Lifecycle PR B2 billing authority

## Scope and readiness boundary

PR B2 adds a mounted Stripe-shaped billing boundary without contacting Stripe.
It implements monthly Checkout for Starter ($99), Professional ($199), and
Enterprise ($299); signed raw-body webhooks; replay-safe paid activation;
invoice/payment reconciliation; early trial upgrade; the customer billing
portal; cancel-at-period-end; past-due/canceled paid-through access; and the
automatic removal of trial/upgrade banners after signed paid-invoice evidence.

Provider readiness is **unavailable**. The Stripe account, onboarding state,
identity, credentials, webhook secrets, products, prices, tax configuration,
portal configuration, and business details were not accessed or inspected.
No Stripe object was created, configured, read, updated, or deleted. No live or
test provider request, payment, refund, canary, deployment, Railway action, or
production database action occurred. This repository slice does not claim that
paid conversion works against Stripe.

Trial-ending transactional reminders remain deferred to a later durable
delivery/outbox boundary. This slice adds no scheduler or email. Annual plans,
partial-month refunds, immediate cancellation, proration, refund initiation,
administrative money movement, and an owner revenue dashboard are out of scope.

## Mounted authority

PostgreSQL and authenticated tenant membership remain authoritative. Billing
account routes derive the user and organization from the verified session and
require an active owner membership. Request bodies accept only the stable
server-owned plan key for Checkout and an exact empty object for portal and
cancellation. Browser amounts, currency, organization, customer/subscription
identifiers, status, role, entitlement, return query, storage, and claims are
never consulted as authority.

`src/billing/config.js` owns the three mounted monthly plan names and USD base
amounts. Production construction succeeds only when the canonical origin,
server secret, webhook secret, pinned API version, three distinct provider
price IDs, payment-method configuration ID, billing-portal configuration ID,
automatic-tax contract, and tax-ID-collection contract all validate together.
There is no enable boolean and no partial capability. Missing or malformed
configuration leaves every billing route at a bounded `503 billing_unavailable`
before provider transport or billing mutation.

`src/billing/stripeProvider.js` is the injected provider/transport boundary.
Production requests have one fixed Stripe API origin, manual redirects, one
whole-operation deadline through bounded response consumption, no retry, an
idempotency key for mutable operations, and selected-field response validation.
Errors are reduced to bounded transport/status/schema classifications; provider
response bodies are not parsed for failures, logged, or returned. Checkout and
portal responses expose only allowlisted HTTPS destinations (and Checkout
expiry), never provider object IDs or raw provider bodies.

Browser return URLs are fixed same-origin settings URLs. A Checkout redirect or
`checkout.session.completed` can bind provider ownership but cannot activate a
paid state. Only a valid signed `invoice.paid` event matching the source plan,
price ID, base amount, USD currency, organization metadata, customer,
subscription, and bounded monthly period can set verified paid authority and a
paid-through boundary.

## Webhook and reconciliation contract

`POST /api/billing/webhook` is mounted before every JSON parser. Express retains
the exact request bytes in a bounded `Buffer`; the provider adapter validates a
bounded signature header, timestamp tolerance, and HMAC over those bytes before
strict UTF-8 decoding or JSON parsing. Unsigned, malformed, stale, mismatched,
wrong-version, and unsupported-schema evidence fails closed without billing
mutation. Valid but unsupported event types are durably recorded and ignored.

The supported evidence is:

| Event | Authoritative effect |
| --- | --- |
| `checkout.session.completed` | Bind one customer/subscription/plan to the session-derived organization; never activate payment. |
| `invoice.paid` | Reconcile one exact monthly invoice and activate/advance paid authority through the signed period end. |
| `invoice.payment_failed` | Reconcile failure; preserve an unpaid trial or mark already verified billing past due without extending paid-through access. |
| `customer.subscription.updated` | Reconcile past-due or cancel-at-period-end state only for already verified paid authority; never activate or extend a period. |
| `customer.subscription.deleted` | Mark verified authority canceled while retaining access only through the recorded paid-through boundary. |

Migration 013 gives provider event IDs a primary key and records only event
type, timestamp, payload digest, bounded result, and organization reference.
Event insertion and every subscription/invoice change share one PostgreSQL
transaction. Exact duplicate/concurrent delivery is a safe no-op; a reused
event ID with different bytes/type conflicts; rollback leaves no event marker,
so a truthful retry can process it. Per-object event clocks and paid-period
comparison reject out-of-order regression. Unique indexes enforce one
organization owner for each provider customer and subscription ID; historical
or incoming ownership conflicts fail closed.

Checkout creation uses a per-organization advisory transaction lock, a durable
operation row, one active-operation partial unique index, and a stable server
idempotency key. A concurrent duplicate cannot produce a second provider call.
Indeterminate provider outcomes remain blocked until their bounded expiry rather
than being retried automatically. Provider calls occur outside PostgreSQL
transactions.

## Customer access and cancellation

Verified `active`, `past_due`, and `canceled` subscriptions retain full access
only before the authoritative `current_period_end`. At and after that instant
the shared subscription policy makes them restricted read-only. Cancellation
requests only `cancel_at_period_end=true`; local authority remains unchanged
until a signed subscription event confirms it. The customer-facing copy states
that monthly subscriptions are billed in advance, access continues through the
paid period, and partial monthly refunds are not provided.

Trial/upgrade UI reads only `GET /api/account/subscription`. A trial owner sees
the three source-owned monthly choices only when the complete billing capability
exists. Checkout completion leaves the trial banner intact. Reconciliation of
a supported signed paid invoice makes the safe server projection active and the
shared banner disappears on refresh. Portal and cancellation controls appear
only from verified server state.

## Migration 013 compatibility and release disposition

Migrations 001-012 remain protected and byte-identical. New migration
`013_stripe_billing_authority.sql` is a transaction body; the existing startup
runner owns the advisory lock, transaction, checksum ledger, and automatic
application. The migration adds billing evidence/operation/invoice tables,
provider-ownership indexes, source-plan/verified-authority constraints, and
event clocks. It does not fabricate provider IDs, paid status, or verified
authority for any existing row. Existing paid labels default to unverified and
therefore fail closed until later supported signed reconciliation.

The three pre-existing paid-period/cancellation timestamp columns are converted
from timestamp-without-time-zone to `TIMESTAMPTZ` by explicitly interpreting
their existing values as UTC. Before any independently authorized deployment,
release review must inspect production history for provider-ID collisions and
malformed IDs, confirm the historical timestamp convention is UTC, obtain a
restorable database backup, and budget a schema-lock maintenance window. The
migration itself aborts on duplicate/malformed provider ownership.

Rollback is roll-forward by default. The pre-B2 application can run with the
additive tables/columns left in place, but dropping them after billing evidence
exists would destroy authority and is not an acceptable automated rollback.
If the timestamp convention or migration preflight is unsafe, do not deploy.
Restoring pre-migration data requires a separately reviewed backup restoration.
This task neither ran nor scheduled a production migration.

## Later provider-readiness gate

After LLC and Stripe onboarding are complete, a separate explicit active-user
authorization must verify provider identity and configure the exact monthly
prices, payment-method configuration, billing portal, webhook endpoint/secret,
pinned API version, automatic tax, tax-ID collection, and canonical return
origin. That later task must run a provider canary and release checks before any
claim of Stripe readiness or paid conversion. Nothing in this PR performs or
authorizes that work.

Public provider-contract references used for repository design only:
[Webhook signatures](https://docs.stripe.com/webhooks),
[subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks),
[Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create),
[customer portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create),
and [idempotent requests](https://docs.stripe.com/api/idempotent_requests).

## Validation boundary

The B2 unit, mounted API, and browser harnesses use only synthetic configuration,
synthetic signed webhook bytes, a fully intercepted provider function, and a
fresh disposable loopback PostgreSQL 18.4 database migrated through 001-013.
The mounted browser journey covers installed Chrome and actual Playwright
WebKit at 1440x900 and 390x844. Playwright WebKit is not physical Safari.
GitHub checks, provider readiness/canary, physical Safari, production data,
deployment, and real payments remain unavailable unless separately evidenced.
