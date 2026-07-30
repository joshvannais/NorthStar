# Account Lifecycle PR A

This change establishes PostgreSQL as the only runtime authority for account identity, organization ownership, memberships, current subscriptions, account preferences, onboarding state, browser sessions, refresh families, and authentication abuse controls.

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

User Bearer compatibility is retired. A Bearer request receives the same stable unauthorized response regardless of environment flags or claims; the browser client never constructs an Authorization header.

## Session and replay behavior

Refresh credentials are stored only as SHA-256 hashes. Every session has one active refresh token in a family. Rotation is a row-locked transaction that consumes the current token, inserts its replacement, and rotates access/CSRF state. Reuse of a rotated token marks it reused, revokes the active replacement and session, and prevents the family from continuing across processes.

Logout validates the refresh/CSRF pair, locks its durable authority, and transactionally revokes the session plus every active token in the family/session. Cookies are cleared only after commit. HTTP, CSRF, network, or PostgreSQL failure stays visible and retryable in the browser; it does not redirect or claim success.

## Notification preference authority

`notification_preferences` is the sole mounted authority for operational email and SMS choices. All five delivery choices default to `false`; a signup phone or email is only a destination and does not imply consent. Account-security email is mandatory and is not controlled by these fields. Business Profile JSON and browser storage cannot override operational delivery choices.

The generic `organization_account_preferences` row retains only unrelated internal presentation/configuration values. Migration 010 removes operational notification keys from that JSON and prevents them from being reintroduced. Because no durable explicit-consent provenance exists for upgraded legacy booleans, migration 010 deterministically sets all operational delivery choices to `false` while preserving unrelated preferences and notification destinations.

## Migration and readiness

Migration `010_account_session_authority.sql` aborts on normalized-email collisions, null ownership, unsupported roles/statuses, or multiple current subscriptions. It backfills memberships and onboarding only from existing PostgreSQL rows, revokes legacy refresh tokens, and disables the known source-seeded demo and admin credentials. It never reads a JSON data file and is transaction-body-only.

The production migration runner owns one transaction that acquires a PostgreSQL advisory transaction lock, verifies the ledger/checksums, executes every pending migration body, inserts every ledger row, and commits. Schema and ledger therefore roll back together on SQL failure, ledger failure, or pre-commit process/database termination. A lexical verifier removes only the exact outer transaction envelope in legacy migrations 001-009, including valid comment/BOM variants; arbitrary nested transaction statements are rejected. Migrations 001-009 remain byte-identical. PostgreSQL connection or migration failure leaves readiness false.

## Operations

Required runtime configuration:

- `DATABASE_URL`
- `AUTH_ACCESS_SECRET` with at least 32 bytes
- optional `AUTH_ACCESS_MINUTES` from 1 through 60 (default 15)
- optional `AUTH_REFRESH_DAYS` from 1 through 90 (default 30)

`ACCOUNT_SIGNUP_ENABLED`, `ACCOUNT_VERIFICATION_DELIVERY_READY`, and `AUTH_BEARER_COMPAT_ENABLED` are not PR A runtime capabilities and are intentionally ignored. No Redis dependency, production data migration, Railway change, deployment, or email-provider configuration is part of PR A.
