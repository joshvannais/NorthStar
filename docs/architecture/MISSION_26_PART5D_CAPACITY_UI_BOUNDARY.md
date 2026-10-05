# Mission 26 Part 5D capacity research UI boundary

Status: correction-v2 target-complete candidate. The first candidate at `f0e7fab0285edb242b97f52910e3a1f4fb909811` failed independent whole-slice audit because a normal owner/admin could not discover every accepted prerequisite, action responses were not bound tightly enough to the submitted predecessors, lane and decision reason limits were presented as one limit, the hiring-attention history rule was not explained, and the evidence did not include a real mounted prerequisite-to-recovery journey. Migration 228 and the correction tests address those findings additively; the failed commit remains immutable. This corrected package still requires a separate immutable exact-head audit and release decision before it can become accepted or production-deployed. It does not begin Part 5E or any later Mission 26 slice.

Part 5D mounts one understandable capacity-research journey on the existing paid `/dashboard` surface and the existing isolated fictional `/demo` surface. It introduces no page route. The journey presents the accepted Part 5A workload position, Part 5B constrained-capacity position, and Part 5C qualitative advisory lifecycle together while preserving each accepted authority and its immutable receipt chain.

The interface is research-only. It creates no operational schedule, assignment, reservation, dispatch, estimate, contractor engagement, job offer, hiring or employment decision, commercial or legal action, provider action, or other downstream action. The Part 5C successor-period continuation remains an immutable research receipt with the already accepted fixed-boundary semantics; the interface labels it as research continuation and never presents it as an operational reservation. Part 5A's human unschedule action is not mounted in this interface. Predictions and attention states are never presented as facts or instructions.

## One journey, three accepted authorities

The workload step keeps three registered targets separate and nonnumeric:

1. `workload.accepted_person_hours.v1` is accepted work demand.
2. `workload.end_backlog_hours.v1` is work expected to remain at the end of the research horizon.
3. `capacity.available_role_hours.v1` is base role capacity available during the horizon.

Each target exposes only `authenticated_zero`, `bounded_value`, or `unavailable`. `authenticated_zero` means the exact authenticated private result was zero; it is never inferred from a missing row. `bounded_value` says current bounded evidence exists without disclosing its value. `unavailable` says no current safe evidence exists. Numeric demand, capacity, gap and threshold values remain private.

The constrained-capacity step describes all seven accepted dimensions separately: crew, skill, working hours, location, travel, vehicle, and equipment. Each scope says only whether each dimension applies and whether its private result is authenticated zero, bounded, or unavailable. Alternative and scope tokens are purpose-fixed safe tokens. Alternatives are displayed separately and are never summed, ranked, merged, or converted into a staffing instruction.

The advisory step presents bottleneck, backlog pressure, overtime pressure, contractor attention, and hiring attention only after an explicit human `approve` decision. A `reject` or `withdraw` decision withholds the categories. Hiring may also report `insufficient_history`. These states preserve Part 5C's private policy and natural-history boundary. They do not prove root cause, accuracy, calibration, confidence, statistical significance, legal need, provider truth, credentials, worker availability, asset readiness, contractor suitability, or employment need.

Hiring attention uses a human-selected threshold of 2 through 12 consecutive, gap-free, current evaluated periods for the same alternative, scope, role, method and policy. `insufficient_history` means that exact run is not complete. `clear` means the private rule was evaluated without crossing it. `attention` means the private rule crossed. The interface explains these meanings without returning any private demand, capacity, gap or threshold number.

The selected workload, constrained-capacity, advisory, outcome, evaluation, decision and continuation receipts are safe projections of the accepted immutable records. The bounded history contains exact receipt UUIDs, exact predecessor UUIDs where applicable, immutable period boundaries, revision/action tokens where applicable, and current, stale, pending, activated, missed or stale-continuation state. It never returns digests, source manifests, private results, metrics, thresholds, worker/job/asset/member identities, or numeric demand/capacity/gap data. Older stale receipts remain visible; recovery appends a new receipt and never rewrites or revives the old one.

## Paid projection and mutation boundary

Migration 227 introduced the first bounded UI projection. Migration 228 adds `canonical_forecast_capacity_ui_v2_current`, which preserves that projection and adds safe prerequisite discovery, hiring-policy state, correction-review state, and an exact expected-result revision for every revisioned action. This read-only `SECURITY DEFINER` entry is limited to a current paid owner or administrator in the exact tenant and authenticated session. It takes all accepted source locks, rechecks access after the wait, selects current and historical Part 5A, Part 5B and Part 5C receipts, classifies private values into safe nonnumeric evidence states inside the database, and rechecks access before returning. The bounded projection includes:

- the three exact Part 5A target keys and safe evidence states;
- safe accepted Part 5A origin/evaluation projections;
- safe Part 5B origin/outcome/evaluation projections, safe alternative/scope/role tokens, seven applicability booleans and safe evidence states;
- safe Part 5C origin/outcome/evaluation/continuation projections and human-approved qualitative categories;
- bounded immutable history and one exact current action for each lane;
- one purpose-fixed setup action, safe source token, plain-language label and explanation when an accepted prerequisite can be established; an honest waiting or unavailable state when source authority cannot support it; the current 2-to-12-period hiring policy; and a bounded source-correction review when one is current;
- a server-issued `asOf` instant and fixed source-lineage, calculation and uncertainty boundary tokens.

The paid route is exactly `GET /api/v1/forecast/capacity-advice/journey/current` with no query fields. It uses `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and `Vary: Cookie`. Load and refresh call only this read entry and perform zero forecast mutation. An unsafe, unknown, extra, private, numeric or incomplete projection is rejected and clears the previously displayed current claim.

The setup route is exactly `POST /api/v1/forecast/capacity-advice/journey/setup`. Its body contains only the exact projected action and token, a 2-to-12-period hiring-policy selection, a bounded review reason, confirmation, and the `m26-capacity-ui-setup-v2` confirmation version. The server never accepts a worker, member, job, asset, manifest, private digest, source ID, metric, threshold, period, demand value, capacity value or gap value from the browser. The setup planner derives each required definition from accepted installed NorthStar authority, exposes only a safe source token, and delegates to the accepted Part 5A, Part 5B and Part 5C writers. It can establish workload coverage and methods, accepted role authority and availability, constrained coverage/method/scope, advisory method/policy/demand/epoch, exact completed outcome windows, successor demand, policy revisions and same-period correction review. It fails closed as waiting or unavailable when the real source authority is absent. No enabled setup control is advertised when its accepted writer is guaranteed to refuse.

The additive UI action route is exactly `POST /api/v1/forecast/capacity-advice/journey/actions`. Its body has only:

```json
{
  "action": "purpose-fixed action token",
  "originId": "UUID or null",
  "outcomeId": "UUID or null",
  "correctionOriginId": "UUID or null",
  "expectedRevision": "positive integer or null",
  "reason": "bounded reason or null",
  "confirmed": true,
  "confirmationVersion": "m26-capacity-ui-action-v1"
}
```

The allowlist is limited to the accepted Part 5A, Part 5B and Part 5C capture, preparation, evaluation and research-continuation operations. Unknown fields, private fields, unsupported actions, incorrect token combinations, caller-selected periods, and downstream-action fields are refused before database use. The existing accepted writer remains the authority for each mutation. Actions that save an origin or research continuation accept a 10-to-900-character lane reason. Setup and explicit human review actions accept a 10-to-1000-character review reason. The two fields, limits, disabled states and help copy are separate and exact.

The digest-hidden human-review route is exactly `POST /api/v1/forecast/capacity-advice/origins/:id/safe-decisions`. Its body has only:

```json
{
  "action": "approve | reject | withdraw",
  "expectedDecisionId": "UUID or null",
  "expectedDecisionRevision": 0,
  "reason": "bounded human reason",
  "confirmed": true,
  "confirmationVersion": "m26-capacity-ui-decision-v1"
}
```

The server resolves the private predecessor digest from the exact immutable decision ID and revision, then delegates to the accepted Part 5C decision writer. A missing, stale or cross-tenant-looking receipt is generically unavailable. No private digest crosses the UI boundary.

Every write response has an action-specific exact schema. The server and shared client both require the returned action to equal the submitted action; returned origin and outcome IDs to equal the submitted predecessors where applicable; origin receipts to equal the new origin; outcome receipts to equal the new outcome and differ from the origin; evaluation receipts to differ from both origin and outcome; continuation receipts to equal the new continuation and differ from the predecessor; correction origins to differ from the corrected origin; decision receipts to differ from both the origin and previous decision; and each revision to equal the submitted expected revision or decision revision plus the exact required increment. Required IDs cannot be null, forbidden IDs must be null, and extra IDs or fields are refused. A wrong-row or malformed response causes rollback or a generic unavailable response, poisons the client result, clears the current claim, and is never followed by a misleading refresh.

All three write routes require a current paid owner/admin tenant session, current subscription, CSRF, a 16-to-128-character idempotency key, exact confirmation, and valid predecessor tokens. Private append-only setup and action registries bind each generic endpoint to the exact organization, actor, key and full request digest, including the expected result revision. The accepted underlying writers continue to bind their own exact requests. Access and source currentness are checked after lock waits and before the entry returns. A refusal rolls back the registry and every delegated write, so no partial chain remains.

An uncertain retry reuses the exact endpoint, exact serialized body and exact idempotency key. A known 4xx failure retires that attempt. Conflict requires refresh and a new explicit action. Workspace identity change clears selected IDs, predecessor tokens and uncertain retry state, increments the local identity generation, and discards late completions from the old identity.

The UI workspace identity binds mode, tenant, workspace revision, workspace digest, authenticated session, workspace generation, and expiry. Paid requests begin only after the existing guarded workspace is current. Owner/admin access succeeds; member, dispatcher, cross-tenant, revoked-session, expired-session, past-due-subscription and absent-record cases fail closed with generic privacy. The database remains authoritative even if middleware state is stale.

## Demo isolation

The `/demo` journey uses the same mounted production UI controller and component markup with deterministic fictional receipts. It makes zero paid capacity API calls and performs zero production-table reads or writes. Its states teach source-backed setup, unavailable evidence, current but unreviewed research, human-approved insufficient history and pending continuation, changed-source staleness, append-only recovery with a missed continuation, and activated/evaluated completion.

Demo receipt IDs, periods, safe tokens and category states are fixed fictional values. Demo actions advance only local controller state. Reset returns to the fictional prerequisite-review state with unavailable lane evidence. The existing demo workspace authority continues to enforce the demo and paid two-cookie boundary, reset/expiry semantics and generation invalidation. A workspace identity or generation change clears the local demo generation, selected state, reasons and retries; a late completion from another identity cannot render.

## Rendering and interaction states

The component renders loading, current, recovered, stale, unavailable, restricted, conflict, uncertain and failed states in plain language. It clears stale current claims on any failed refresh or unsafe response. Buttons remain disabled when the current action cannot be taken, during a request, without the required bounded reason, in demo mode for paid actions, or while workspace identity is unavailable. Human review is explicit and keyboard-reachable. Reduced-motion rules disable decorative transitions, and the responsive grid collapses without horizontal page overflow on narrow screens.

The receipt history is disclosure-based, ordered by the bounded server projection and readable without exposing private payloads. Currentness, staleness, recovery, pending activation, activation, a missed fixed deadline, supersession and non-revival have distinct copy. Exact UUIDs are evidence identities, not worker, member, job or asset identities.

## Database and startup security

Migrations 227 and 228 are additive. Migrations 001 through 226 must remain byte-identical. Migration 228 adds private setup and expected-revision action registries with immutable triggers, private source-definition and setup-planning helpers, and four guarded v2 entries. It also corrects the migration-226 demand-review currentness comparison additively by comparing the canonical UTC cutoff as a timestamp rather than as a differently formatted string. It does not rewrite an accepted receipt. `PUBLIC` and the runtime role have no table privilege on either registry and no access to the private helpers or accepted Part 5A, Part 5B and Part 5C receipt tables. The runtime role may execute only the four guarded v2 entries in addition to the sealed v1 compatibility entries.

Startup verifies the migration receipt, exact guarded entries, `SECURITY DEFINER` identity, safe fixed `search_path`, private helper identities, both registry tables, and both immutable registry triggers before reapplying runtime and `PUBLIC` denial. Missing or changed inventory fails closed. Existing production reachability and the accepted route/runtime/public ACL boundaries remain intact.

## Acceptance and evidence limit

Target-complete evidence must prove the exact base and intended Part 5D-only diff, byte identity of migrations through 226, exact schemas and allowlists, private/unknown/extra-field refusal, owner/admin success, lower-role and access-loss denial, generic tenant privacy, CSRF and subscription denial, exact idempotent replay, changed-body/key conflict, rollback without partial chains, identity/currentness binding, late-completion discard, immutable recovery, authentic-zero distinction, and zero mutation on load/refresh.

It must also prove a real mounted disposable-PostgreSQL to guarded HTTP to shared `/dashboard` controller lifecycle from safe prerequisite discovery through workload, constrained-capacity and advisory origins, explicit human review, outcomes, evaluations, continuation, source correction, policy staleness and append-only recovery without manually supplied private IDs. Synthetic browser composition remains separate evidence. The remaining evidence includes deterministic demo isolation, two-cookie behavior, reset/expiry/generation invalidation, zero paid capacity calls and zero production access, desktop and mobile Chrome rendering, Playwright WebKit rendering when available, keyboard use, reduced motion, overflow, all named failure/recovery states, startup/static/security checks, fresh migration 001-to-latest, upgrade 226-to-latest, and regressions for accepted Part 5A, Part 5B, Part 5C, Part 4D and affected Mission 20, Mission 22, Mission 23 and Mission 24 behavior.

Local disposable PostgreSQL and browser proof is synthetic installed-source evidence. CI, private-production tenant evidence, provider/credential evidence, production data, physical Safari or devices, complete accessibility certification, and founder visual approval remain unavailable unless separately obtained. Playwright WebKit is not physical Safari. This document records no independent-audit, merge, deployment or production-verification claim.
