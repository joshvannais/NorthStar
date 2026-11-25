# Mission 28 Part 14E — PostgreSQL, mounted worker and measurements

Status: **Implementation candidate only. Not independently accepted or released.**

Part 14E exercises the mounted paid and isolated-demo automation paths against
a fresh disposable PostgreSQL instance through every source migration. It uses
real account sessions, capabilities, CSRF, mounted routes, the separated
runtime role, the actual database repositories, the production fictional-demo
housekeeping worker, a database-pool restart, a genuine local database outage,
and bounded high-volume local measurements. It does not contact a live or
sandbox provider, recipient or payment system and creates no external,
financial or money effect.

## Released baseline

Part 14D was independently accepted at source
`fd917d5459033e0af78fb65e1f368c31d33ef68c`, tree
`7210b21b9aa42fbe67d01846ca87cc6d64aad656`, with P0=P1=P2=P3=0. PR #611
normally merged to main `cb2c68aac404bc055352c78853e8b3ce0d90982c`.
Its sole automatic deployment
`2f26683f-aaee-42ad-9cf5-2c4c4891cdbf` succeeded with running instance
`146d8f4f-b22c-4851-a9e5-20c0ab7fbc50` and image
`sha256:08c89f00176da1d132be0a4c5faaa4b962a9dcde9962897e72c6359ceedbbda4`.
Read-only production reconciliation proved exact 284/284 migrations through
288 with no 289. The fresh confirmed pre-release backup is
`f42b41cb-596c-45a9-ad51-f83eb793e3ac`, named
`pre-m28-part14d-fd917d54-20261124`, external identity
`vs_1795560282694_zfgwta2goxdxzgv5`; the prior fresh backup was removed only
after this replacement was confirmed, leaving one retained backup.

The immutable source audit report is
`m28-part14d-root-audit-fd917-v2.json`, SHA-256
`29F76CEB1B2AA7C1B4A94466D48701822EFF3B6E8A95028F3ABA5F85D343F1D5`.
Exact Node 22.23.3 reproduced 63 Mission 28 suites and 971 tests, supporting
167 passes with three intentional skips, impacted navigation one pass with ten
unrelated skips, syntax 61, JSON 62, normalized references 522, and 284 source
migrations through 288 with no 289.

## Mounted PostgreSQL authority

The fresh role-separated database exposed a latent fail-closed mount gap: the
paid Automation Center repository selected owner-only canonical tables while
the canonical runtime bootstrap correctly withheld those tables from the
application role. Migration 289 adds one read-only, security-definer entry,
`canonical_automation_center_v1_read`. It reuses the accepted exact account,
membership and session authority, permits only owner/admin reads, binds every
query to the requested organization inside the function, establishes the exact
transaction-local tenant context required by forced row-level security only
after that authority succeeds, and returns the
bounded source rows consumed by the existing owner-facing projection. The
runtime role receives only `EXECUTE` on this entry. Direct canonical-table
access remains denied, public execution remains revoked, and the entry cannot
save a policy, schedule work, contact a recipient, create a provider attempt,
or create an external or money effect.

The entry rejects a null, missing, member, viewer or unknown access role before
the legacy actor helper can compare it. It never trusts a caller or pooled
connection's tenant setting. Actual role-separated PostgreSQL coverage stores a
real policy, then proves the correct owner and admin see it with cleared and
wrong prior tenant settings, through warm and restarted pools. Cross-tenant,
forged actor/session, explicit member/viewer and null-role owner/member/viewer
calls fail closed.

The exact additive migration file is
`289_automation_center_runtime_read_authority_v1.sql`, raw SHA-256
`47C7AA1BC02C4DBC0CE03F3C57A014B16080070792E503F5616DF97B1DD52B08`.
The candidate inventory contains 285 migrations through 289 and no 290;
historical migration bytes remain unchanged.

The mounted integration applies all 285 source migrations through 289 with no
290, then proves the paid owner read through a real session, capability,
route, function and database. Member access, a cross-tenant retarget and direct
storage access fail closed. The paid preview uses real CSRF authority and stays
pure with every effect counter false.

## Worker, restart and degraded paths

The deterministic provider fixture is the isolated fictional-demo adapter. It
never invokes an external provider. Twenty-four independent fictional sessions
perform two provider-fixture transitions each in batches of six. Exact
database receipts prove 24 sessions and 48 mutations while the paid automation
transaction table remains empty. Saved provider-fixture state and idempotent
replay survive a complete application database-pool close and reinitialization.

The mounted route is also exercised with its database URL temporarily pointed
at a closed loopback port. It returns 503, then recovers after the exact runtime
URL and pool are restored, with the saved fictional authority unchanged. The
production `DemoCommandCenterHousekeepingWorker` drains expired fictional
sessions in bounded batches; a newly constructed worker drains zero after the
completed pass. The accepted Parts 6A–6F PostgreSQL contracts separately
exercise transaction, schedule, lease, retry, control and recovery authority.
No external delivery worker or provider adapter is claimed to be mounted.

Durations in the executable artifact are a single local disposable PostgreSQL
observation. Tests assert functional outcomes and exact counts, not duration
ceilings. The numbers are not a production benchmark, capacity promise or SLA.
That observation recorded 5,866.320 ms for the bounded 24-session/48-action
mounted batch, 916.087 ms for database-pool restart, 6.441 ms to return the
fail-closed degraded response, 522.038 ms to reinitialize and recover, and
28.144 ms to drain 26 expired fictional sessions through the housekeeping
worker. These machine-specific durations are descriptive only.

## Evidence boundary

This candidate is writer evidence, not independent acceptance. Migration 289
is pending a normal release and is not claimed in production. Genuine Chrome
and Playwright WebKit work remains Part 14F. Final independent audit, PR,
merge, deployment and production acceptance remain Part 14G. Physical Safari,
manual assistive technology, founder visual approval, provider/live/private
production evidence, professional review and money effects remain unavailable
and unclaimed.
