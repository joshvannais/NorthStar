# Mission 22 Part 5 sixth correction writer report

Status: **remaining M22-P5-013 atomic snapshot gap implemented; a new
different fresh exact-head audit is required**.

This narrow correction closes the broad-read time-of-check/time-of-use gap
validated at frozen PR head `e870a46698af46bbfbf859e7bd5d57292f056db0`.
Current exact session, membership, user, workforce, onboarding, subscription,
and broad-read authority now resolve on the same PostgreSQL client and
repeatable-read snapshot as every protected graph, count, overview, surface,
compatibility, status, and detail read used to build the response. No handler
commits authority and then obtains a pool connection for protected bytes.

The shared transaction helper accepts an already-owned PostgreSQL client, so
Calendar and Command Center overview transactions compose authority, tenant
timezone, page rows, canonical scheduling authority, conflicts, counts, and
categories without reconnecting or nesting a transaction. Owned broad reads
are bounded by statement, lock, and idle-transaction timeouts and a fixed
trusted `search_path`; errors roll back and release. Existing overview reads
remain mutation-free repeatable-read transactions with their established
shared authority locks.

Mounted production-router coverage inventories 70 protected aliases. It proves
one connect/begin/commit/release, one backend snapshot, zero pool queries after
authority, and zero data queries outside the transaction for list, aggregate,
status, Calendar/Command Center, detail, not-found, and compatibility paths.
Role/workforce demotion, session revoke/expiry/deletion, membership/user
suspension, subscription and onboarding changes were injected between the
authority query and data query. An in-flight request may coherently finish on
its earlier snapshot; the next request sees the durable transition and denies
or reports read-only. Injected data failure rolls back with no connection leak.

Terminal gates are green: mounted Parts 1–5 `71/71`, affected/static
`115/115`, historical contract/M19/M20 `106/106`, post-review focused `28/28`,
and four real Chrome/WebKit matrices. The locally available full corpus is
`151/152` suites and `2,116/2,140` tests; its sole 24-case non-pass remains the
explicitly unavailable account-migration URL matrix. Fresh role-separated
PostgreSQL 18.4 UTC startup/restart applied 33 migrations once and zero on
restart, migration 035 matched its protected checksum, both credential-free
health requests were 200, and the runtime role could create neither databases
nor public-schema objects.

Migrations 001–035 are unchanged and migration 036 does not exist. Browser UI,
Part 4 mutation authority, target paging/digest/UUID behavior, Part 6,
providers, production, PR readiness, merge, and deployment were not changed.
Writer evidence is not approval.
