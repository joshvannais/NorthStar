# Mission 22 Part 5 fifth correction writer report

Status: **M22-P5-013, M22-P5-014, and M22-P5-015 implemented; a new
different fresh exact-head audit is required**.

This narrow correction closes the three findings validated against frozen PR
head `563b63114a19cb0ea1cda05c3bf07f9ecc8b6266`. Every broad scheduling
read now rechecks the exact durable authentication session, membership, user,
workforce role, onboarding, and subscription authority in the same read-only
repeatable-read PostgreSQL snapshot before returning tenant-wide bytes, counts,
or target rows. Stale middleware role, demotion, revocation, expiry, and tenant
or session divergence fail closed.

Target discovery now keysets solely on immutable kind and UUID, binds a cursor
to the tenant, exact canonical query, and a bounded query-specific dataset
digest, and returns an explicit 409 stale-restart contract when target-set
membership changes between pages. Renames no longer move a target across a
cursor. UUID-shaped query input is canonicalized to lowercase before cursor
binding, SQL, and response echo. The shared Calendar/Command Center dialog
clears stale options and cursor state and requires a fresh bounded search; it
does not retry or apply a mutation.

Terminal writer gates are green: focused mounted Parts 1–5 `70/70`, affected
unit/static/ratification `114/114`, historical contract/M19/M20 `106/106`, and
four real Chrome/WebKit matrices. The available full corpus is `151/152` suites
and `2,114/2,138` tests; the sole 24-case non-pass remains the explicitly
unavailable account-migration URL matrix. Fresh role-separated PostgreSQL 18.4
UTC startup/restart applied 33 migrations once and zero on restart, migration
035 matched its protected checksum, both credential-free health requests were
200, and the restricted runtime role could create neither databases nor public
schema objects.

Migrations 001–035 are unchanged and migration 036 does not exist. Part 6,
providers, production, PR readiness, merge, and deployment were not touched.
Writer evidence is not approval.
