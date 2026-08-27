# Mission 22 Part 5 fourth correction writer report

Status: **M22-P5-012 implemented; different fresh exact-head audit required**.

This correction adds one bounded, tenant-scoped target-discovery path shared by
Calendar and Command Center. The initial operator directory remains capped at
100 workers and 100 crews, but now reports exact shown/total/truncated metadata.
Every active worker and active crew is reachable through canonical server-side
prefix/UUID search or stable 25-row keyset pages. No browser-local directory or
mutation authority was added.

The endpoint validates query and cursor syntax before its directory query,
executes current operator authority and target rows in a read-only repeatable-
read snapshot, and preserves the existing owner/admin/active-dispatcher read
gate and subscription read-versus-mutate separation. Employees, inactive or
revoked operators, and cross-tenant cursors remain denied. Part 4 preview/apply
still rechecks the current target and durable mutation authority.

Mounted PostgreSQL evidence uses 105 active profiles and 102 active crews (207
current targets): the initial selector truthfully shows 200/207, an omitted
worker is found and approved through visible search, and an omitted crew is
found and approved after nine visible pages. Duplicate names, hostile bytes,
empty/error/offline states, inactive-target races, read-only subscriptions, and
invalid or forged inputs are covered.

Terminal gates: mounted Parts 1–5 `69/69`, affected/static `114/114`, historical
contract/M19/M20 `106/106`, and all four real Chrome/WebKit matrices. Fresh
PostgreSQL 18.4 UTC startup/restart and two credential-free health 200s are
green. The available corpus is `151/152` suites and `2,113/2,137` tests; the
sole 24-case non-pass remains the explicitly unavailable account-migration URL
matrix.

Migrations 001–035, providers, Part 6, production, PR readiness, merge, and
deployment are unchanged. Writer evidence is not approval.
