# Account Lifecycle PR A

This change establishes PostgreSQL as the only runtime authority for account identity, organization ownership, memberships, current subscriptions, account preferences, onboarding state, browser sessions, refresh families, and authentication abuse controls.

## Final bounded correction boundary

The independent micro-review of published head `9ec1812630a54be3811ec94155824abc868cecdd` found three issues that were unresolved at that head: fresh and historical migration-ledger paths did not have the same physical column order, mounted Jobber OAuth state exposed readable durable identifiers, and BroadcastChannel deduplication retained unvalidated or unbounded coordination history. The additive correction after that head is limited to those findings, their authentic tests, and this evidence account. The exact final commit topology and immutable head are recorded in draft PR #71 after publication.

The validation described for this correction is local implementation validation. It is not independent re-review, approval, CI, production-readiness, or deployment evidence. PR #71 remains draft until a new independent micro-review is completed.

The published correction topology begins at the unchanged 18-commit head `9ec1812630a54be3811ec94155824abc868cecdd`, followed linearly by `44e7c192df4258bef5b2df54f4ad327484901d27` (physical ledger), `b20772e2802211c10000bcf0068dfaf966518cf3` (opaque Jobber state), `83fac1e3434b29a7b567d4adb94ae57e7b692464` (bounded browser coordination), and this documentation commit. The result is exactly 22 linear commits above base `dfff096241d3be4fd1580a741cfe21ee64a5dfb3` with zero merge commits. The draft PR description records the documentation commit's exact final SHA and parent after publication; a commit cannot truthfully embed its own content-derived SHA.

## Frozen lifecycle

- The production server does not receive a signup capability. No environment value can enable public signup during PR A; the endpoint returns a bounded unavailable response without writes or cookies. PR B must make a reviewed source-level capability change.
- Disposable tests inject the real signup transaction into a test-owned application. Signup normalizes email by trimming and lowercasing only, accepts passwords from 12 through 128 characters, and atomically creates the organization, pending-verification user, owner membership, 14-day trial, notification preferences, onboarding row, session, and refresh family.
- Pending-verification accounts retain authenticated tenant access: `/api/auth/me`, verification status, refresh, logout, tenant-scoped dashboard reads, Business Profile onboarding, the initial Business Profile save, and strictly internal onboarding configuration.
- Email verification and onboarding are independent PostgreSQL states. Saving the first active Business Profile completes onboarding but never verifies the email. Provider/customer-facing actions require both verification and completed onboarding, plus a current session, active membership, tenant, and role.
- An existing active canonical Business Profile makes onboarding `complete`. Persisting the first active profile updates the onboarding row in the same PostgreSQL transaction.
- The historical JSON user registry is neither read nor imported by any mounted authentication path. `data/users.json` remains protected evidence.

## Browser credential contract

`northstar_access` and `northstar_refresh` are `HttpOnly`, `SameSite=Lax`, `Path=/` cookies. They are `Secure` in production. The access JWT contains only the user and session identifiers; organization and role authorization are reloaded from PostgreSQL on every request.

`northstar_csrf` is deliberately readable by the shared browser client and is not an authentication credential. Every cookie-authenticated state-changing request must send its value in `X-CSRF-Token`; the server also compares its hash with the current session row. Refresh rotates both refresh and CSRF values, so missing, wrong, stale, and cross-session values fail.

`public/js/auth-session.js` is the only browser authentication client. It retains account projections only in memory, loads identity through `/api/auth/me`, retries once after a successful refresh, routes lifecycle states, and performs server-side logout. Browser storage may still contain presentation theme and per-tab simulation metadata, but never access tokens, refresh tokens, users, organizations, or roles.

Each protected request captures a non-secret authentication generation before transmission. Responses from one expired-access wave join one refresh rotation; callers whose captured generation is already stale retry once without another rotation. Same-origin tabs coordinate that rotation with Web Locks and a non-authoritative BroadcastChannel outcome, with a bounded IndexedDB lease fallback where Web Locks are unavailable. A failed outcome is attached to every still-active capture from that wave, so pruning non-authoritative history cannot change a delayed original caller's result.

BroadcastChannel messages share exactly seven fields: protocol, document ID, type, attempt ID, success, generation, and timestamp. Local-storage coordination adds only epoch and bounded outcome ordering; the IndexedDB lease adds only lease owner and expiry. The in-memory BroadcastChannel dedupe retains at most 256 keys for 60 seconds of local receipt time, per-document ordering retains at most 128 entries for 60 seconds, and failed-wave summaries retain at most 64 entries for 120 seconds. All are opportunistically pruned without a perpetual timer. No credential, cookie, session ID, user identity, organization identity, role, email, or provider token is shared. Forged coordination metadata can affect retry timing only: PostgreSQL sessions, memberships, tenants, roles, verification, and onboarding remain the sole authority, and a retry never recursively refreshes.

User Bearer compatibility is retired. A Bearer request receives the same stable unauthorized response regardless of environment flags or claims; the browser client never constructs an Authorization header.

## Session and replay behavior

Refresh credentials are stored only as SHA-256 hashes. Every session has one active refresh token in a family. Rotation is a row-locked transaction that consumes the current token, inserts its replacement, and rotates access/CSRF state. Reuse of a rotated token marks it reused, revokes the active replacement and session, and prevents the family from continuing across processes.

Logout validates the refresh/CSRF pair, locks its durable authority, and transactionally revokes the session plus every active token in the family/session. Cookies are cleared only after commit. HTTP, CSRF, network, or PostgreSQL failure stays visible and retryable in the browser; it does not redirect or claim success.

## Notification preference authority

`notification_preferences` is the sole mounted authority for operational email and SMS choices. All five delivery choices default to `false`; a signup phone or email is only a destination and does not imply consent. Account-security email is mandatory and is not controlled by these fields. Business Profile JSON and browser storage cannot override operational delivery choices.

The generic `organization_account_preferences` row retains only unrelated internal presentation/configuration values. Migration 010 removes operational notification keys from that JSON and prevents them from being reintroduced. Because no durable explicit-consent provenance exists for upgraded legacy booleans, migration 010 deterministically sets all operational delivery choices to `false` while preserving unrelated preferences and notification destinations.

## Jobber OAuth authorization state

Jobber is the only mounted OAuth authorization-state producer in this repository. Its provider-bound state is exactly 32 cryptographically random bytes encoded as a bounded 43-character base64url value. It contains no JWT, JSON, user, durable session, tenant, organization, role, email, or other durable identifier. PostgreSQL stores only the SHA-256 hash and binds it to provider, organization, user, current durable authentication session, creation, expiration, and consumption state.

Migration `011_oauth_authorization_states.sql` is a transaction-body-only additive migration. It creates the dedicated organization-scoped state table, its composite session/tenant foreign key, unique state hash, ten-minute expiration contract, status/time checks, and bounded-cleanup indexes. Issuance and consumption use real PostgreSQL transactions. Consumption row-locks the state, requires exact provider and current request bindings, reloads session, user, membership, role, verification, and onboarding authority, and commits a single-use transition before the provider exchange boundary. Expired pending rows and consumed rows older than 24 hours are cleaned opportunistically in batches of at most 100; cleanup is not a correctness dependency and uses no timer.

Provider transmission remains intercepted in local validation. Current Jobber token persistence is unavailable: the legacy token-saving boundary does not match the migrated schema, so a real callback returns a bounded `503` and never reports the integration connected. This correction makes no provider-connection, provider-token-persistence, or production integration-readiness claim.

## Migration and readiness

Migration `010_account_session_authority.sql` aborts on normalized-email collisions, null ownership, unsupported roles/statuses, or multiple current subscriptions. It backfills memberships and onboarding only from existing PostgreSQL rows, revokes legacy refresh tokens, and disables the known source-seeded demo and admin credentials. It never reads a JSON data file and is transaction-body-only.

The production migration runner owns one transaction that acquires a PostgreSQL advisory transaction lock, verifies the ledger/checksums, executes every pending migration body, inserts every ledger row, and commits. Schema and ledger therefore roll back together on SQL failure, ledger failure, or pre-commit process/database termination. A lexical verifier removes only the exact outer transaction envelope in legacy migrations 001-009, including valid comment/BOM variants; arbitrary nested transaction statements are rejected. Migrations 001-009 remain byte-identical. PostgreSQL connection or migration failure leaves readiness false.

Inside that same advisory-locked transaction, the runner creates or transactionally rebuilds the ledger to one physical definition and column order: `id`, `filename`, `checksum`, `applied_at`. The final timestamp column is exactly `applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. A branch-era `TIMESTAMP NULL` value is interpreted using the database session time zone. A known non-null moment is preserved; an unknown null historical timestamp becomes the deterministic sentinel `'-infinity'::timestamptz`, never an invented upgrade-time `NOW()`. Newly executed migrations continue to receive their genuine transaction timestamp.

The rebuild preserves legitimate IDs, filenames, checksums, timestamps, owned serial semantics, and safe sequence state, advancing the next generated ID beyond the greatest retained ID when necessary. It fails closed on unsupported ledger shapes, dependencies, or swap-sensitive metadata such as nondefault ACLs, owners, comments, relation options, tablespaces, rules, or publication membership; rejection leaves the original ledger and its metadata unchanged. Fresh, genuine-base upgrade, branch-era divergent upgrade, and negative-control comparison include ordinal position, exact types and widths, nullability, defaults, constraint definitions and status, constraint-backed index ownership and status, serial ownership/configuration/state, and next-ID behavior. Migrations 001-010 remain byte-identical; migration 011 is the only new production migration.

## Local correction validation

The final local source state passed the focused migration (13/13), Jobber state (15/15), mounted external-family (9/9), and account-containment (4/4) gates. The complete API run passed 10 suites and 124 tests. Complete Jest passed 54 suites and 1,079 tests serially at seed `711106`, with four workers at seed `711107`, and under `--detectOpenHandles` at seed `711108`.

Installed Chrome and actual Playwright WebKit each passed the complete lifecycle at 1440×900 and 390×844. In every engine and viewport, sixteen simultaneous expired-access responses caused one refresh, two distinct waves caused two total refreshes, two tabs caused one rotation, restart caused no replay or bootstrap storm, and concurrent refresh count never exceeded one. The retained coordination maxima were 256 dedupe keys, 128 document-order entries, and 64 failed-wave summaries. Each viewport processed the required 10,000-message malformed, unsupported, duplicate, and cross-tab floods. Chrome inspected 1,511 local requests and 1,017 API bodies; WebKit inspected 1,511 local requests and 1,034 API bodies. No nonlocal/provider request, Bearer header, credential-bearing storage/global/body, or unexpected unsafe mutation was observed.

Two intermediate Chrome runs failed before the final complete rerun: the first exposed a 30-second drain-sentinel timeout after an unchunked 10,000-message duplicate flood; the second exposed a timing-dependent `NOW()+30,001 ms` future-message test vector. The test-only harness was bounded into production-acknowledged chunks and the future vector was moved durably outside the acceptance window. Complete Chrome and WebKit then passed from the beginning. These are implementation-validation results, not independent re-review. GitHub reports zero checks/statuses, so CI remains unavailable rather than passing.

## Operations

Required runtime configuration:

- `DATABASE_URL`
- `AUTH_ACCESS_SECRET` with at least 32 bytes
- optional `AUTH_ACCESS_MINUTES` from 1 through 60 (default 15)
- optional `AUTH_REFRESH_DAYS` from 1 through 90 (default 30)

`ACCOUNT_SIGNUP_ENABLED`, `ACCOUNT_VERIFICATION_DELIVERY_READY`, and `AUTH_BEARER_COMPAT_ENABLED` are not PR A runtime capabilities and are intentionally ignored. No Redis dependency, production data migration, Railway change, deployment, or email-provider configuration is part of PR A.
