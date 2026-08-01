# Account Lifecycle PR B1 authority and evidence

## Scope and release boundary

Account Lifecycle PR B1 adds PostgreSQL-owned signup, email verification,
password recovery, and one organization-scoped 14-day no-card trial. It does
not let a customer pay or become paid. Stripe Checkout, Stripe customers and
subscriptions, signed webhook ingestion, event idempotency, paid activation,
early-upgrade charging, customer portals, cancellation and past-due handling,
invoices, taxes, payment production configuration, and automatic banner
removal after authoritative payment confirmation belong to PR B2.

No Railway change, deployment, production database/account access, live email
provider configuration, or real email transmission is part of this slice.

## Mounted authority inventory

| Concern | Mounted executable owner | B1 disposition |
| --- | --- | --- |
| Production construction | `src/server.js` | Builds `AccountService` and injects signup only when the transactional-email constructor validates complete SMTP configuration and a canonical HTTPS origin. |
| Signup | `POST /api/auth/signup`, `src/routes/auth.js`, `src/accounts/service.js`, `src/accounts/repository.js` | Source-disabled with stable `503 signup_disabled` unless the validated capability exists. One durable transaction owns the account graph. No session or cookie is created. |
| Login/refresh/logout/me | `src/routes/auth.js`, `src/auth/middleware.js`, account service/repository | PostgreSQL sessions and refresh-token families remain canonical. Pending and expired users can authenticate; authorization is reloaded from PostgreSQL. |
| Verification status | `GET /api/auth/verification-status` | Returns the authenticated user's safe verification projection. |
| Verification and resend | `POST /api/auth/verify-email`, `POST /api/auth/resend-verification` | Hash-only, scoped, expiring, single-current-token authority. Resend is authenticated, bounded, supersedes the old token, and never changes a trial. |
| Password recovery | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | Enumeration-safe forgot response; transactional password/token update and complete session-family revocation on reset. |
| Account graph | `organizations`, `users`, `organization_memberships`, `notification_preferences`, `organization_account_preferences`, `organization_onboarding`, `subscriptions`, `account_action_tokens` | PostgreSQL only. No JSON/file fallback. |
| Trial status | `GET /api/account/subscription`, `src/accounts/subscriptionPolicy.js` | Membership-derived organization projection; request roles, organizations, dates, and states are ignored. |
| Account preferences/security | `src/routes/account.js` | Available to authenticated owners; operational notification consent defaults false. Expired business mutations are denied by the shared policy. |
| Business Profile/onboarding | `src/routes/businessProfile.js`, `organization_business_profiles`, `organization_onboarding` | Pending users retain draft/read/save onboarding. Signup does not fabricate a Business Profile. Expired mutation is denied. |
| Dashboard reads | canonical/compatibility routers and `src/auth/middleware.js` | Pending low-risk reads and expired restricted reads remain available. |
| Internal mutations | `requireAccountMutation` / `requireOnboardedInternal` in `src/auth/middleware.js` | One current PostgreSQL subscription evaluation; expired, paid-restricted, missing, contradictory, and unavailable authority fail closed. |
| External actions | `requireVerifiedExternalAction` and `src/services/canonicalRetellIngestion.js` | Verification, onboarding, role, membership, and unexpired trial/active subscription are all required. Public Retell ingestion reloads the owning organization's subscription before mutation. |
| Email | `src/email/transactional.js` | Provider-agnostic text-only security-email boundary. The operational notification mailer is not reused as identity authority. |
| Navigation/bootstrap | `public/js/auth-session.js`, `public/js/trial-status.js` | Auth bootstrap consumes the safe server projection; the shared trial component owns one banner and listener set. |
| Customer HTML | `/account/pending`, legacy dashboard, command center, executive brief, leads, communications, calendar, AI settings, Business Profile, My Number, settings, integrations, lead detail, and Polaris | Every authenticated surface imports exactly one shared trial-status component. |
| Tests | `tests/helpers/account-test-app.js`, PostgreSQL suites, two-process workers, lifecycle browser script | Test construction alone may inject a capture adapter and controllable clock. Production construction cannot accept either from a request or boolean. |

The pre-B1 mounted behavior was: public production signup was source-disabled;
forgot/reset were unavailable stubs; no verification delivery existed; no
browser-owned trial claim was accepted; no Stripe payment authority was
mounted; pending users retained `/api/auth/me`, safe dashboard reads, and
Business Profile onboarding/save; and external actions were server-denied
until verification and onboarding. Documentation and source-string tests were
not accepted as proof: the B1 suites exercise mounted routers and real
PostgreSQL authority.

## Frozen B1 contract

Signup normalizes email and enforces case-insensitive uniqueness, the existing
password-hash policy, bounded identity fields, durable PostgreSQL rate limits,
and one transaction. That transaction creates exactly one organization, user,
owner membership, notification-preference row with every operational email/SMS
choice false, organization account-preference row, onboarding row, subscription
in `pending_verification`, and hash-only verification token. It creates no
Business Profile, customer, lead, appointment, estimate, call, communication,
integration owner, voice session, OAuth state, paid subscription, provider
record, login session, refresh token, or cookie.

B1 uses delivery sequencing model B: commit account and token authority, then
attempt synchronous delivery outside the database transaction. A failed send
returns truthful `503 verification_delivery_failed`; the pending account and
token remain recoverable through authenticated resend. No response claims an
email was delivered when it was not. Provider work never occurs while a
database transaction is open, and no delivered link can be rolled back into a
nonexistent token.

Verification/reset tokens use 32 cryptographically random bytes, URL-safe
encoding, and SHA-256 storage only. They are tenant/user/purpose scoped,
single-use, revocable, supersedable, and absent from public JSON, cookies,
browser storage, logs, and audit metadata. Verification expires in 24 hours;
password reset expires in 30 minutes. Verification locks current token/account
authority, activates the email once, preserves onboarding, consumes the token,
and changes only `pending_verification` to `trialing`. Replay, resend,
reverification, malformed/wrong-purpose/foreign/superseded tokens, and
cross-process races cannot restart or extend the trial or fabricate paid state.

Reset validates the canonical password policy, changes the password and
consumes the token in one transaction, revokes every session and refresh-token
family, verifies no active credential remains, clears auth cookies, and does
not log the caller in. It does not alter verification, membership, role,
organization, preferences, onboarding, or subscription timestamps/state.

## Trial and subscription authority

The trial belongs to the organization and begins only on successful email
verification. PostgreSQL/server UTC supplies `trial_started_at`; the end is
exactly `trial_started_at + interval '14 days'`. Signup consumes no trial time.
Browser clocks, query/body fields, cookies, all browser storage, globals,
roles, and supplied organization IDs have zero subscription authority.

B1 recognizes `pending_verification`, `trialing`, `expired`, `active`,
`past_due`, and `canceled`, but creates or transitions only the first three.
`active` is exercised only by an explicitly identified PostgreSQL test fixture;
there is no public mutation to create it. Paid labels are reserved for signed
Stripe authority in B2.

The status projection contains only state, trial start/end, server timestamp,
derived remaining days, read-only status, unavailable upgrade status, and
banner visibility. Remaining days are `ceil((trial_ends_at - server_now) /
86400000)` while the instant is valid, so an unexpired trial never displays
zero. The last positive calendar window is rendered as `Trial ends today`.
`upgradeAvailable` is `false` for every B1 projection, including pending,
trialing, expired, active, past-due, canceled, missing, malformed, and
contradictory authority. An `active` PostgreSQL fixture proves only banner
suppression; it does not prove payment or upgrade capability.

At and after the exact end instant, the row is transactionally observed as
`expired`. Authentication, logout, `/me`, account/security access, safe
subscription reads, organization data, and restricted dashboard reads remain.
Business data is preserved. Internal business mutations, provider/background
actions, customer communication, Retell/voice, Jobber/calendar, exports,
handoff/cancellation, estimates, appointments, simulations, and leads fail at
the server boundary. `past_due`, `canceled`, missing, malformed,
contradictory, foreign, and unavailable authority are read-only/fail-closed.
PostgreSQL failure returns a bounded unavailable response and never falls back
to browser or file authority.

## Shared banner experience

`public/js/trial-status.js` is the single reusable component. It calls the safe
organization status read, stores no authority, creates one accessible status
region and listener set, and remains idempotent across repeated bootstrap and
navigation. Pending accounts see a verification banner. Valid trials see the
organization-wide daily countdown. Expiration replaces it with restricted
upgrade-required messaging with no enabled billing action; billing is
explicitly unavailable until B2. Active organizations see no banner. Unsafe or contradictory responses
show restricted/unavailable state and never false paid state. Styles cover
1440x900 and 390x844 without navigation collision and use keyboard-readable,
high-contrast semantics.

## Migration 012 and existing organizations

`012_account_verification_trial.sql` is the only new migration and contains a
transaction body only. The advisory-locked production runner owns transaction
and ledger insertion. It adds exact state/trial constraints, one subscription
per organization, trial cleanup indexes, scoped hash-only action-token
authority, a single-current-token partial unique index, and the bounded rate
event vocabulary.

No pre-B1 organization silently receives a trial. Legacy `trial` rows become
restricted `expired` rows while their historical end is preserved and no start
is inferred. Existing `active`, `past_due`, and `canceled` labels and paid-period
fields are preserved for later signed reconciliation; B1 cannot create those
states. Unsupported or multiply-owned historical subscription authority aborts
the migration for explicit resolution.

## Email configuration and limitations

The production constructor requires a multi-label DNS SMTP hostname whose
labels have valid length and hyphen placement, the exact port 465 or 587,
bounded control-free identity/password fields, an explicit single mailbox
sender, and a canonical ASCII HTTPS public origin with no path, query,
credentials, or fragment. It rejects empty labels, dot-only/leading/trailing
dot hosts, schemes, ports, paths, whitespace, controls, malformed mailbox
local/domain parts, and coercible non-string identity input. It derives
recipients, sender, templates, and callbacks on the server; rejects header injection, unsafe origins, unbounded
values, and raw HTML; never exposes or logs secrets/tokens; and returns stable
internal outcomes. Environment booleans cannot enable signup. With no valid
provider configuration, production signup remains disabled with stable
`503 signup_disabled`, zero account-graph/token rows, zero cookies, and zero
transport, send, DNS, network, or TLS effects. Therefore B1 does not claim live
production signup readiness.

Only the in-app daily countdown ships. A later email-capable release should
send transactional reminders at seven, three, and one day remaining using a
durable scheduler/outbox. B1 deliberately adds no unreliable in-process timer.

## Targeted independent-audit correction

The independent audit identified three historical blockers: verification and
reset tokens reached the same-origin stylesheet through `Referer` before URL
cleanup; malformed SMTP identities could construct production signup
capability; and restricted B1 states falsely reported upgrade availability.
Those three findings, and only those findings, are corrected by the additive
delta after original PR head `c3475457b60f193f6db15c52fa80f6eba9e810b2`.

Both token pages now install page-level `no-referrer` before every subresource.
The first executable head script captures exactly one syntactically valid token
into a lexical closure and synchronously replaces the query-bearing history
entry with the fixed page path before CSS can load. The token is cleared after
terminal validation, success, server error, or network error. It is never put
in the DOM, a window property, cookies, local/session storage, IndexedDB, logs,
or response bodies. The browser harness explicitly inventories request URLs,
methods, resource types, redirect chains, `Referer`, main-frame navigation and
retained back/forward history, storage, IndexedDB, globals, console, page
errors, cookies, and API bodies. The unavoidable initial user navigation is
recorded once; every initiated subresource has an empty `Referer`, and retained
history and subsequent requests contain no raw or encoded token.

The additive correction touches exactly these eleven files:

- `public/verify-email.html`
- `public/reset-password.html`
- `src/email/transactional.js`
- `src/accounts/subscriptionPolicy.js`
- `tests/browser/account-lifecycle-b1-browser.js`
- `tests/helpers/account-production-capability-worker.js`
- `tests/unit/account-lifecycle-b1-policy.test.js`
- `tests/api/account-authority-gates-postgres.test.js`
- `tests/api/account-lifecycle-b1-postgres.test.js`
- `tests/api/jobber-oauth-state-postgres.test.js`
- `docs/account-lifecycle-pr-b1.md`

The intended linear additive subjects are `fix: contain account action tokens
before subresources`, `fix: reject invalid production email capability`, and
`fix: keep b1 upgrade capability unavailable`. The exact published SHA of this
document's own containing commit is necessarily external metadata (a Git
commit cannot contain its own hash); the live draft PR description and final
publication report record the exact final head, parent, all commit SHAs, and
the final diff after publication.

## Validation evidence

The original B1 campaign used disposable PostgreSQL 18.4 only and recorded the
following pre-correction implementation totals:

- focused migration: 24/24;
- focused signup, verification, and reset: 28/28;
- focused trial and gating: 23/23;
- complete API: 141/141;
- complete serial Jest: 1,155/1,155;
- four-worker Jest: 1,155/1,155, seed `731412`;
- complete `--detectOpenHandles`: 1,155/1,155 with no reported open handle;
- changed/new JavaScript: 28/28 files passed `node --check`;
- changed HTML: 19 documents and 38 complete inline scripts parsed;
- authenticated HTML: 14/14 documents import the shared component exactly once;
- `git diff --check`: passed.

The targeted correction campaign then passed focused migration 24/24, focused
account-lifecycle 53/53 across five suites, complete API 143/143 across eleven
suites, and complete serial Jest 1,157/1,157 across 57 suites with
`--detectOpenHandles` and no open-handle report. Four-worker Jest was not rerun:
focused, API, and serial execution exposed no correction-attributable
concurrency or interference.

The corrected complete lifecycle ran once in installed Chrome and actual
Playwright WebKit at 1440x900 and 390x844. Each of the four implementation
journeys recorded 470 loopback requests, 40 method/path families, 16 explicit
verification/reset confidentiality cases, 38 initiated requests with captured
Referer values, 12 deliberately recorded initial raw main-frame navigations,
six synthetic token API posts, exactly two captured local security emails, one
mounted verification, and one mounted reset. Chrome recorded 58 and 59 safe API
response bodies; WebKit recorded 69 and 70. These are the final implementation
run totals, not a promise that incidental request counts are identical in every
execution. The prior independent audit separately proved the historical
stylesheet-Referer disclosure; its incidental request/API totals were not
supplied as authoritative correction evidence and are not relabeled here.

Every HTTP destination was the disposable loopback app; no Authorization
header, credential-bearing API body, unexpected mutation, enabled upgrade
action, Stripe/payment navigation, or false paid state was observed. Reload,
back, forward, duplicate initialization, two tabs, browser restart, forged
browser authority, expiration, mutation denial, and active-fixture banner
suppression were exercised. No physical Safari claim is made.

Required skipped tests were not counted as passing. GitHub CI availability is
reported from the published draft; zero checks will be recorded as unavailable,
never passing. No merge, deployment, Railway or production configuration,
production database/account access, live email, SMTP provider, Stripe, payment,
or provider action occurred during the correction.

## Explicit PR B2 deferral

PR B2 owns Stripe Checkout, Stripe customer/subscription creation, signed
Stripe webhooks, event idempotency, authoritative paid activation,
early-upgrade charging, customer portal, cancellation/past-due handling,
trial-ending transactional reminders if not delivered through a later durable
boundary, banner disappearance after signed paid activation, and tax/payment
production configuration.
