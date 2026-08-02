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
| Production construction | `src/server.js` | Builds `AccountService` and injects signup only when the transactional-email constructor validates the Resend API key, exact source-owned sender mailbox, and exact canonical HTTPS origin. SMTP variables have no B1 capability authority. |
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
| Email | `src/email/transactional.js` | Provider-agnostic security-message boundary over a mounted, source-owned Resend Email API adapter. Both bounded text and HTML bodies are emitted; the operational notification mailer and SMTP are not reused as identity authority. |
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

The mounted B1 production provider is the Resend Email API. Production
construction requires all three of `RESEND_API_KEY`, the exact canonical
`PUBLIC_ORIGIN=https://www.northstar-os.ai`, and the strict bare mailbox
`TRANSACTIONAL_EMAIL_FROM=notifications@northstar-os.ai`. The display name is
source-owned as `NorthStar Notifications`; environment display-name values
cannot override it. Missing, empty, whitespace/control-bearing, oversized, or
wrong-shape keys fail closed. The key remains server-side and is never placed
in browser code, public JSON, logs, snapshots, documentation, or source.

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` no longer construct,
enable, override, or restore B1 delivery. They may still serve unrelated legacy
operational mail code, but there is no mounted Gmail/Nodemailer fallback for
signup, verification resend, or password recovery. Invalid or incomplete
Resend configuration leaves signup at stable `503 signup_disabled` before any
account/token row, cookie, transport, or network effect. Authenticated resend
does not mutate a token when capability is absent, and forgot-password remains
enumeration-safe with no reset-token creation.

Each intended delivery performs one no-retry `POST` to the fixed
`https://api.resend.com/emails` endpoint with manual redirect handling, a
bounded timeout, Bearer authorization, JSON content type, the exact structured
sender `NorthStar Notifications <notifications@northstar-os.ai>`, one
normalized recipient, the existing bounded subject, and bounded source-owned
text and HTML bodies. It emits no `Reply-To`, CC, BCC, or caller-controlled
headers. Verification/reset links use only the canonical HTTPS origin.

The `Idempotency-Key` is a domain-separated SHA-256 digest of the durable action
token row UUID and its purpose. It is stable for one intended delivery,
different after authorized token supersession, at most 96 characters, and
contains no email, raw token, user, organization, session, password, role, or
tenant data. It is neither logged nor returned publicly. The adapter accepts
only a 2xx response containing bounded well-formed JSON and a bounded nonempty
provider message ID. Redirects, network/timeout failures, authentication,
validation, idempotency conflict, rate limiting, server rejection, malformed or
oversized JSON, and missing/invalid IDs produce typed bounded internal
categories without retaining provider response bodies or sensitive identity.

Resend sending-domain verification for `northstar-os.ai` is user-confirmed
configuration context only; this implementation did not independently exercise
or reconfirm provider/domain state. Google Workspace remains the monitored
reply inbox for `notifications@northstar-os.ai`; this code adds no `Reply-To`
and does not enable Resend inbound receiving. No API key was created, requested,
retrieved, inspected, printed, hashed, stored, or used. Production activation,
deployment, and real delivery remain unproven, so local capture success is not
a provider-readiness claim.

Official contract references: [Send Email API](https://resend.com/docs/api-reference/emails/send-email),
[API keys](https://resend.com/docs/dashboard/api-keys/introduction),
[idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), and
[domains](https://resend.com/docs/dashboard/domains/introduction).

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

## Resend transactional-email correction evidence

The Resend correction replaces only the mounted B1 Gmail/Nodemailer SMTP path.
It changes no migration, browser-auth code, trial component, password policy,
admin UI, business authority, Stripe/B2 behavior, or operational notification
mailer. Its exact eleven-file inventory is:

- `.env.example`
- `docs/account-lifecycle-pr-b1.md`
- `src/accounts/service.js`
- `src/email/transactional.js`
- `src/routes/auth.js`
- `src/server.js`
- `tests/api/account-authority-gates-postgres.test.js`
- `tests/api/resend-account-lifecycle-postgres.test.js`
- `tests/helpers/account-production-capability-worker.js`
- `tests/unit/account-lifecycle-b1-policy.test.js`
- `tests/unit/resend-transactional.test.js`

Authentic red-first coverage initially failed all four foundational assertions:
SMTP still constructed capability, Resend-only configuration did not, and the
Resend adapter plus typed error did not exist. After the bounded implementation,
the final focused campaign passed 56/56 across five suites; complete API passed
146/146 across twelve suites; and complete serial Jest with
`--detectOpenHandles` passed 1,177/1,177 across 59 suites with no open-handle
report. PostgreSQL evidence came from loopback PostgreSQL 18.4 with verified
data directory, port, listen address, and server address.

The mounted capture evidence issued exactly one provider-bound request per
signup, authenticated resend, or eligible forgot-password operation. It covered
accepted and rejected signup, accepted and rejected resend, token supersession,
accepted and rejected enumeration-safe recovery, reset/session revocation, no
trial before verification, and one exact 14-day trial only after token
verification. Direct adapter coverage exercised 400, 401, 403, 409, 422, 429,
500, 502, 503, network rejection, timeout/abort, redirect, empty/malformed/
oversized/non-JSON success, and missing/invalid provider IDs. Every destination
was an injected capture boundary for the fixed Resend URL; no DNS lookup,
provider socket, SMTP construction, Google destination, real Resend request, or
automatic retry occurred.

Safe diagnostic assertions excluded the API key, Authorization value,
recipient, sender mailbox, raw action token, message body/link, idempotency key,
user/session/organization identifiers, and provider response body. Public
failure envelopes remained `verification_delivery_failed` or the existing
enumeration-safe recovery response. A rejected signup retained one pending
graph and one hash-only token, with no cookie, session, trial start, duplicate
graph, or paid state.

Intermediate harness evidence is retained: an isolated-checkout Jest invocation
first lacked local `node_modules` and was corrected to the verified sibling
dependency tree; sandboxed `pg_ctl` could not create a Windows restricted token
and the approved disposable cluster was started through the authorized host
boundary; the first complete-serial invocation omitted two required migration
negative-control URLs (1,153 tests passed and 24 fixture cases failed); the next
invocation found those controls empty (1,176 tests passed and one fixture case
failed); and the established archived runner rebuilt their genuine fresh and
upgrade catalogs before the final green campaign. One PowerShell `$1` expansion
also made the first upgrade-seed command syntactically invalid; the disposable
database was recreated and the corrected parameterized command succeeded. No
product source was changed to accommodate these harness corrections.

No HTML or browser JavaScript changed, so the proportionate correction campaign
did not rerun Chrome or Playwright WebKit; prior B1 browser evidence is not
relabeled as Resend evidence, and no physical Safari claim is made. Migrations
001-012, package manifests/lockfile, all tracked data files, and browser-auth/
trial component paths remain object-identical to the immutable base. No new
dependency or migration was added.

## Explicit PR B2 deferral

PR B2 owns Stripe Checkout, Stripe customer/subscription creation, signed
Stripe webhooks, event idempotency, authoritative paid activation,
early-upgrade charging, customer portal, cancellation/past-due handling,
trial-ending transactional reminders if not delivered through a later durable
boundary, banner disappearance after signed paid activation, and tax/payment
production configuration.
