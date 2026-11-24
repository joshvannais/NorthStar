# Mission 28 Part 14C — isolated paid-application demo parity

Status: **Implementation candidate only. Not independently accepted or
released.** This slice mounts `/demo/automation` inside the existing isolated,
account-free fictional workspace. It does not alter paid tenant data, create a
policy or delivery record, call a provider, contact a recipient, or create an
external, financial, or money effect.

## Shared engines, distinct authorities

Part 14C mounts `automation/businessDecisionEngine` as the common, effect-free
business decision path, rather than renaming the existing read-model
classifiers as engines. Its server-owned controlled input binds exact policy and
source identities, source class and digests, currentness, declarative rule
material, and the exact action family, recipient, channel, provider/effect
class, and authorization. It also binds every permission and collision control,
a tenant-zone calendar schedule, immutable
processing evidence, and recovery state. `evaluate` applies the released Part
5B evaluation precedence and exact input/output digests, Part 5D permission and
collision/suppression precedence, Part 6B zone/calendar/quiet-hour/holiday and
expiration checks, and Part 6F fail-closed recovery decision. It returns only
no-effect decisions and exact zero effect counters.

The runtime source map pins those four released contract files by normalized-LF
SHA-256, and executable tests recompute every binding. All closed control keys
are required; a mandatory global, tenant, provider, source, recent-activity,
duplicate-content, or higher-priority control cannot be marked not applicable.
Recipient and document controls may be not applicable only when their exact
bound scope proves that disposition. This source link does not
turn a candidate digest into authority; the runtime accepts only server-built,
tenant-bound controlled input whose complete component and envelope digests
validate before any decision.

The controlled input does not synthesize positive facts. Exact source value
and complete execution/recovery material are mandatory; missing or null
material is rejected instead of being defaulted to a current source or an
effect-free ready state. The schedule binds the trusted tenant zone, explicit
local date, whole-second local time, exact UTC instant, and an explicit
`not_ambiguous`, `earlier`, or `later` fold resolution. The factory and
evaluator independently prove that exact round trip. A daylight-saving gap,
wrong fold selection, missing field, or UTC/local mismatch fails closed.

The mounted paid call graph is
`routes/automationCenter.preview -> runtimeEngine.buildNoEffectPreview ->
businessDecisionEngine.evaluate`; because that request has no independently
resolved current policy, source, recipient, consent, calendar, or execution
authority, all positive decisions remain unavailable. A preview assessment is
also bound to its exact requested source, action, recipient, and channel. A
different valid setup may still be rendered as a pure preview, but its engine
assessment remains explicitly unavailable instead of borrowing an unrelated
internal policy decision. The isolated call graph
is `routes/demo.preview` or `demoRepository.action ->
runtimeEngine.businessInputForState -> businessDecisionEngine.evaluate ->
runtime transition guard -> demoProjection -> repository.buildSnapshot`.
Initial eligibility/scheduling, corrected-run scheduling, provider-simulation
steps, and previews therefore use the same decision functions. Executable
counterexamples prove equivalent controlled paid/demo inputs produce identical
policy, evaluation, scheduling, suppression, and recovery results, including
source change, policy pause, suppression, calendar expiry, and expired-claim
recovery. Unavailable source lineage remains unavailable rather than becoming
complete ineligibility evidence. Schedule admission cannot predate its bound
source observation, scheduled time is capped at 366 days after admission, and
expiration is independently capped at 367 days. Requests cannot provide or
widen those controlled inputs.

The accepted scheduler's local-time material is whole-second precision and
includes explicit local date, local time, UTC instant, and fold choice. The
runtime preserves fractional trusted observation and admission times, but it
selects the first whole-second due instant at least one hour later. The shared
scheduler rejects a fractional UTC due instant instead of silently rounding or
strengthening it.

Each fictional source version owns an exact observation time. Version one is
observed at the fixed workspace anchor; each later version is observed at its
validated source-change history event. That time is included in the source
digest and carried unchanged through correction, so a later version can never
borrow the anchor or be admitted before the event that introduced it.

After the business decision, paid PostgreSQL rows and isolated fictional rows
also enter the pure mounted `automationCenter/repository` read-model resolvers.
`evaluateEvidence` composes those resolvers into the run-state decision consumed
by `buildSnapshot`; there is no demo-only display precedence. The business
engine and read-model projection are deliberately distinct and both are shared.
The paid preview truthfully labels real provider authority unavailable, while
the isolated demo labels its fixed local simulation; neither creates a provider
attempt. The demo adapter may supply only a closed, validated fictional row in
the production vocabulary. It cannot replace the engines or strengthen
unavailable evidence.

Paid reads remain tenant-private PostgreSQL projections behind owner/admin
authorization. Demo reads use only the opaque `northstar_demo_workspace`
cookie and the existing isolated `demo_command_center_sessions` row. Paid
authentication cookies do not select demo source data, and fictional demo data
has no code path into paid policy, record, scheduler, outbox, provider,
recipient, or financial authority.

The shared business-decision seam preserves each exact canonical UUID identity
across every component digest. It accepts the runtime's closed UUID version
range, including the UUIDv5 tenant and session identities issued by the mounted
demo repository, without rewriting or substituting those identities.

Migration `288_demo_automation_center_action_v1.sql` makes the single
`automation_action` operation a member of the existing closed fictional demo
mutation ledger. It preserves all 23 accepted members, continues to reject
every other operation, and changes no paid table, provider path, recipient, or
effect authority. A dedicated integration gate exercises the actual mounted
repository against PostgreSQL for persistence, revision compare-and-swap
rollback, idempotent replay, and unknown-operation rejection. Fresh successful
PostgreSQL acceptance for this corrected candidate remains unavailable until
the independent gate is executed again.

## Controlled fictional journey

The server owns the fictional anchor time, workspace revision, generation,
source digest, policy version, schedule, and deterministic simulation step.
Requests choose only one member of the closed action catalog: advance one
virtual day, change source, review a source correction, pause, resume,
suppress, record recovery review, run one deterministic local simulation step,
stop, or reset. Requests cannot provide a clock, source document, result,
provider response, recipient, channel credential, money amount, or effect.

The initial source observation, eligibility evidence, and schedule admission
share one coherent fictional anchor; its due time is the first representable
whole-second instant at least one hour later and the initial virtual clock
begins at that due boundary. A source correction records
schedule acceptance at that controlled transition and selects a strictly later
fictional instant. The simulated processing step is unavailable until the
virtual clock reaches that instant; no earlier acceptance time or processing
authority is backfilled.

Each mutation uses the existing demo revision compare-and-swap and idempotency
receipt. A source change makes the captured source stale; correction creates a
new bound policy/run version; processing requires every current source,
lifecycle, stop, schedule and recovery check; suppression blocks the simulated
step; recovery remains recorded/no-effect; terminal stop permits only reset.
The server offers source correction only when that exact hypothetical new run
passes the same shared policy, evaluation, suppression, scheduler, and recovery
predicate used to execute it. A paused policy must be explicitly and validly
resumed first. An expired policy is not revived, and a direct unavailable
correction request returns a conflict without clearing or rewriting authority.
Every action shown in the fictional controls therefore satisfies its actual
server-side transition predicate for the recorded state.
The deterministic provider adapter progresses through recorded processing and
completed internal simulation only. Completion never claims delivery or a
business outcome. A pause/resume preserves the original immutable processing
claim and timestamps. If that claim expires, the journey remains in recovery
until explicit review; any later simulated claim has a new identity and a new
provider-attempt record rather than rewriting the earlier claim.

Reset advances the automation generation, replaces every fictional identity,
clears prior history, and invalidates older pending load, preview, and action
responses in the browser. HTTP 401/403 clears every rendered fictional value
even when the failure belongs to an older request. Current revision conflicts
clear obsolete state because a response mounted later does not prove server
ordering. A current load or mutation failure also invalidates dependent
previews that began while it was pending. Results from superseded action
generations cannot replace a newer reset.

## Effect and evidence boundary

The response carries exact zero counters for recipients, provider calls,
external effects, financial effects, and money effects. Email/SMS availability
is labeled deterministic fictional simulation only. No provider SDK, network
transport, secret, credential, real address, live money, or destructive paid
mutation is mounted by this slice. Candidate source contains 284 migrations
through additive migration 288 with no 289; released production remains
verified only through migration 287 until the pending candidate is accepted.

Writer tests are not independent acceptance. Part 14C audit, PR, merge,
deployment, production behavior, genuine Chrome/WebKit acceptance, physical
Safari/devices, manual assistive-technology review, live provider/private
production evidence, professional review, and founder visual approval remain
unavailable and unclaimed. Mission 31 public guided simulation remains a
separate later authority.
