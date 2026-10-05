# Mission 26 Part 5D capacity research UI boundary

Status: target-complete candidate. This package requires a separate immutable exact-head audit and release decision before it can become accepted or production-deployed. It does not begin Part 5E or any later Mission 26 slice.

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

The selected workload, constrained-capacity, advisory, outcome, evaluation, decision and continuation receipts are safe projections of the accepted immutable records. The bounded history contains exact receipt UUIDs, exact predecessor UUIDs where applicable, immutable period boundaries, revision/action tokens where applicable, and current, stale, pending, activated, missed or stale-continuation state. It never returns digests, source manifests, private results, metrics, thresholds, worker/job/asset/member identities, or numeric demand/capacity/gap data. Older stale receipts remain visible; recovery appends a new receipt and never rewrites or revives the old one.

## Paid projection and mutation boundary

Migration 227 adds `canonical_forecast_capacity_ui_v1_current`. This read-only `SECURITY DEFINER` entry is limited to a current paid owner or administrator in the exact tenant and authenticated session. It takes all accepted source locks, rechecks access after the wait, selects current and historical Part 5A, Part 5B and Part 5C receipts, classifies private values into safe nonnumeric evidence states inside the database, and rechecks access before returning. The bounded projection includes:

- the three exact Part 5A target keys and safe evidence states;
- safe accepted Part 5A origin/evaluation projections;
- safe Part 5B origin/outcome/evaluation projections, safe alternative/scope/role tokens, seven applicability booleans and safe evidence states;
- safe Part 5C origin/outcome/evaluation/continuation projections and human-approved qualitative categories;
- bounded immutable history and one exact current action for each lane;
- a server-issued `asOf` instant and fixed source-lineage, calculation and uncertainty boundary tokens.

The paid route is exactly `GET /api/v1/forecast/capacity-advice/journey/current` with no query fields. It uses `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and `Vary: Cookie`. Load and refresh call only this read entry and perform zero forecast mutation. An unsafe, unknown, extra, private, numeric or incomplete projection is rejected and clears the previously displayed current claim.

The additive UI action route is exactly `POST /api/v1/forecast/capacity-advice/journey/actions`. Its body has only:

```json
{
  "action": "purpose-fixed action token",
  "originId": "UUID or null",
  "outcomeId": "UUID or null",
  "correctionOriginId": "UUID or null",
  "reason": "bounded reason or null",
  "confirmed": true,
  "confirmationVersion": "m26-capacity-ui-action-v1"
}
```

The allowlist is limited to the accepted Part 5A, Part 5B and Part 5C capture, preparation, evaluation and research-continuation operations. Unknown fields, private fields, unsupported actions, incorrect token combinations, caller-selected periods, and downstream-action fields are refused before database use. The existing accepted writer remains the authority for each mutation.

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

Both write routes require a current paid owner/admin tenant session, current subscription, CSRF, a 16-to-128-character idempotency key, exact confirmation, and valid predecessor tokens. A private append-only UI action registry binds the generic action endpoint to the exact actor, key and request digest so the same key cannot change action or body. The accepted underlying writers continue to bind their own exact requests. Access and source currentness are checked after lock waits and before the entry returns. A refusal rolls back the registry and every delegated write, so no partial chain remains.

An uncertain retry reuses the exact endpoint, exact serialized body and exact idempotency key. A known 4xx failure retires that attempt. Conflict requires refresh and a new explicit action. Workspace identity change clears selected IDs, predecessor tokens and uncertain retry state, increments the local identity generation, and discards late completions from the old identity.

The UI workspace identity binds mode, tenant, workspace revision, workspace digest, authenticated session, workspace generation, and expiry. Paid requests begin only after the existing guarded workspace is current. Owner/admin access succeeds; member, dispatcher, cross-tenant, revoked-session, expired-session, past-due-subscription and absent-record cases fail closed with generic privacy. The database remains authoritative even if middleware state is stale.

## Demo isolation

The `/demo` journey uses the same mounted production UI controller and component markup with deterministic fictional receipts. It makes zero paid capacity API calls and performs zero production-table reads or writes. Its states teach unavailable evidence, current but unreviewed research, human-approved pending continuation, changed-source staleness, append-only recovery with a missed continuation, and activated/evaluated completion.

Demo receipt IDs, periods, safe tokens and category states are fixed fictional values. Demo actions advance only local controller state. Reset returns to the unavailable state. The existing demo workspace authority continues to enforce the demo and paid two-cookie boundary, reset/expiry semantics and generation invalidation. A workspace identity or generation change clears the local demo generation and selected state; a late completion from another identity cannot render.

## Rendering and interaction states

The component renders loading, current, recovered, stale, unavailable, restricted, conflict, uncertain and failed states in plain language. It clears stale current claims on any failed refresh or unsafe response. Buttons remain disabled when the current action cannot be taken, during a request, without the required bounded reason, in demo mode for paid actions, or while workspace identity is unavailable. Human review is explicit and keyboard-reachable. Reduced-motion rules disable decorative transitions, and the responsive grid collapses without horizontal page overflow on narrow screens.

The receipt history is disclosure-based, ordered by the bounded server projection and readable without exposing private payloads. Currentness, staleness, recovery, pending activation, activation, a missed fixed deadline, supersession and non-revival have distinct copy. Exact UUIDs are evidence identities, not worker, member, job or asset identities.

## Database and startup security

Migration 227 is additive. Migrations 001 through 226 must remain byte-identical. It adds only the private UI action registry, its immutable trigger, one safe history helper, the guarded read entry and the two guarded write adapters. `PUBLIC` and the runtime role have no table privilege on the registry and no access to the private helper or accepted Part 5A, Part 5B and Part 5C receipt tables. The runtime role may execute only the three guarded Part 5D entries.

Startup verifies the migration receipt, exact guarded entries, `SECURITY DEFINER` identity, safe fixed `search_path`, private helper identity, registry table, and immutable registry trigger before reapplying runtime and `PUBLIC` denial. Missing or changed inventory fails closed. Existing production reachability and the accepted route/runtime/public ACL boundaries remain intact.

## Acceptance and evidence limit

Target-complete evidence must prove the exact base and intended Part 5D-only diff, byte identity of migrations through 226, exact schemas and allowlists, private/unknown/extra-field refusal, owner/admin success, lower-role and access-loss denial, generic tenant privacy, CSRF and subscription denial, exact idempotent replay, changed-body/key conflict, rollback without partial chains, identity/currentness binding, late-completion discard, immutable recovery, authentic-zero distinction, and zero mutation on load/refresh.

It must also prove deterministic demo isolation, two-cookie behavior, reset/expiry/generation invalidation, zero paid capacity calls and zero production access, desktop and mobile Chrome rendering, Playwright WebKit rendering when available, keyboard use, reduced motion, overflow, all named failure/recovery states, startup/static/security checks, fresh migration 001-to-227, upgrade 226-to-227, and regressions for accepted Part 5A, Part 5B, Part 5C, Part 4D and affected Mission 20, Mission 22, Mission 23 and Mission 24 behavior.

Local disposable PostgreSQL and browser proof is synthetic installed-source evidence. CI, private-production tenant evidence, provider/credential evidence, production data, physical Safari or devices, complete accessibility certification, and founder visual approval remain unavailable unless separately obtained. Playwright WebKit is not physical Safari. This document records no independent-audit, merge, deployment or production-verification claim.
