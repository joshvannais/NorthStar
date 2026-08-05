# Durable trial-ending reminders

## Scope and authority

This provider-independent Account Lifecycle slice implements the exact B1
handoff: organization-scoped transactional trial-ending email at 7, 3, and 1
days remaining. PostgreSQL is the only scheduling, clock, tenant, subscription,
ownership, destination, lease, retry, and terminal-state authority. A one-shot
worker is available at `node scripts/run-trial-reminders.js`; an external
durable scheduler may invoke it. The application starts no interval, cron job,
or other in-process timer, and this change makes no Railway scheduling change.

The current `subscriptions` row must be `trialing`, have an exact fourteen-day
`trial_started_at`/`trial_ends_at` pair, and remain unexpired according to
PostgreSQL `clock_timestamp()`. The organization must have exactly one active
owner membership whose owning user is active (email-verified in B1 authority).
The destination is the current `notification_preferences.notification_email`,
validated by the same bounded transactional-email address grammar used at
delivery. Browser state, request input, role claims, files, and operational
marketing preference booleans have no authority.

These messages are mandatory lifecycle notices about a currently running
NorthStar trial, analogous to account-security mail. They do not advertise a
product, price, payment method, or promotion and therefore are not controlled
by the opt-in booleans for new-lead, call-summary, appointment, or SMS traffic.
An empty or malformed destination, a missing or nonunique verified owner, or
contradictory subscription authority cancels or suppresses the reminder without
calling the provider.

## Scheduling, concurrency, and delivery

Migration `014_trial_reminder_outbox.sql` stores one logical row per
organization, subscription, exact `trial_ends_at`, and threshold. Its check
constraint fixes `scheduled_for` to the end instant minus exactly 7, 3, or 1
twenty-four-hour UTC days. Reconciliation creates all future rows, cancels stale
rows when authority changes, and terminally cancels an earlier due threshold
when a later threshold is already due. A delayed worker therefore sends at most
the most recent applicable reminder rather than bursting accumulated mail.
Nothing sends at or after the trial end instant. The message identifies the
scheduled threshold but says the trial is ending soon, avoiding a false exact
time-remaining claim when a durable worker is delayed.

Workers claim one due row at a time with `FOR UPDATE SKIP LOCKED`, increment a
bounded attempt counter, and commit a two-minute lease. The provider call occurs
only after that transaction commits. Immediately before delivery, the worker
re-reads the exact subscription, owner, destination, recipient hash, lease, and
expiry authority. The durable row UUID is the stable Resend idempotency input
across every retry and crash/lease recovery. Provider calls are bounded by the
existing ten-second adapter deadline.

Failures use exponential backoff beginning at 5 minutes and capped at 60
minutes, with at most four claims.
A retry that would cross the trial end becomes terminal `failed`; expired leases
are recovered with the same idempotency key. Rows end as `sent`, `canceled`, or
`failed` with a bounded source-owned code. A sent row requires a validated
provider message ID. Recipient addresses, provider response bodies, API keys,
tokens, and secrets are not stored in the outbox or logged by this worker.

The email contains bounded plain text and HTML and only a canonical-origin
`/login` link. It makes no Stripe-readiness, paid-activation, price, tax,
invoice, refund, portal, or payment claim.

## Migration 014 release plan

**MIGRATION RELEASE PLAN: NOT APPROVED.**

Migration 014 is an additive table plus three indexes and is schema-independent
from migration 013. Migrations 001-012 remain byte-identical, and this branch
does not copy or modify PR #80's migration 013. Nevertheless, release order is
a hard gate: PR #80's independently reviewed `013_stripe_billing_authority.sql`
must merge and apply first. The one-shot CLI performs a read-only ledger check
for the exact reviewed migration-013 checksum before it permits the normal
production migration runner to apply 014.

Compatibility is forward-only: current application code does not read the new
table, and 014 neither rewrites nor backfills existing account rows. Automatic
migration remains owned by `src/db.js` under its transaction-scoped advisory
lock. A production release must not begin until a separately authorized,
read-only preflight verifies the exact 001-013 ledger and checksums, database and
session UTC interpretation, supported subscription history, absence of
conflicting 014 objects, expected row volume, and an acceptable lock window.

Before production mutation, an independently verified restorable backup/PITR
point and a completed restore rehearsal are required. The approved release must
coordinate the forward migration, application revision, and external scheduler
enablement. Operational rollback is roll-forward: disable scheduler invocation
and deploy corrected code while retaining the additive evidence table. Schema
removal or restoration is permitted only under a separately approved restore
plan. No production history, lock timing, backup, restore, Railway, provider,
or configuration evidence is available in this PR, so merge and deployment
remain prohibited.

## Exclusions and unavailable evidence

No Stripe, Retell, phone, voice, global script, payment, tax, invoice, refund,
portal, webhook, homepage, live simulation, Polaris, Mission 19 Part 4,
production database, Railway, provider account, provider canary, real email,
secret, or configuration action is part of this slice. Local provider transport
is intercepted. GitHub CI with zero statuses/checks/workflow runs is unavailable,
not passing.
