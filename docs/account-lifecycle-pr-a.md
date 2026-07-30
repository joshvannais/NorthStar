# Account Lifecycle PR A

This change establishes PostgreSQL as the only runtime authority for account identity, organization ownership, memberships, current subscriptions, account preferences, onboarding state, browser sessions, refresh families, and authentication abuse controls.

## Frozen lifecycle

- Public signup is disabled unless `ACCOUNT_SIGNUP_ENABLED=true`.
- Production startup rejects enabled signup until `ACCOUNT_VERIFICATION_DELIVERY_READY=true`. PR A does not add verification delivery and does not enable either production flag.
- Signup normalizes email by trimming and lowercasing only, accepts passwords from 12 through 128 characters, and atomically creates the organization, pending-verification user, owner membership, 14-day trial, preferences, onboarding row, restricted session, and refresh family.
- Pending-verification accounts can use only `/api/auth/me`, `/api/auth/verification/status`, `/api/auth/refresh`, and `/api/auth/logout`. PR B owns the verification transition to `business_profile_required`.
- An existing active canonical Business Profile makes onboarding `complete`. Persisting the first active profile updates the onboarding row in the same PostgreSQL transaction.
- The historical JSON user registry is neither read nor imported by any mounted authentication path. `data/users.json` remains protected evidence.

## Browser credential contract

`northstar_access` and `northstar_refresh` are `HttpOnly`, `SameSite=Lax`, `Path=/` cookies. They are `Secure` in production. The access JWT contains only the user and session identifiers; organization and role authorization are reloaded from PostgreSQL on every request.

`northstar_csrf` is deliberately readable by the shared browser client and is not an authentication credential. Every cookie-authenticated state-changing request must send its value in `X-CSRF-Token`; the server also compares its hash with the current session row. Refresh rotates both refresh and CSRF values, so missing, wrong, stale, and cross-session values fail.

`public/js/auth-session.js` is the only browser authentication client. It retains account projections only in memory, loads identity through `/api/auth/me`, retries once after a successful refresh, routes lifecycle states, and performs server-side logout. Browser storage may still contain presentation theme and per-tab simulation metadata, but never access tokens, refresh tokens, users, organizations, or roles.

Authorization headers remain disabled by default. `AUTH_BEARER_COMPAT_ENABLED=true` enables the separately tested API compatibility path; the browser client never uses it.

## Session and replay behavior

Refresh credentials are stored only as SHA-256 hashes. Every session has one active refresh token in a family. Rotation is a row-locked transaction that consumes the current token, inserts its replacement, and rotates access/CSRF state. Reuse of a rotated token marks it reused, revokes the active replacement and session, and prevents the family from continuing across processes. Logout revokes the session and active refresh credential before clearing cookies.

## Migration and readiness

Migration `010_account_session_authority.sql` aborts on normalized-email collisions, null ownership, unsupported roles/statuses, or multiple current subscriptions. It backfills memberships and onboarding only from existing PostgreSQL rows, revokes legacy refresh tokens, and disables the known source-seeded demo and admin credentials. It never reads a JSON data file.

The migration runner owns the transaction around each migration, records SHA-256 checksums, and rejects changed applied migrations. PostgreSQL connection or migration failure leaves readiness false. Normal server startup validates auth configuration and refuses to listen unless PostgreSQL is fully ready.

## Operations

Required runtime configuration:

- `DATABASE_URL`
- `AUTH_ACCESS_SECRET` with at least 32 bytes
- `ACCOUNT_SIGNUP_ENABLED=false` by default
- `ACCOUNT_VERIFICATION_DELIVERY_READY=false` until PR B is ratified
- optional `AUTH_ACCESS_MINUTES` from 1 through 60 (default 15)
- optional `AUTH_REFRESH_DAYS` from 1 through 90 (default 30)
- optional `AUTH_BEARER_COMPAT_ENABLED=true` only for an explicitly approved API client

No Redis dependency, production data migration, Railway change, deployment, or email-provider configuration is part of PR A.
