# Mission 28 Part 14C — isolated paid-application demo parity

Status: **Implementation candidate only. Not independently accepted or
released.** This slice mounts `/demo/automation` inside the existing isolated,
account-free fictional workspace. It does not alter paid tenant data, create a
policy or delivery record, call a provider, contact a recipient, or create an
external, financial, or money effect.

## Shared engines, distinct authorities

Paid PostgreSQL rows and isolated fictional rows both enter the pure mounted
`automationCenter/repository` policy, evaluation, scheduler, suppression, and
recovery resolvers. `evaluateEvidence` composes those same resolvers into the
run-state decision consumed by `buildSnapshot`; there is no demo-only state
precedence. Paid and demo no-effect previews both use
`automation/runtimeEngine.buildNoEffectPreview`, which also executes the same
five resolvers with explicitly unavailable paid source authority and exposes a
zero-effect engine assessment. The paid preview truthfully labels real provider
authority unavailable, while the isolated demo labels its fixed local
simulation; neither creates a provider attempt. The demo adapter may supply
only a closed, validated fictional row in the production vocabulary. It cannot
replace the resolvers or strengthen unavailable evidence.

Paid reads remain tenant-private PostgreSQL projections behind owner/admin
authorization. Demo reads use only the opaque `northstar_demo_workspace`
cookie and the existing isolated `demo_command_center_sessions` row. Paid
authentication cookies do not select demo source data, and fictional demo data
has no code path into paid policy, record, scheduler, outbox, provider,
recipient, or financial authority.

## Controlled fictional journey

The server owns the fictional anchor time, workspace revision, generation,
source digest, policy version, schedule, and deterministic simulation step.
Requests choose only one member of the closed action catalog: advance one
virtual day, change source, review a source correction, pause, resume,
suppress, record recovery review, run one deterministic local simulation step,
stop, or reset. Requests cannot provide a clock, source document, result,
provider response, recipient, channel credential, money amount, or effect.

Each mutation uses the existing demo revision compare-and-swap and idempotency
receipt. A source change makes the captured source stale; correction creates a
new bound policy/run version; processing requires every current source,
lifecycle, stop, schedule and recovery check; suppression blocks the simulated
step; recovery remains recorded/no-effect; terminal stop permits only reset.
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
mutation is mounted by this slice. Migration 287 remains latest and migration
288 remains absent.

Writer tests are not independent acceptance. Part 14C audit, PR, merge,
deployment, production behavior, genuine Chrome/WebKit acceptance, physical
Safari/devices, manual assistive-technology review, live provider/private
production evidence, professional review, and founder visual approval remain
unavailable and unclaimed. Mission 31 public guided simulation remains a
separate later authority.
