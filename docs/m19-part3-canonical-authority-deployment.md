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

| Surface | Disposition after migrations 005-008 |
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

## Single canonical calculation authority

The mounted simulation path no longer imports, exports, or reaches the deleted
historical `simulation/service-catalog.js` calculator. Its replacement scenario
catalog contains only nonfinancial scope and customer-statement metadata.
Transcript generation does not calculate or speak a price; it promises a
canonical written estimate. The dormant browser `calcPrice` and `calcBreakdown`
implementations were removed, so browser presentation consumes the mounted API
result and has no calculator fallback.

The mounted route supplies structured quantities and scope facts to the
canonical orchestration service. That service selects a stable service id from
the pinned, persisted Business Profile and evaluates only the profile's explicit
`canonicalPricing` rules (`fixed`, `perUnit`, `perUnitByValue`, and
`perItemByValue`). Labor, material, gate, removal, permit, overhead, markup,
travel, emergency adjustment, range, and tax inputs therefore originate only
from that profile snapshot. The persisted result records the exact profile id,
version, hash, and sorted profile-field paths used. Missing quantities or rules,
malformed configuration, unsupported scope values, and unsupported services
produce `null` values with stable `notCalculated` reasons; configured zero
remains zero. Response, transcript, UI, and replay pricing use the persisted
canonical result, and replay never recalculates against a newer profile version.
Adversarial mounted tests use one profile with $99 per linear foot labor, $123
per linear foot cedar, a $9,999 permit, distinct gate/removal charges, 55 percent
overhead, and zero tax, plus a second organization with different rates. The
first profile produces a $37,376 subtotal, deliberately diverging from the
retired $4,510 catalog amount.

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

Retell financial variables preserve the pinned Business Profile semantics. The
canonical persisted representation and the Retell transport representation are
deliberately distinct:

- a configured zero remains numeric `0` in the canonical persisted result and
  is serialized as the Retell transport string `"0"` with `configured` status;
- a missing value remains `null` canonically and is serialized as
  `"not_configured"` with `not_configured` status;
- a malformed or explicit null value remains `null` canonically and is
  serialized as `"unavailable"` with `unavailable` status;
- a configured positive value is passed unchanged;
- `pricing_rules` and the corresponding individual variables carry identical
  serialized values and dispositions; and
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
cluster outside OneDrive, bound only to `127.0.0.1:55439`. Every suite/run/
worker/process received a unique database and isolated `NORTHSTAR_DATA_DIR`.
`M19_PG_ADMIN_URL`, `M19_EXPECTED_PG_DATA_DIR`, `M19_EXPECTED_PG_PORT`, and
`M19_TEST_RUN_ID` were process environment values only. The provider boundary
was intercepted; no external call was transmitted. The repeatable commands,
shown without the disposable URL, were:

```powershell
$calculationAuthority = @(
  'tests\unit\m19-part3-simulation-authority.test.js',
  'tests\unit\m19-part3-canonical-calculation.test.js',
  'tests\ratification\m19-part3-authority-containment.test.js'
)
node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand @calculationAuthority
$mountedAuthority = @(
  'tests\api\m19-part3-remediation-mounted-postgres.test.js',
  'tests\api\m19-part3-canonical-api-postgres.test.js',
  'tests\integration\m19-part3-canonical-graph-postgres.test.js'
)
node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand @mountedAuthority
$m19 = Get-ChildItem tests -Recurse -File -Filter '*m19-part3*.test.js' |
  Sort-Object FullName | ForEach-Object FullName
node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand @m19
node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand tests\api
node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand
node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=7331 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=91027 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=182133331 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=-182133331 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=730194257 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --randomize --seed=182133331 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --randomize --seed=-182133331 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --randomize --seed=730194257 --showSeed
node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --detectOpenHandles
node tests\browser\m19-part3-cross-page-matrix.js --browser=chrome
node tests\browser\m19-part3-cross-page-matrix.js --browser=webkit
```

Final-head results were 3 suites/25 tests for focused calculation authority, 3
suites/47 tests for the mounted PostgreSQL authority group, 15/115 for the
complete focused Mission 19 Part 3 group, and 5/66 for the API group. Each of
two complete serial runs, both fixed-seed four-worker runs, all three required
randomized four-worker runs, and the detect-open-handles run passed 42
suites/971 tests. The isolated mounted provenance suite passed 1 suite/15 tests
under each of seeds `182133331`, `-182133331`, and `730194257`. Chrome and actual
Playwright WebKit each passed 126 assertions across seven surfaces with zero
automatic mutations.

The first independent run at seed `182133331` exposed an order dependency in
the mounted PostgreSQL provenance suite: a Polaris snapshot was expected from
an earlier test. The corrected test now creates and awaits its own organization,
profile, graph, snapshot, and authorization state. It then passed alone at seed
`182133331`, first, last/reversed, at an additional seed, and within the complete
four-worker seed `182133331` run. A second inherited order dependency in the
same suite's canonical lead read was also made self-contained. Both corrections
retain the expected provenance row and strict assertions.

Intermediate validation failures were retained as evidence. At this additive
head, the first focused unit attempt supplied the old transcript fixture shape;
the first combined PostgreSQL run then exposed five stale graph/Retell fixture
expectations, and the next run exposed four stale artifact-count/tax fixtures.
Those test-only fixtures were aligned to their already-supported contracts and
the complete mandatory groups passed. The first fresh/upgrade schema comparison
query also used an ambiguous PostgreSQL `text || "char"` expression and an
obsolete PowerShell SHA API after both migrations had already succeeded; a
read-only corrected comparison proved 218 identical schema objects with SHA-256
`8c3be80db118ece93c8a53c283841c64d4a3bac1363b015c4e131ecb401d6dd2`.
The final independent fresh/upgrade inventory expanded that comparison to
relations, columns, and constraints: both paths produced 763 identical objects
with SHA-256
`599e94dca7a58308e5f714f8bd5d923064e7da15420054eed70529de0e0b74bc`
and zero Business Profile, operation, or demo-authority rows.

Earlier published-head diagnostics also remain part of the ledger: structured
scope initially omitted `jobType`; migration 008's table was placed in the wrong
alphabetical position in one assertion; reversed provenance exposed a second
self-contained-fixture gap; one serial run exposed a static ratification phrase
mismatch; and parser/integrity commands required Windows quoting and exact-name
corrections. At this final additive head, the first complete inline-script
verifier also encountered the Windows Python `cp1252` pipe encoding before any
syntax check; the same parser passed all 8 HTML files and 17 complete inline
scripts with an explicit UTF-8 byte pipe. The first final migration identity
guard compared PostgreSQL's `127.0.0.1/32` rendering to the unmasked loopback
string and stopped before creating a database; `host(inet_server_addr())` then
verified only `127.0.0.1` and the migration matrix passed. The first data-hash
map transcribed the middle of one preflight digest incorrectly and stopped on
that comparison; re-reading all 11 exact SHA-256 values and their immutable tree
blobs proved every file unchanged. Every failure was diagnosed narrowly and
rerun without skips, relaxed assertions, lower concurrency, extra timeout,
production access, or provider access. The final additive-head gates above are
clean. GitHub CI remains unavailable if PR #69 continues to report zero checks.
