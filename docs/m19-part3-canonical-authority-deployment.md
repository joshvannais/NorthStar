# Mission 19 Part 3 canonical authority deployment inventory

This document is an inventory and deployment checklist only. PR #69 does not
run a production migration, backfill, customer merge, ownership assignment, or
deployment.

## Additive database authority

Migration `004_canonical_persistence_v2.sql` remains the immutable canonical
graph foundation. Migration `005_canonical_organization_authority.sql` adds:

- immutable, organization-scoped Business Profile versions;
- persisted Retell/voice integration ownership;
- organization-scoped normalized phone/email identity constraints; and
- nullable profile provenance foreign keys for pre-existing graph rows.

Migration 005 deliberately creates no Business Profile, integration ownership,
or customer identity rows for existing organizations. It does not inspect,
merge, delete, reassign, or infer ownership from legacy records.

Migration `006_canonical_voice_sessions.sql` adds organization-scoped,
PostgreSQL-authoritative voice sessions and their idempotent event timelines.
Every session pins the persisted integration ownership and exact Business
Profile id, version, and hash used when the session starts. Only the live
provider handle remains process-local. Handoff and cancellation therefore fail
with `VOICE_RUNTIME_UNAVAILABLE` after a restart or on another process instead
of pretending a durable database row is a live call handle.

Migration `007_canonical_tax_authority.sql` adds explicit canonical estimate
tax columns. It does not infer, default, or backfill a tax rate. A validated
Business Profile rate, including an explicit zero rate, produces exact tax and
total values. Missing or invalid tax configuration produces the exact
`tax_configuration_unavailable` disposition and no invented total.

Migration `008_canonical_demo_authority.sql` adds only the durable allow-list
needed to bind a server-owned demo organization to the public demo route. It
creates no demo organization, Business Profile, integration ownership, session,
or customer data. The PR deliberately performs no production demo provisioning.

Migrations 006 through 008 create no customer, estimate, historical voice, or
demo-tenant data for existing organizations. They do not inspect, merge, or
infer tenant data.

Before enabling canonical ingestion for an organization, an operator-controlled
deployment process must inventory and explicitly create:

1. one validated active `canonical_business_profiles` version; and
2. exactly one active Retell agent ownership record in
   `canonical_integration_ownership` for each enabled organization.

Unknown, missing, inactive, or ambiguous authority fails closed. Historical
file, Sheets, legacy PostgreSQL, and JSON records remain untouched. Any future
historical import must be separately authorized, idempotent, organization
scoped, and auditable.

## Reachable production graph surfaces

| Surface | Disposition after migrations 005-007 |
| --- | --- |
| `POST /api/retell/webhook` | Persisted agent ownership, then one canonical PostgreSQL graph transaction |
| `POST /api/v1/voice/webhook` | Signature/timestamp validation, persisted agent ownership, then the same canonical ingestion service |
| `POST /api/v1/voice/call` | Authenticated persisted membership, active persisted Business Profile and Retell ownership, then PostgreSQL session creation before the intercepted provider boundary |
| `POST /api/retell/create-call` | The same shared canonical voice-session creation service, authority, RBAC, pinned profile provenance, provider binding, and durable failure disposition as `/api/v1/voice/call` |
| `POST /api/demo/call` | Server-owned demo organization only; persisted demo allow-list, active profile, and integration ownership, or stable HTTP 503 `demo_unavailable` without provider invocation or process-local fallback |
| `GET /api/v1/voice/sessions*` | Organization-scoped PostgreSQL session and timeline projections with persisted RBAC |
| Voice handoff/cancel | Owner/admin RBAC plus a matching live process handle; otherwise retryable 503 |
| `POST /api/v1/simulations/leads` | Authenticated `leads:create`, canonical transaction |
| `POST /api/leads` | Authenticated `leads:create`, canonical transaction |
| `GET /api/leads` and export/detail equivalents | Organization-scoped canonical PostgreSQL projection |
| Canonical appointment update | Persisted `calendar:update`, organization/session-scoped identifier |
| Legacy lead/calendar/Polaris mutations | Intercepted with `LEGACY_AUTHORITY_READ_ONLY` |
| Legacy Polaris intelligence/estimate reads | Canonical persisted projection adapters; obsolete Polaris endpoints return exact 410 retirement responses |
| File-backed lead/customer/Polaris stores | Test/import fixtures only; no mounted canonical route uses them as tenant authority |
| Google Sheets lead append | Disabled for automatic graph ingestion; it cannot determine canonical success |
| Browser/AppStore | Reads compatibility projections derived from committed canonical snapshots |
| Canonical response cache | Disabled for authority reads; every canonical request queries PostgreSQL |
| Estimate tax | Derived only from validated canonical Business Profile configuration, or explicitly unavailable |
| Mounted simulation | Generates structured facts and a nonfinancial transcript; every financial value comes from the centralized canonical calculation using the persisted Business Profile |

## Final voice and calculation authority remediation

The mounted simulation path no longer imports, exports, or reaches the
historical simulation service-catalog calculator. Transcript generation does
not calculate or speak a price; it promises a canonical written estimate. The
mounted route supplies structured scope facts to the canonical orchestration
service, and response, transcript, UI, and replay pricing use only the persisted
canonical result. Tests deliberately use a Business Profile whose configured
pricing differs from the former hard-coded catalog.

`POST /api/v1/voice/call` and `POST /api/retell/create-call` use one shared
canonical creation service. It resolves persisted membership, organization,
active Business Profile id/version/hash, and organization-owned Retell
integration; creates the PostgreSQL session and initial event before provider
creation; binds the returned provider identity to that session; and records a
durable failed disposition if provider creation fails. Viewer access remains
read-only. Missing, inactive, ambiguous, cross-tenant, or unavailable authority
fails closed. Caller-supplied organization, business, profile, and pricing
values are not authority. A process-local map may hold a live provider handle,
but it cannot create or replace tenant-visible session authority.

`POST /api/demo/call` accepts only bounded scenario/contact inputs. Its
organization identity comes from server-side `NORTHSTAR_DEMO_ORGANIZATION_ID`,
and that organization must also be enabled in `canonical_demo_authority` with
an active persisted Business Profile and exactly one active integration owner.
The demo organization's rows and session reads remain isolated from tenant
organizations and are visible across processes through PostgreSQL. Absent
provisioning returns stable HTTP 503 `demo_unavailable`; it never falls back to
a process-local session or transmits an unowned provider call. Provisioning the
demo tenant, profile, integration, environment value, and secret remains a
separate production-owner decision and did not occur in this PR.

Retell financial variables preserve the pinned Business Profile exactly:

- a configured numeric zero remains numeric zero;
- a missing value remains `null` with `not_configured` status;
- a malformed value remains `null` with `unavailable` status;
- a configured positive value is passed unchanged;
- `pricing_rules` and the corresponding individual variables carry identical
  values and dispositions; and
- tax is configured, explicitly zero-rated, or unavailable. No 7 percent or
  other tax default is assumed, and unavailable values are explicitly marked
  as values the agent must not quote.

## Mounted legacy route disposition

The `/api/v1` and `/api` routers own exact methods rather than applying
router-wide authentication. An unmatched method falls through without a second
membership lookup or an attempt to redefine immutable tenant context.

The following compatibility reads are adapted to organization-scoped canonical
PostgreSQL projections:

- customers and customer detail;
- communications, calls, and communication detail;
- opportunities, pipeline, lead detail, and lead intelligence;
- financial estimates and financial metrics;
- analytics, dashboard, executive, and statistics projections;
- workflow agenda, appointments, and calendar projections; and
- Polaris intelligence, estimates, recommendations, learning, pipeline,
  Retell context, business context, and unified context.

The following legacy mutation groups are blocked with
`LEGACY_AUTHORITY_READ_ONLY` and HTTP 409 before any legacy repository can run:

- legacy lead simulation/import/status writes;
- calendar event, schedule, and ICS-import writes;
- call-record and mark-known writes;
- customer, communication, opportunity, and workflow writes;
- legacy financial estimate writes; and
- legacy Polaris estimate, completion, recommendation, pipeline, and
  configuration writes.

All other methods and paths beneath the legacy `polaris`, `customers`,
`communications`, `opportunities`, `workflows`, `financial`, `assets`, `crew`,
`jobs`, `analytics`, `engines`, `dashboard`, `leads`, `calls`, and `calendar`
prefixes are retired with `LEGACY_AUTHORITY_RETIRED` and HTTP 410. The contact
writer is also retired. The old `polaris-engines`, `publicApi`, and dashboard
routers are not mounted. Their source and file-backed stores remain historical
or import/test fixture material only; they are not production tenant authority.

## Deployment gates outside this PR

- Take and verify the normal database backup required by the deployment owner.
- Run migrations 001 through 008 in a non-production disposable PostgreSQL 17
  verifier, then run the approved production migration procedure separately.
- Inventory organizations requiring profile and integration configuration;
  obtain explicit ownership evidence rather than inferring it from webhook data.
- Configure one organization at a time and verify fail-closed behavior before
  enabling its webhook.
- Do not automatically backfill legacy files, Sheets, `leads`, `call_records`,
  or legacy Polaris JSON data.

## Canary and observability checks

These are future deployment-owner gates; this PR has not performed them.

1. Enable one explicitly configured organization only after its active Business
   Profile and integration ownership have been independently verified.
2. Confirm `/api/health` reports PostgreSQL persistence healthy and the
   authenticated canonical status reports `postgresAuthoritative: true`,
   `redisRequired: false`, and `canonicalResponseCaching: false`.
3. Observe canonical operation state, lease/replay outcomes, audit persistence,
   voice-session ownership/runtime-unavailable responses, and normalized 409,
   410, and 503 error codes. A warm read followed by database outage must never
   return a stale 200.
4. Compare canonical graph, Business Profile provenance, estimate tax
   disposition, and all seven browser projections for the canary organization.
5. Confirm repository data-file hashes remain unchanged and no legacy or
   automatic browser writer runs.

## Rollback and stop criteria

Stop the canary before broader enablement for any tenant crossover, stale 200
during PostgreSQL outage, duplicate graph, partial graph, missing audit record,
unexpected legacy file mutation, voice ownership mismatch, Business Profile
provenance mismatch, fabricated tax/total, or sustained unexpected error rate.
Disable new ingestion for the canary organization and preserve database and
audit evidence. Application-release rollback must use the deployment owner's
normal immutable release procedure; do not destructively reverse schema, delete
canonical rows, infer ownership, or run a compensating backfill from this PR.

GitHub CI is evidence only when checks exist and report a result. If PR #69 has
zero checks or workflow runs, CI is unavailable, not passing. This PR has not
been merged or deployed and has not changed Railway, production data, production
schema, or PR #66. It has not transmitted a Retell/provider call, provisioned a
production demo tenant, run a production migration or backfill, or accessed an
existing database.

## Local ratification ledger

All PostgreSQL commands below used PostgreSQL 17.10 in a fresh task-specific
cluster outside OneDrive, bound only to `127.0.0.1:55433`. Every suite/run/
worker/process received a unique database and isolated `NORTHSTAR_DATA_DIR`.
`M19_PG_ADMIN_URL`, `M19_EXPECTED_PG_DATA_DIR`, `M19_EXPECTED_PG_PORT`, and
`M19_TEST_RUN_ID` were process environment values only. The provider boundary
was intercepted; no external call was transmitted. The repeatable commands,
shown without the disposable URL, were:

```powershell
$focused = @(
  'tests\unit\m19-part3-simulation-authority.test.js',
  'tests\unit\m19-part3-retell-financial-semantics.test.js',
  'tests\api\m19-part3-remediation-mounted-postgres.test.js',
  'tests\integration\m19-part3-voice-sessions-postgres.test.js',
  'tests\integration\m19-part3-persistence-v2-postgres.test.js',
  'tests\ratification\m19-part3-authority-containment.test.js'
)
node .\node_modules\jest\bin\jest.js --runInBand @focused
$m19 = Get-ChildItem tests -Recurse -File -Filter '*m19-part3*.test.js' |
  Sort-Object FullName | ForEach-Object FullName
node .\node_modules\jest\bin\jest.js --runInBand @m19
node .\node_modules\jest\bin\jest.js --runInBand tests\api
node .\node_modules\jest\bin\jest.js --runInBand
node .\node_modules\jest\bin\jest.js --maxWorkers=4 --randomize --seed=7331
node .\node_modules\jest\bin\jest.js --maxWorkers=4 --randomize --seed=91027
node .\node_modules\jest\bin\jest.js --maxWorkers=4 --randomize --seed=182133331
node .\node_modules\jest\bin\jest.js --maxWorkers=4 --randomize --seed=-905440317
node .\node_modules\jest\bin\jest.js --runInBand --detectOpenHandles
node tests\browser\m19-part3-cross-page-matrix.js --browser=chrome
node tests\browser\m19-part3-cross-page-matrix.js --browser=webkit
```

Final-head results were 6 suites/40 tests for the focused remediation group,
15/118 for the complete focused Mission 19 Part 3 group, and 5/66 for the API
group. Each of two complete serial runs, both fixed-seed four-worker runs, both
additional randomized four-worker runs, and the detect-open-handles run passed
42 suites/974 tests. Chrome and actual Playwright WebKit each passed 126
assertions across seven surfaces with zero automatic mutations.

The first independent run at seed `182133331` exposed an order dependency in
the mounted PostgreSQL provenance suite: a Polaris snapshot was expected from
an earlier test. The corrected test now creates and awaits its own organization,
profile, graph, snapshot, and authorization state. It then passed alone at seed
`182133331`, first, last/reversed, at an additional seed, and within the complete
four-worker seed `182133331` run. A second inherited order dependency in the
same suite's canonical lead read was also made self-contained. Both corrections
retain the expected provenance row and strict assertions.

Intermediate validation failures were retained as evidence: the first focused
simulation assertion found that structured scope omitted `jobType`; the first
combined PostgreSQL inventory assertion placed migration 008's table in the
wrong alphabetical position; the reversed provenance run exposed the second
self-contained-fixture gap; one first serial run exposed a static ratification
phrase mismatch; and the first inline-script parser command was truncated by
PowerShell argument quoting. Each was diagnosed narrowly and rerun without
skips, relaxed assertions, lower concurrency, extra timeout, production access,
or provider access. The final code-head gates above are clean. GitHub CI remains
unavailable if PR #69 continues to report zero checks.
