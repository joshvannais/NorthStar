# Mission 19 Part 3 canonical authority deployment inventory

This document is an inventory and deployment checklist. PR #69 has not run a
production migration, backfill, customer merge, ownership assignment, demo
provisioning, provider call, Railway change, or deployment.

## Additive PostgreSQL authority

Migration `004_canonical_persistence_v2.sql` remains the immutable canonical
graph foundation. Migration `005_canonical_organization_authority.sql` adds
versioned organization Business Profiles, integration ownership, normalized
identity constraints, and graph provenance. Migration
`006_canonical_voice_sessions.sql` adds organization-scoped voice sessions and
event timelines. Migration `007_canonical_tax_authority.sql` adds explicit tax
disposition without inferring a rate. Migration
`008_canonical_demo_authority.sql` adds only the server-owned demo allow-list.

Migration `009_canonical_voice_provider_identity.sql` separates the stable
canonical public session identifier from the provider identity. It adds
`provider_session_id` and a partial unique provider-identity index. It does not
rename, infer, or backfill historical sessions. A new public demo session keeps
its server-generated `demo-<uuid>` identifier across processes and restarts;
the Retell call id is an attached external identity only.

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
| `POST /api/retell/webhook` | Persisted integration ownership and pinned voice-session profile, then one canonical graph transaction |
| `POST /api/v1/voice/webhook` | Signed transport validation followed by the same canonical ingestion authority |
| `POST /api/v1/voice/call` | Persisted membership/RBAC, organization integration, pinned profile, durable session before the intercepted provider boundary |
| `POST /api/retell/create-call` | The same shared PostgreSQL-first creation service; caller organization/profile/pricing fields grant no authority |
| `POST /api/demo/call` | Server-owned demo organization only; creates one stable canonical session or returns `503 demo_unavailable` |
| `GET /api/demo/:id/status` | Reads the canonical session and events; returns explicit pending, completed, failed, or unavailable lifecycle state |
| `GET /api/demo/:id/transcript` and `/timeline` | Read only the persisted canonical event timeline |
| `GET /api/demo/:id/polaris-estimate` | `not_ready` before completion; the persisted canonical snapshot after successful terminal ingestion |
| Demo simulate/advance/complete/cancel mutations | HTTP 410; lifecycle mutation belongs to canonical provider events, never a public process-local state machine |
| `POST /api/v1/simulations/leads` | Persisted membership/RBAC and one canonical graph transaction after strict service validation |
| Canonical financial/Polaris reads | Organization/session-scoped PostgreSQL projections of immutable snapshots |
| Retired Polaris/engine routes | Exact safe retirement response without importing the deleted implementation |

Unknown, foreign, malformed, and expired demo identifiers share one
non-disclosing `404 demo_session_not_found` response. Before completion, status
and estimate endpoints return `not_ready` rather than 404 or fabricated values.
Provider creation failure is a terminal persisted session/event disposition and
remains readable by the same stable demo id. Completion and replay locate that
same session by its separate provider identity and keep the originally pinned
profile id, version, and hash.

## Single production calculation authority

Normal `server.js` startup no longer initializes any historical Polaris
`*-engine.js` module. The following retired calculator/route modules are
deleted and cannot be imported by a mounted compatibility route:

- `src/polaris/engine.js`;
- `src/polaris/estimation.js`;
- `src/polaris/financial-engine.js`;
- `src/routes/polaris.js`;
- `src/routes/polaris-engines.js`; and
- the process-local `src/retell/webhook.js` demo/legacy writer.

The mounted demo route no longer contains `INDUSTRY_DEFAULTS`, `demoSessions`,
`polarisEstimate`, or `buildPolarisIntelligence`. The deleted simulation
`service-catalog.js` and browser `calcPrice`/`calcBreakdown` fallbacks remain
absent. The production-startup dependency graph contains no historical Polaris
engine module. The runtime load probe starts the normal application, exercises
health, retired Polaris, canonical financial, simulation, demo, and canonical
status surfaces, and rejects any loaded retired calculator.

The only mounted quote calculator is
`src/services/canonicalPolarisCalculation.js`, invoked by the transactional
canonical graph service. It evaluates only the exact pinned Business Profile's
`canonicalPricing` rules. SQL read projections may aggregate persisted amounts,
and Retell transport may serialize persisted profile variables, but neither is
a second quote calculator. Historical engine files that remain for unmounted
test/import reference are not reachable from the normal server graph.

## Simulation service validation

Simulation service selection trims and lowercases an explicit request and then
requires an exact nonfinancial scenario-catalog key. It never substitutes a
random service:

- missing, empty, or whitespace service returns HTTP 422 `service_required`;
- `definitely-unsupported-widget` and any other unknown key return HTTP 422
  `unsupported_service`;
- a case-normalized valid service is accepted;
- a valid scenario service absent from the persisted Business Profile commits
  the canonical graph with `customerFacingPrice: null` and exact
  `service_not_configured` `notCalculated` provenance; and
- a configured service uses only the pinned profile calculation.

Validation occurs before idempotency allocation, scenario construction, graph
ingestion, provider invocation, or file access. Ratification verifies zero new
operations, customers, opportunities, estimates, snapshots, provider calls,
and file changes for all rejected inputs. Caller-supplied `$77,777` pricing and
profile fields cannot create a substituted graph or appear in the response.

## Retell zero, missing, malformed, and tax semantics

The canonical persisted representation and Retell transport representation are
deliberately distinct:

- configured zero remains numeric `0` canonically and string `"0"` with
  `configured` status in Retell variables;
- missing remains canonical `null` and transport `"not_configured"`;
- explicit null or malformed remains canonical `null` and transport
  `"unavailable"`;
- a configured positive value passes unchanged; and
- `pricing_rules` and individual variables carry identical value/disposition.

Tax is configured, explicitly zero-rated, or unavailable. No seven-percent or
other default is assumed. The prompt marks unavailable financial values as
values the agent must not quote. Replay returns the persisted original snapshot
and never recalculates against a newer profile.

## Mounted legacy route disposition

Supported compatibility reads are adapters over organization-scoped canonical
PostgreSQL projections. Unsupported legacy writes return exact HTTP 409
`LEGACY_AUTHORITY_READ_ONLY` before a historical store can run. Retired methods
and paths return exact HTTP 410 `LEGACY_AUTHORITY_RETIRED` without importing a
retired implementation.

## Canary and observability checks

These remain future deployment-owner gates. A canary must verify profile and
integration ownership, operation/replay state, audit persistence, voice-session
identity, tax disposition, all seven browser projections, and fail-closed
PostgreSQL outage behavior. Zero GitHub checks do not replace this evidence.

## Rollback and stop criteria

Stop a canary for tenant crossover, stale success during PostgreSQL outage,
duplicate or partial graphs, missing audit rows, profile/provider identity
mismatch, fabricated pricing/tax, or unexpected file mutation. Use the
deployment owner's immutable release procedure; do not delete canonical rows,
reverse the additive schema destructively, infer ownership, or backfill from
legacy data as a rollback mechanism.

## Deployment-owner gates outside this PR

1. Take and verify the deployment owner's normal database backup.
2. Run migrations 001-009 with the approved non-destructive production
   procedure only after independent approval.
3. Explicitly provision and verify each tenant Business Profile and integration
   ownership record; never infer ownership from historical webhook/file data.
4. Decide whether to provision a dedicated production demo organization. If it
   is absent, keep the safe `503 demo_unavailable` behavior.
5. Perform canary, authenticated production smoke, observability, and rollback
   readiness checks before any merge or deployment.
6. Do not automatically import or backfill legacy files, Sheets, `leads`,
   `call_records`, or Polaris JSON.

GitHub CI is evidence only when checks exist. If PR #69 reports zero checks or
workflow runs, CI is unavailable, not passing.

## Final local ratification ledger

PostgreSQL validation used PostgreSQL 17.10 in a newly initialized disposable
cluster outside OneDrive, bound only to `127.0.0.1:55432`. The installed service,
port 5432, Railway, staging, production, and existing databases were never used.
Every suite/run/worker/process received a unique database and isolated data
root. `DATABASE_URL` and the verifier identity values existed only in command
process environments. The provider boundary was intercepted; no provider call
was transmitted.

Fresh migrations 001-009 and the 001-003 then 004-009 upgrade path both
succeeded. The pre-004 upgrade database had zero canonical tables. Final
inventories matched at 765 schema objects with SHA-256
`f8f0b7ae8dff992f4358050b8b49808b0eec0ffb770b31825164403cb507ce5a`
and zero Business Profile, canonical operation, and demo-authority rows.

The following commands use only checkout-relative Jest suite paths. The four
PostgreSQL verifier environment values must already identify the approved
disposable cluster; the disposable URL is intentionally not stored here.

```powershell
$ErrorActionPreference = 'Stop'
$node = 'C:\Users\joshv\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$git = 'C:\Users\joshv\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe'
$python = 'C:\Users\joshv\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:NORTHSTAR_NODE_EXE = $node
function Assert-ExternalExit([string]$name, [int]$code) { if ($code -ne 0) { throw ('{0} failed with exit {1}' -f $name, $code) } }
$calculationAuthority = @(
  '.\tests\unit\m19-part3-simulation-authority.test.js',
  '.\tests\unit\m19-part3-canonical-calculation.test.js',
  '.\tests\ratification\m19-part3-authority-containment.test.js',
  '.\tests\ratification\m19-part3-production-startup-authority.test.js'
)
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand @calculationAuthority --silent
Assert-ExternalExit 'focused calculation authority' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --silent
Assert-ExternalExit 'mounted authority' $LASTEXITCODE
$m19 = Get-ChildItem .\tests -Recurse -File -Filter '*m19-part3*.test.js' |
  Sort-Object FullName | ForEach-Object { Resolve-Path -Relative $_.FullName }
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand @m19 --silent
Assert-ExternalExit 'focused Mission 19' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand .\tests\api --silent
Assert-ExternalExit 'API suite' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --silent
Assert-ExternalExit 'serial run 1' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --silent
Assert-ExternalExit 'serial run 2' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=7331 --showSeed --silent
Assert-ExternalExit 'fixed seed 7331' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=91027 --showSeed --silent
Assert-ExternalExit 'fixed seed 91027' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=182133331 --showSeed --silent
Assert-ExternalExit 'random seed 182133331' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=-182133331 --showSeed --silent
Assert-ExternalExit 'random seed -182133331' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --maxWorkers=4 --randomize --seed=730194257 --showSeed --silent
Assert-ExternalExit 'random seed 730194257' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --randomize --seed=182133331 --showSeed --silent
Assert-ExternalExit 'isolated seed 182133331' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --randomize --seed=-182133331 --showSeed --silent
Assert-ExternalExit 'isolated seed -182133331' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js .\tests\api\m19-part3-remediation-mounted-postgres.test.js --runInBand --randomize --seed=730194257 --showSeed --silent
Assert-ExternalExit 'isolated seed 730194257' $LASTEXITCODE
& $node .\node_modules\jest\bin\jest.js --config jest.config.js --runInBand --detectOpenHandles --silent
Assert-ExternalExit 'detect-open-handles' $LASTEXITCODE
& $node .\tests\browser\m19-part3-cross-page-matrix.js --browser=chrome
Assert-ExternalExit 'Chrome matrix' $LASTEXITCODE
& $node .\tests\browser\m19-part3-cross-page-matrix.js --browser=webkit
Assert-ExternalExit 'WebKit matrix' $LASTEXITCODE
$changedJavaScript = @(& $git -c core.protectNTFS=false diff --name-only --diff-filter=ACMR 65e20310c4daf7c101f282826edd27606da1c7d5...HEAD -- '*.js')
foreach ($file in $changedJavaScript) { & $node --check $file; if ($LASTEXITCODE -ne 0) { throw ('node --check failed: {0}' -f $file) } }
Write-Output ('CHANGED_JS_CHECKED={0}' -f $changedJavaScript.Count)
& $python .\tests\ratification\m19-part3-html-inline-parse.py
Assert-ExternalExit 'HTML and inline-script parsing' $LASTEXITCODE
```

Final results for those commands:

- focused startup/calculation authority: 4 suites, 27 tests, exit 0;
- mounted simulation/demo/PostgreSQL authority: 1 suite, 18 tests, exit 0;
- complete focused Mission 19 Part 3: 16 suites, 120 tests, exit 0;
- complete API: 5 suites, 69 tests, exit 0;
- both serial, both fixed-seed four-worker, all three required randomized
  four-worker, and detect-open-handles runs: 40 suites, 875 tests, exit 0 each;
- isolated mounted suite at seeds `182133331`, `-182133331`, and `730194257`:
  1 suite, 18 tests, exit 0 each;
- installed Chrome 150.0.7871.182 and actual Playwright WebKit binary SHA-256
  `5e77e4327329cc988dbf1039a19e62a23e29b9c4eb58f3d473cf2172adde38f2`:
  126 assertions across seven surfaces and zero automatic mutations each;
- `node --check`: 89 changed JavaScript files, exit 0; and
- HTML/inline parsing: 8 complete documents and 17 complete inline scripts,
  exit 0.

The complete PostgreSQL suites cover transaction/idempotency, concurrency,
restart/replay, failure injection, zero partial graph, profile provenance, tax
disposition, RBAC, tenant isolation, cache outage, connection termination,
audit persistence, provider failure, stable demo identity, and cross-process
demo reads. Repository data-file hashes, protected paths, Git topology, and
generated-artifact scans are separate final integrity gates.

## Intermediate failures retained

This remediation retained every intermediate failure:

1. The first focused static run passed the runtime load probe but found one
   stale source-string assertion after canonical webhook identity resolution
   changed from a declaration to an assignment. The narrow assertion was
   corrected and the complete focused/full matrices passed.
2. The first PostgreSQL test attempt supplied `postgres` in the disposable URL,
   while this Windows `initdb` had created the local superuser `joshv`. It
   stopped before migrations or tests. Read-only identity verification proved
   `current_user=joshv`; the corrected disposable URL then passed.
3. Fresh and upgrade migrations and schema comparison succeeded, but the first
   hash-report command used the unavailable Windows PowerShell
   `SHA256.HashData` API. The compatible read-only `SHA256.Create().ComputeHash`
   command produced the schema hash recorded above.
4. Earlier immutable commits retain the deterministic seed `182133331`
   provenance dependency, reversed/first/last reruns, stale fixture corrections,
   Windows inline-parser encoding correction, migration identity guard
   correction, and data-hash transcription correction. They were not hidden or
   replaced by narrowed final evidence.
5. The first clean-session reproduction of the committed command block exposed
   a stale documentation-ratification phrase and a quoted PowerShell output line
   that was not portable through `-Command`. The block also lacked per-process
   exit enforcement, so later successful parser output masked the earlier Jest
   exit. The document now restores the required legacy/canary/rollback evidence,
   uses `Write-Output`, and throws after every external command before this full
   block is rerun.
6. The first narrow documentation rerun showed that line wrapping had split the
   exact production-boundary phrase expected by ratification. Its standalone
   parser command also omitted the documented `NORTHSTAR_NODE_EXE` process value.
   The wording is now contiguous, and the parser rerun uses the same process-only
   Node environment as the committed command block.
7. The next verbatim clean-session launch stopped before any test because Windows
   `powershell.exe -Command` removed embedded double quotes from the helper's
   interpolated `throw` expression. Both diagnostic expressions now use
   single-quoted format operands that survive the documented launch boundary.
8. The first final-integrity verifier command abbreviated four `polaris-*` data
   filenames, passed an unquoted revision range to one diff-stat invocation,
   attempted `Test-Path` on an intentionally Windows-invalid name, and called the
   privilege-requiring `Get-NetTCPConnection`. The corrected read-only pass used
   the exact eleven baseline filenames, a quoted revision range, parent-directory
   name enumeration, SQL server identity, and `netstat`; every hash, path, and
   loopback server assertion passed.

No assertion was weakened, skipped, retried as an application workaround,
serialized globally, given a larger global timeout, or replaced by lower
concurrency. PR #69 remains draft and unmerged. This PR has not changed Railway, production data, production schema, or PR #66.
