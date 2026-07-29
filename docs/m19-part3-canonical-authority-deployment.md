# Mission 19 Part 3 canonical authority deployment inventory

This document records the local ratification of PR #69 through the canonical
projection, Business Profile editor, and voice-tool remediation. The PR has not
run a production migration, backfill, customer merge, ownership assignment,
demo provisioning, provider call, Railway change, deployment, or merge.

## Additive PostgreSQL authority

Migration `004_canonical_persistence_v2.sql` remains the canonical graph
foundation. Migration `005_canonical_organization_authority.sql` adds versioned
organization Business Profiles, integration ownership, normalized identities,
and graph provenance. Migration `006_canonical_voice_sessions.sql` adds
organization-scoped voice sessions and event timelines. Migration
`007_canonical_tax_authority.sql` adds explicit tax disposition without
inferring a rate. Migration `008_canonical_demo_authority.sql` adds only the
server-owned demo allow-list. Migration
`009_canonical_voice_provider_identity.sql` separates the stable canonical
public session identifier from the provider identity.

Migrations 004-009 are additive. They do not create or infer Business Profiles,
integration ownership, demo organizations, canonical graphs, or historical
voice sessions for production organizations. Before enabling an organization,
an operator-controlled deployment must explicitly provision one active
Business Profile and exactly one active Retell ownership record. Public demo
enablement additionally requires a dedicated isolated organization, an active
`canonical_demo_authority` row, and server-side
`NORTHSTAR_DEMO_ORGANIZATION_ID`. This PR did none of that provisioning.

## Mounted production authority

| Surface | Authority and failure behavior |
| --- | --- |
| `POST /api/retell/webhook` | Persisted integration ownership and the pinned voice-session profile, then one canonical graph transaction |
| `POST /api/v1/voice/webhook` | Signed transport validation followed by the same canonical ingestion authority |
| `POST /api/v1/voice/call` | Persisted membership/RBAC, organization integration, pinned profile, and durable session before the intercepted provider boundary |
| `POST /api/retell/create-call` | The same shared PostgreSQL-first creation service; caller organization/profile/pricing fields grant no authority |
| `POST /api/demo/call` | Server-owned demo organization only; creates one stable canonical session or returns `503 demo_unavailable` |
| Demo status/transcript/timeline/estimate reads | Read the persisted canonical session, event timeline, and immutable snapshot |
| Demo simulate/advance/complete/cancel writes | HTTP 410; no public process-local lifecycle authority |
| `POST /api/v1/simulations/leads` | Persisted membership/RBAC and one canonical graph transaction after strict service validation |
| Canonical and compatibility reads | Organization/session-scoped PostgreSQL projections of immutable graph snapshots |
| Retired Polaris/engine routes | Exact safe retirement response without importing the deleted implementation |

Unknown, foreign, malformed, and expired demo identifiers share one
non-disclosing `404 demo_session_not_found` response. Before completion, status
and estimate endpoints return `not_ready` rather than fabricated values.
Provider creation failure is a terminal persisted session/event disposition.
Completion and replay keep the originally pinned profile id, version, and hash.

## Canonical compatibility projections

`src/routes/canonicalPolaris.js` reads completed, organization-owned canonical
graphs by joining `canonical_operations`, customers, transcripts,
communications, opportunities, estimates, appointments, and immutable Polaris
snapshots. All projections carry graph, operation, snapshot, calculation,
Business Profile id/version/hash, digest, timestamp, and `notCalculated`
provenance. Ordering is deterministic by snapshot creation time and operation
id; recommendation deduplication uses a stable SHA-256 of the persisted action.

The compatibility endpoints now have these real sources:

- `GET /api/v1/analytics/trends` groups persisted snapshots by their UTC
  snapshot date and reports graph count, priced/unpriced counts, available
  revenue and gross-profit measures, and source-graph provenance.
- `GET /api/v1/analytics/by-service` groups snapshots by the canonical
  `snapshot.service.key`, reports genuine counts and available financial
  measures, and returns `canonical_service_identity_unavailable` when a
  populated snapshot lacks a usable service identity.
- `GET /api/v1/polaris/recommendations` projects and deterministically
  deduplicates each persisted `snapshot.recommendedActions` entry. It does not
  invent, recalculate, or discard structured actions.
- Pipeline stages and alerts likewise derive from the same persisted items.
  An empty alert list can coexist with `projection.status: available`; it is
  not represented as an unsupported projection.

A populated ratification graph produced the following material output:

```json
{
  "trends": {
    "projection": { "status": "available", "canonicalGraphCount": 1 },
    "trend": [{ "graphCount": 1, "estimatedRevenue": 37376, "pricedGraphCount": 1, "unpricedGraphCount": 0 }]
  },
  "byService": {
    "projection": { "status": "available", "canonicalGraphCount": 1 },
    "services": [{ "serviceKey": "fence", "graphCount": 1, "estimatedRevenue": 37376 }]
  },
  "recommendations": {
    "projection": { "status": "available", "canonicalGraphCount": 1 },
    "source": "persisted snapshot.recommendedActions"
  }
}
```

Each entry also carried the exact source graph, snapshot digest, and pinned
profile id/version/hash. Replay returned byte-equivalent projection bodies and
did not recalculate. Cross-organization graph ids were absent.

A genuinely empty organization returns HTTP 200 with explicit metadata, for
example `trend: []`, `services: []`, or `recommendations: []` together with
`projection: { status: "no_canonical_data", canonicalGraphCount: 0 }` and
`estimatedRevenue: null`. A populated but unprojectable field returns
`status: unavailable` and a stable reason, such as
`canonical_snapshot_timestamp_unavailable`; it is not a false-success empty
result. PostgreSQL unavailability returns retryable HTTP 503
`CANONICAL_PERSISTENCE_UNAVAILABLE`.

## Canonical Business Profile editing schema

The visible Financial editor reads and writes the fields consumed by
`canonicalPolarisCalculation`:

| Persisted field | Meaning |
| --- | --- |
| `canonicalPricing.customerMarkupPercent` | Customer markup percentage |
| `canonicalPricing.taxRatePercent` | Explicit configured rate from 0 through 100 |
| `canonicalPricing.emergencyMultiplier` | Emergency multiplier; explicit zero remains zero |
| `canonicalPricing.travelCustomerChargePerMile` | Customer travel charge; explicit zero remains zero |
| `canonicalPricing.minimumJobPrice` | Minimum price; explicit zero remains zero |
| `canonicalCosts.overheadPercent` | Internal overhead percentage |
| `canonicalCosts.travelCostPerMile` | Internal travel cost |
| `canonicalCosts.materialCostByService` | Non-negative numeric cost map |
| `canonicalCosts.equipmentCostByReference` | Non-negative numeric cost map |

Service-specific calculation rules remain in each service's explicit
`canonicalPricing` object. The page does not reproduce that calculation logic.

An empty visible control removes the canonical field and therefore means
missing/not configured. A numeric zero is stored as numeric zero. A finite
positive value is stored exactly. Negative, non-finite, nonnumeric, out-of-range
tax, malformed container, and malformed cost-map values are rejected rather
than defaulted. A saved 9% tax rate reaches the next canonical calculation as
9%; no seven-percent or other tax rate is inferred.

Legacy adaptation is one-way and occurs only when the entire corresponding
`canonicalPricing` or `canonicalCosts` container is genuinely absent. Once a
canonical container exists, legacy `financial` fields cannot fill missing
canonical keys or override canonical values. On a valid write, compatible
legacy display fields are mirrored from canonical values (or removed when the
canonical field is missing); the calculator continues to ignore them as
authority. Each successful explicit Save creates a new persisted profile
id/version/hash. Normal page load performs no write.

The Chrome and WebKit mounted-server scenario saved and reloaded tax `9`,
emergency multiplier `0`, and travel charge `0`, then committed a subsequent
canonical simulation that used those values. Missing remained
`not_configured`; malformed input was blocked before write. Tenant B remained
unchanged. Both engines reported zero pre-Save mutations, zero provider-boundary
requests, zero console/page errors, zero horizontal overflow, and no
`[object Object]` output.

## Canonical Retell Conversation Flow authority

The independently inventoried Retell Conversation Flow Agent V10 has no custom
functions and no MCPs. NorthStar therefore does not advertise or send a local
`getFAQ`/`get_faq` tool, executable closure, MCP configuration, or per-call
callback. `src/voice/canonicalSessionTools.js` and its provider-only replay
helper were removed after the mounted inventory proved they had no legitimate
non-provider consumer. The canonical startup probe rejects loading the legacy
`src/voice/toolRegistry.js` and file-backed Business Profile service.

FAQ and business-information responses remain the responsibility of the ten
native Retell knowledge bases attached to the agent (Company Profile, Customer
FAQ, Lead Qualification, NorthStar AI Behavior Guide, Operations & Escalation,
Policies & Compliance, Pricing & Estimates, Sales Playbook, Scheduling &
Availability, and Services) plus canonical per-call Business Profile dynamic
variables. No knowledge-base content is copied into this repository or the
create-call payload.

Both mounted creation routes first persist a PostgreSQL voice session with the
organization integration owner and exact active Business Profile id, version,
and hash. They then send only `agent_id`, `from_number`, `to_number`, and
`retell_llm_dynamic_variables` to the intercepted create-phone-call boundary.
The exact dynamic-variable keys are `assistant_name`, `company_name`,
`industry`, `owner_name`, `business_description`, `website`, `business_email`,
`business_phone`, `business_hours`, `emergency_policy`, `service_area`,
`services`, `pricing_rules`, `scheduling_rules`, `faq`, `policies`,
`company_values`, `voice_style`, `custom_prompt`, and `northstar_greeting`.
Every value comes from that pinned persisted profile. Caller-supplied business,
tenant, profile, pricing, customer, or scenario fields cannot override them.
Missing values become `not_configured`; malformed values become `unavailable`;
explicit numeric zero is serialized as `0` in the relevant prompt-safe rule.

`POST /api/retell/webhook` remains the existing event webhook for call-started,
call-ended, call-analyzed, transcript, completion, and replay processing. It is
not a custom-function callback and does not execute `getFAQ`. Retell native
knowledge bases, Conversation Flow nodes, transfer/SMS/code/extraction behavior,
and dashboard configuration were not modified by this remediation. The
provider boundary was intercepted throughout validation; no provider request
was transmitted.

## Single production calculation authority

Normal `server.js` startup does not initialize any historical Polaris
`*-engine.js` module. Retired calculator/route modules and the simulation
`service-catalog.js` calculator are absent from the mounted dependency graph.
The only mounted quote calculator is
`src/services/canonicalPolarisCalculation.js`, invoked by the transactional
canonical graph service with the exact pinned Business Profile. SQL projections
aggregate persisted amounts and Retell transport serializes persisted values;
neither recalculates a quote.

## Retell zero, missing, malformed, and tax semantics

- configured zero remains numeric `0` canonically and is encoded as value `0`
  with `configured` disposition inside `pricing_rules`;
- missing remains canonical `null` and is encoded as `not_configured`;
- malformed remains canonical `null` and is encoded as `unavailable`; and
- a configured positive value passes unchanged.

Tax is configured, explicitly zero-rated, or unavailable. No default is
assumed. `pricing_rules` is the only financial variable in the actual global
prompt contract; the obsolete, unused individual financial variables were
removed rather than duplicated. The prompt instructs the agent not to quote,
infer, or replace unavailable values. Replay uses the persisted original
snapshot and pinned profile.

## Mounted legacy route disposition

Supported compatibility reads are adapters over organization-scoped canonical
PostgreSQL projections. Unsupported legacy writes return exact HTTP 409
`LEGACY_AUTHORITY_READ_ONLY` before a historical store can run. Retired methods
and paths return exact HTTP 410 `LEGACY_AUTHORITY_RETIRED` without importing a
retired implementation.

## Canary and observability checks

These remain deployment-owner gates. A canary must verify profile and
integration ownership, operation/replay state, audit persistence, voice-session
identity, projection source graphs, tax disposition, all seven browser
projections, and fail-closed PostgreSQL outage behavior. Zero GitHub checks do
not replace this evidence.

## Rollback and stop criteria

Stop a canary for tenant crossover, stale success during PostgreSQL outage,
duplicate or partial graphs, missing audit rows, profile/provider identity
mismatch, fabricated pricing/tax, false-empty projections, or unexpected file
mutation. Use the deployment owner's immutable release procedure; do not delete
canonical rows, reverse the additive schema destructively, infer ownership, or
backfill from legacy data as a rollback mechanism.

## Deployment-owner gates outside this PR

1. Take and verify the deployment owner's normal database backup.
2. Run migrations 001-009 with the approved non-destructive production
   procedure only after independent approval.
3. Explicitly provision and verify each tenant Business Profile and integration
   ownership record; never infer ownership from historical webhook/file data.
4. Decide whether to provision a dedicated production demo organization. If it
   is absent, keep the safe `503 demo_unavailable` behavior.
5. Perform canary, authenticated production smoke, observability, rollback
   readiness, and final independent review before merge or deployment.
6. Do not automatically import or backfill legacy files, Sheets, `leads`,
   `call_records`, or Polaris JSON.

GitHub CI is evidence only when checks exist. If PR #69 reports zero checks or
workflow runs, CI is unavailable, not passing.

## Final local ratification environment

Validation used PostgreSQL 17.10 in a newly initialized disposable cluster
outside OneDrive at
`C:\Users\joshv\AppData\Local\Temp\NorthStar-M19-Part3-b89f214-authority-remediation\cluster`,
bound only to `127.0.0.1:55441` under PID 32516. Server-side SQL verified the
data directory, listener, port, user `joshv`, and database. The installed
service, port 5432, Railway, staging, production, and existing databases were
never used. Each suite/run/worker/process received a unique database and
isolated data root. PostgreSQL URLs existed only in process environments.

Fresh migrations 001-009 and the 001-003 then 004-009 upgrade path both
succeeded. Both began with zero public tables; the pre-004 upgrade database had
zero canonical tables. After excluding PostgreSQL 17's random dump-control
tokens, the schema-only outputs were identical at 2,263 lines with SHA-256
`caff582625d167d5598564892957e95f641b5066812e36e85ee9a537b01e68db`.
Each had 38 public tables and zero Business Profile, canonical operation,
demo-authority, and voice-session rows.

Installed Chrome reported `150.0.7871.187`. Actual Playwright WebKit reported
`26.5`; its executable SHA-256 was
`5e77e4327329cc988dbf1039a19e62a23e29b9c4eb58f3d473cf2172adde38f2`.

## Exact final commands

The process environment already contained the four verified disposable-cluster
values. The URL is intentionally not stored in this repository.

```powershell
$ErrorActionPreference = 'Stop'
$node = 'C:\Users\joshv\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$git = 'C:\Program Files\Git\cmd\git.exe'
$python = 'C:\Users\joshv\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:NORTHSTAR_NODE_EXE = $node
function Assert-Exit([string]$name) {
  if ($LASTEXITCODE -ne 0) { throw ('{0} failed with exit {1}' -f $name, $LASTEXITCODE) }
}

& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\api\m19-part3-canonical-api-postgres.test.js --runInBand --silent
Assert-Exit 'compatibility projections'
& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\unit\m19-part3-business-profile-authority.test.js .\tests\unit\m19-part3-canonical-calculation.test.js .\tests\api\m19-part3-business-profile-postgres.test.js --runInBand --silent
Assert-Exit 'Business Profile authority'
& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\unit\m19-part3-canonical-voice-tools.test.js .\tests\unit\m19-part3-retell-financial-semantics.test.js .\tests\integration\m19-part3-voice-sessions-postgres.test.js --runInBand --silent
Assert-Exit 'session-scoped voice tools'

$m19 = Get-ChildItem .\tests -Recurse -File -Filter '*m19-part3*.test.js' |
  Sort-Object FullName | ForEach-Object { Resolve-Path -Relative $_.FullName }
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand @m19 --silent
Assert-Exit 'focused Mission 19'
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand .\tests\api --silent
Assert-Exit 'API suite'

& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --silent
Assert-Exit 'serial run 1'
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --silent
Assert-Exit 'serial run 2'
foreach ($seed in @(7331, 91027, 182133331, -182133331, 730194257)) {
  & $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=$seed --showSeed --silent
  Assert-Exit ('four-worker seed {0}' -f $seed)
}
foreach ($seed in @(182133331, -182133331, 730194257)) {
  & $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\api\m19-part3-remediation-mounted-postgres.test.js .\tests\api\m19-part3-canonical-api-postgres.test.js --runInBand --randomize --seed=$seed --showSeed --silent
  Assert-Exit ('isolated provenance/projection seed {0}' -f $seed)
}
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --detectOpenHandles --silent
Assert-Exit 'detect open handles'

foreach ($browser in @('chrome', 'webkit')) {
  & $node .\tests\browser\m19-part3-cross-page-matrix.js ('--browser=' + $browser)
  Assert-Exit ('seven-surface ' + $browser)
  & $node .\tests\browser\m19-part3-business-profile-authority.js ('--browser=' + $browser)
  Assert-Exit ('Business Profile ' + $browser)
}

$changedJavaScript = @(& $git -c core.protectNTFS=false diff --name-only --diff-filter=ACMR 65e20310c4daf7c101f282826edd27606da1c7d5...HEAD -- '*.js')
foreach ($file in $changedJavaScript) {
  & $node --check $file
  if ($LASTEXITCODE -ne 0) { throw ('node --check failed: {0}' -f $file) }
}
Write-Output ('CHANGED_JS_CHECKED={0}' -f $changedJavaScript.Count)
& $python .\tests\ratification\m19-part3-html-inline-parse.py
Assert-Exit 'HTML and inline-script parsing'
& $git -c core.protectNTFS=false diff --check 65e20310c4daf7c101f282826edd27606da1c7d5...HEAD
Assert-Exit 'git diff check'
```

## Final local results

- compatibility projections: 1 suite, 14 tests, exit 0;
- canonical Business Profile authority: 3 suites, 18 tests, exit 0;
- session-scoped voice tools: 3 suites, 13 tests, exit 0;
- complete focused Mission 19 Part 3: 19 suites, 131 tests, exit 0;
- complete API: 6 suites, 74 tests, exit 0;
- both serial runs, both fixed-seed four-worker runs, all three additional
  randomized four-worker runs, and detect-open-handles: 43 suites, 886 tests,
  exit 0 each;
- fixed four-worker seeds `7331` and `91027`, plus randomized seeds
  `182133331`, `-182133331`, and `730194257`, all exit 0;
- isolated provenance/projection seeds `182133331`, `-182133331`, and
  `730194257`: 2 suites, 32 tests, exit 0 each;
- installed Chrome and actual WebKit: 126 assertions across seven surfaces and
  zero automatic mutations in each engine;
- Business Profile Chrome and WebKit: 9% tax and explicit zero emergency/travel
  round trips, post-save calculation, missing/malformed validation, tenant
  isolation, zero pre-Save mutations, and zero provider/console/page/overflow
  failures; and
- all changed-JavaScript syntax, complete HTML/inline-script parsing,
  whitespace, protected-path, data-hash, generated-artifact, and Git topology
  gates exit 0.

The complete PostgreSQL suites cover transactions/idempotency, two-process
concurrency, restart/replay, leases, failure injection, zero partial graph,
connection termination, profile provenance, RBAC, tenant isolation, audit
persistence, provider failure, demo isolation, persistence V2, and
outage/recovery behavior.

## Intermediate failures retained

No intermediate failure was concealed:

1. The first recommendation projector handled only strings and omitted a
   persisted structured recommended action. It was corrected to preserve any
   non-null persisted action through stable canonical ordering; the 14-test
   projection suite and randomized replay runs then passed.
2. The first large Business Profile HTML patch did not match its context and
   failed atomically. It made no partial change; the edit was reapplied in
   bounded hunks.
3. The first Business Profile PostgreSQL fixture allowed a material without a
   canonical rate, so tax was correctly unavailable. The fixture was expanded
   to provide the intended canonical rate, then the exact tax assertion ran.
4. The next tax assertion used unrounded JavaScript floating-point addition.
   The expectation was corrected to the production cent-rounding contract.
5. The first browser scenario attempted to edit a Financial control while its
   section was hidden after reload. It was corrected to select the visible
   Financial section before editing.
6. That rerun exposed real CSP console errors because two middleware directive
   keys used camelCase. The keys were corrected narrowly to CSP kebab-case;
   both browsers then reported zero console errors.
7. The first provider-tool payload assertion banned the substring `file`, which
   incorrectly matched the word `profile`. It was narrowed to the actual legacy
   module/data identifiers and forbidden values, without weakening the pricing
   or provider-boundary assertions.
8. One read-only PowerShell source-inventory command had a quoting error. The
   safely quoted rerun completed; no source or test was affected.
9. A sandboxed GitHub authentication probe reported a network/token failure.
   The required read-only network retry proved the keyring account active and
   both PRs unchanged.
10. The first fresh/upgrade schema comparison treated PostgreSQL 17's random
    `\\restrict`/`\\unrestrict` dump-control tokens as schema content. A first
    normalization regex was also over-escaped. The final read-only comparison
    excluded only those two control lines and proved identical schemas with the
    hash recorded above.

No assertion was skipped, retried as an application workaround, weakened to an
either-value result, serialized in place of required parallel coverage, given a
larger global timeout, or replaced with mock-only evidence. OneDrive remained
closed. PR #69 remains draft/open/unmerged. This PR has not changed Railway, production data, production
schema, deployed code, or PR #66.

## Phantom Retell provider-tool correction

Commit 51 (`c3b18061b0593b25820d0c0027d7265b25c5fb51`) removes the
unsupported provider-tool path after the mounted dependency inventory found no
legitimate non-provider consumer for `canonicalSessionTools.js` or
`getPinnedVoiceSessionTools`. The canonical client no longer contains
`retell_llm_tools`, `createAgentWithTools`, or a per-call `webhook_url` field.
The ordinary `POST /api/retell/webhook` event route remains mounted and
unchanged. The unrelated historical `src/voice/toolRegistry.js` is not loaded by
canonical startup and is not provider authority.

Read-only evidence showed Conversation Flow Agent V10 with ten native knowledge
bases, no tools, and no MCPs. The evidence screenshots, agent identity, private
knowledge-base files, and prompt artifact were not copied into the repository or
sent to Retell. The Retell dashboard was not changed.

### Disposable PostgreSQL evidence for this correction

Validation used PostgreSQL `17.10` in a new task-specific cluster at
`C:\Users\joshv\AppData\Local\Temp\NorthStar-M19-Part3-8754-phantom-retell-20260728\data`.
SQL verified that it listened only at `127.0.0.1:55442`, reported that exact
data directory and port, and began with only the `postgres` and `template1`
connectable databases and zero public tables. Test URLs existed only in process
environments. Every PostgreSQL suite allocated and removed its own
run/suite/worker/process database. After validation, only `postgres` and
`template1` remained and the maintenance database still had zero public tables.
No new migration was added. The installed service, port 5432, existing
databases, Railway, staging, production, and production data were never used.

### Exact correction commands and results

The four disposable-server identity variables were pre-exported in the task
process and are intentionally not written here. These were the final runtime
commands (the PowerShell variables match the earlier command block):

```powershell
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand tests/unit/m19-part3-canonical-voice-tools.test.js tests/unit/m19-part3-retell-financial-semantics.test.js
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand tests/unit/m19-part3-canonical-voice-tools.test.js tests/unit/m19-part3-retell-financial-semantics.test.js tests/integration/m19-part3-voice-sessions-postgres.test.js tests/api/m19-part3-remediation-mounted-postgres.test.js
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --silent tests/api
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --silent
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=182133331 --silent
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=20260728 --silent
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --randomize --seed=511917 --silent --runTestsByPath tests/api/m19-part3-remediation-mounted-postgres.test.js tests/integration/m19-part3-voice-sessions-postgres.test.js tests/unit/m19-part3-retell-financial-semantics.test.js tests/unit/m19-part3-canonical-voice-tools.test.js
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --detectOpenHandles --silent
```

The exact Mission 19 selection was passed to `--runTestsByPath` from sorted
`rg --files tests` results whose test filename begins `m19-part3`, plus
`tests/api/polaris.test.js`. Results:

- mapper/provider contract: 2 suites, 8 tests, exit 0;
- mounted provider, voice provenance, replay, event webhook, failure, outage,
  tenant, restart, and separate-process focus: 4 suites, 31 tests, exit 0;
- exact Mission 19 selection: 20 suites, 162 tests, exit 0;
- complete API selection: 6 suites, 74 tests, exit 0;
- complete serial: 43 suites, 887 tests, exit 0;
- complete four-worker seed `182133331`: 43 suites, 887 tests, exit 0;
- complete four-worker seed `20260728`: 43 suites, 887 tests, exit 0;
- reversed randomized provider/provenance seed `511917`: 4 suites, 31 tests,
  exit 0; and
- complete `--detectOpenHandles`: 43 suites, 887 tests, exit 0 with no reported
  open handle.

Static ratification and focused contract reruns passed 3 suites/18 tests.
`node --check` passed for all seven changed JavaScript files; `git diff
--check`, the generated/untracked scan, all three protected invalid-path
mode/blob/skip-worktree checks, and all 11 repository data SHA-256 checks
passed. No frontend file changed, so the Chrome/WebKit matrices were not rerun
under the server-only correction authorization.

### Intermediate correction ledger

1. The first bulk patch against `src/retell/client.js` failed atomically because
   its copied console rendering used mojibake for an em dash. No partial edit was
   made; bounded UTF-8 hunks then applied cleanly.
2. A broad `--testPathPatterns=m19-part3` command matched the checkout directory
   name and therefore ran the complete 43-suite set. It passed, but was not
   mislabeled as the focused result; the explicit path-list run supplied the
   20-suite/162-test Mission 19 evidence above.
3. One read-only source inventory included a nonexistent `README.md` candidate;
   `rg` reported that path missing while all requested source matches completed.
   No repository state changed.
4. The first final data-hash command used shorthand `recommendations.json`
   instead of tracked `data/polaris-recommendations.json`. It failed without a
   write. The rerun resolved all 11 exact tracked paths through Git and matched
   every published hash, including
   `0970f714a8b9c4937f679e4cbee82a907b9780a1df657e1eb1b8318f59c55547`
   for `data/polaris-recommendations.json`.

No test assertion failed. No assertion was skipped, weakened, retried as an
application workaround, serialized in place of required parallel coverage, or
given a larger global timeout. No live Retell/provider request, webhook request,
Publish action, dashboard mutation, Railway access, production access,
deployment, merge, migration outside the disposable cluster, or PR #66 change
occurred.

The following independently observed Retell configuration topics remain future
work and are not changed by this PR: the unmatched global-prompt quotation mark,
invisible zero-width characters, potential greeting precedence conflict,
Everything/Keep-forever data retention, absent PII redaction, absent Safety
Guardrails, disabled Secure URLs, knowledge-base templates needing populated
Business Profile facts, Mission 20/21 Business Profile/NKA synchronization, and
any future custom-function or MCP design. A normal non-production Retell
call/session canary remains a later deployment-owner gate.
