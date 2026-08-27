# Mission 22 — Scheduling and Dispatch

Mission 22 establishes one tenant-scoped canonical assignment and schedule
authority for Calendar/Scheduling, the owner/dispatcher Command Center, and each
employee's scoped mobile Today view. NorthStar may evaluate and recommend, but
only a currently authorized individual may approve a mutation.

This document is the root-ratified implementation contract. Part 1 was
independently accepted, normally merged at
`192ce709caec2fdd873ab7387182e3a66898fb4a`, automatically deployed, and
terminally released. Part 2 was independently accepted, normally merged at
`98bd64733cca439fa28d022ef68457ecd3c5f7ac`, automatically deployed, and
terminally released. Part 3 is implemented on its narrow writer branch and is
awaiting exact-head independent audit and release. Parts 4–7 remain planned and
must not begin before the prior part is independently accepted, normally
merged, automatically deployed, health-clean, and passively accepted.

## Non-negotiable boundaries

- The existing appointment/operation/opportunity tuple is the work anchor. An
  appointment has exactly one stable canonical assignment. Mission 22 does not
  create Mission 23 job-progress or completion authority.
- A primary target is exactly one of unassigned, one active workforce profile,
  or one active crew. Multiple or mixed primary targets are outside v1.
- Target, schedule, and dispatch are orthogonal state axes. A target or schedule
  change after dispatch atomically revokes dispatch and requires a new human
  dispatch approval.
- Every mutation is tenant-bound, exact-revision and exact-digest pinned,
  idempotent, attributable to a current individual, durably approved and
  audited in the same transaction, and rechecked against current authority.
- Browser/request tenant, actor, role, crew, location, permission, session,
  subscription, or recommendation fields never grant authority.
- Missing, stale, malformed, conflicting, or unavailable inputs become
  `needs_review`; they are never invented.
- UTC `TIMESTAMPTZ` is canonical. API instants use RFC 3339 with an explicit
  offset. Tenant display uses its IANA time zone; local folds require an
  explicit choice and gaps reject.
- Business Profile thresholds are explainable warnings unless an accepted
  authority explicitly marks one hard. Mission 22 has no hard-conflict override.
- No new plan tier is introduced. Existing current subscription mutation
  authority remains necessary.
- No live calendar, map, fleet, equipment, telematics, or other provider call,
  credential, configuration, production-data access, provider-accuracy claim,
  automation, or legal/recording/AI-identity decision is authorized.

## Authorization defaults

All mounted mutations require a current cookie session, CSRF validation,
server-derived tenant and actor, active membership, existing subscription
mutation authority, completed onboarding where already required, Calendar
update permission, exact record scope, and action-specific approval.

- Access-role `owner` and `admin` may mutate.
- Access-role `member` may mutate only while its active workforce profile has
  operational role `dispatcher`.
- Crew leads, technicians/employees, estimators, accounting users, and viewers
  do not mutate Mission 22 state by default.
- An employee may later read only work assigned directly to that employee or to
  a crew of which the employee is currently an active member.
- Disabling/removing a member, revoking a session, changing a dispatcher role,
  or making the subscription read-only removes mutation authority immediately.

## Serialized delivery

### Part 1 — Canonical assignment and schedule authority (complete/released)

Add migration 032 and mounted production code for:

- one tenant-bound assignment per canonical appointment, retaining the
  appointment, operation, graph, and opportunity identities;
- exactly one nullable workforce-profile or crew target;
- independent target, schedule, and dispatch states;
- monotonically increasing revisions and deterministic canonical digests;
- immutable revision, approval, audit, and idempotency evidence;
- deterministic `legacy_import` plus `needs_review` backfill without a fabricated
  actor or approval;
- automatic authority creation for newly inserted appointments; an accepted
  initial appointment schedule is copied as compatibility ingress and marked
  `needs_review` without fabricated Mission 22 approval, while every later
  schedule/status mutation requires matching approval evidence;
- strict positive schedule intervals, with invalid legacy schedule bytes
  retained as provenance and normalized to unscheduled/needs-review;
- stale-write and replay protection and atomic compatibility projection to
  `canonical_appointments`;
- database rejection of a direct appointment schedule mutation that lacks the
  matching same-transaction approval evidence;
- schema-qualified scheduling SQL and fixed trusted PostgreSQL function search
  paths so session-local names cannot displace authorization or record scope;
- semantic Calendar controls for an explicit schedule edit, pointer drag/move,
  and pointer resize, with equivalent keyboard and touch confirmation paths;
- explicit reconciliation of the existing mounted appointment PATCH and its
  Calendar caller.

The existing appointment PATCH keeps its path, method, permission prerequisite,
tenant/demo record scoping, status vocabulary, success record, and ordinary
validation meaning. It adds exact `expectedRevision`, `expectedDigest`, an
`Idempotency-Key`, and an approved action code. Missing preconditions return
`428 M22_APPROVAL_REQUIRED`; stale pins and idempotency collisions return 409.
Calendar drag/resize is the explicit human approval and supplies
`calendar_drag_drop` or `calendar_resize`. Durable Mission 22 audit failure
rolls back the mutation. Generic observability audit remains supplementary.

Existing appointment `completed` is compatibility lifecycle metadata only. It
is not Mission 23 progress, time, material, inspection, photo, or completion
evidence. Part 1 exposes no public assign, reassign, unassign, or dispatch
workflow and implements no conflicts, travel, recommendations, new board, or
Today experience.

### Part 2 — Availability, capacity, and conflict authority (complete/released)

Add declared availability and deterministic bounded evaluation from working
hours, active membership/crew composition, skills, approved schedules, location
scope, workload, and Business Profile policy. Known invalid intervals,
inactive/out-of-tenant targets, overlapping people/crew members, explicit
unavailability, known required-skill mismatch, and known location-scope mismatch
are hard conflicts. Non-strict thresholds are warnings. Incomplete authority is
`needs_review`. Cover DST gaps/folds, overnight/multiday work, simultaneous
work, buffers, stable ordering, and membership changes.

Part 2 adds only migration 034 and mounted production modules beneath the
existing `/api/v1/canonical` authority:

- `PUT /availability/profiles/:id` replaces a bounded declared-availability
  window. It requires a current owner/admin or active dispatcher, real cookie
  session and CSRF, current subscription/onboarding/permission authority,
  exact revision/digest/time-zone pins, an idempotency key, and a bounded
  reason. Current authority, immutable revision, actor evidence, audit, and
  one canonical idempotency response commit together or roll back together.
  Each response is uniquely bound to its exact same-transaction revision;
  replay reconstructs that canonical revision response instead of trusting
  caller-selected durable response bytes.
- `POST /appointments/:id/conflicts` evaluates a proposed profile, crew, or
  unassigned target and exact schedule without assigning, scheduling,
  dispatching, recommending, or granting a mutation capability. It returns a
  deterministic content identity/digest with `persisted: false`; Part 2 has no
  durable evaluation sink that an ordinary runtime SQL role could forge.
  Durable preview/approval evidence belongs to Part 4, where current human
  approval and mutation authority are established. Immutable declared-
  availability mutation evidence remains in Part 2.
- Active membership and crew composition, declared availability, service-skill
  authority, exact Business Profile locations/hours/policies, and approved
  canonical schedules are read from mounted PostgreSQL authority. Approved
  person/crew overlap, explicit unavailability, inactive targets, known skill
  mismatch, and known location mismatch are hard. Current Business Profile
  hours, buffers, workload, workday length, and crew-size thresholds are
  warnings because the accepted profile contract contains no hard-policy flag.
  Missing/stale/ambiguous authority and unapproved or legacy-import overlap or
  workload remain visible as `needs_review`. Workload evaluation uses a
  separate tenant-zone local-day evidence set rather than reusing the narrower
  overlap/buffer set, so distant same-day, DST-fold, overnight, and multiday
  approved work remains visible to max-job and workday thresholds.
- Evidence reads are explicitly bounded to 100 candidate crew members, 4,096
  skill rows, 4,096 availability intervals, 1,000 overlapping/buffer schedules,
  and a separately bounded 1,000-schedule workload set. Any truncation forces
  `needs_review`; a conflict or workload fact beyond a bounded set therefore
  cannot yield `clear`.
- RFC 3339 timestamps require explicit offsets that round-trip through the
  current tenant IANA zone. DST gaps reject, fold occurrences remain distinct,
  and positive midnight, overnight, and multiday intervals are bounded to 31
  days. Availability bodies are bounded to 256 KiB, 512 intervals, and a
  366-day coverage window.
- New database functions use fixed `pg_catalog, public` search paths, revoke
  `PUBLIC` execution, and keep all table/function references schema-qualified.
  Migrations 001–033 remain byte-for-byte protected.

Part 2 adds no Calendar/Command Center/Today UI and no browser-executed code, so
it does not claim a new Chrome/WebKit matrix. Existing Part 1 Calendar and
compatibility behavior remain required regression gates. Physical Safari,
hosted checks, providers, and credentials/configuration remain unavailable.

### Part 3 — Route implications and Polaris recommendations (implemented; audit pending)

Create provider-neutral bounded route/travel implications and deterministic,
evidence-pinned candidate recommendations. Authoritative coordinates may yield
distance labelled only as geodesic. Driving distance/time stays unavailable
without authorized evidence. Missing crew coordinates or route evidence is
unavailable/needs-review. A recommendation pins its candidate set, input
revisions/digests, constraints, conflicts, alternatives, uncertainty, and
evaluation time and grants no mutation.

Part 3 adds no schema or durable recommendation sink. Migrations 001–034 remain
byte-for-byte protected and migration 035 is intentionally absent. One mounted
read-only production surface is added beneath the existing canonical authority:

- `POST /appointments/:id/recommendations` accepts only the exact current
  assignment revision/digest and tenant IANA time-zone pins. Candidate IDs,
  tenant, actor, role, permission, session, recommendation, provider, URL, or
  route-evidence fields are rejected rather than trusted. The route requires a
  real current cookie session, CSRF, tenant context, Calendar read permission,
  completed onboarding, a current mutable subscription, and a current
  owner/admin or active dispatcher. Employee/technician and broad viewer
  enumeration remain excluded for Part 6.
- One repeatable-read, read-only PostgreSQL snapshot reloads the exact
  appointment-bound Part 1 authority, current Business Profile, active tenant
  profiles and crews, crew memberships, skills, declared availability,
  approved schedules/workload, and Part 2 conflict policy. Every response pins
  the assignment, appointment/opportunity, Business Profile policy, candidate
  set, per-candidate membership/skill/availability authority, conflict inputs,
  constraints, evaluation time, and one canonical response digest.
- Candidate selection and query shape are bounded to 20 candidates, 100 members
  per crew, 2,000 member links, 4,096 skill rows, 4,096 availability intervals,
  1,000 overlap schedules, 1,000 workload schedules, a 64 KiB request, and a
  256 KiB response. Any candidate/member/evidence truncation or missing current
  schedule makes the result `needs_review` with `rankingComplete: false`.
- Current authoritative Business Profile location coordinates may produce only
  a Haversine spherical geodesic straight-line distance, explicitly labelled
  as neither driving distance nor travel time. Missing, invalid, ambiguous, or
  changed origin/destination authority is digest-visible and remains
  unavailable/needs-review. Driving distance and duration remain null and
  unavailable because no separately authorized current durable provider-neutral
  driving-route evidence authority exists.
- Stable conflict tier, geodesic availability/distance, candidate kind, and
  canonical ID determine ordering and ties. Hard-conflict candidates are
  ineligible; incomplete sets never claim a complete confident ranking.
  Hostile stored labels and explanations remain bounded JSON data. Each result
  is explicit `persisted: false`, `grantsMutation: false`, and makes zero
  provider calls.

Writer evidence uses fresh role-separated PostgreSQL 18.4 UTC and the real
mounted route/session/CSRF/permission/tenant modules. It covers paid/demo
isolation, inactive membership/role/subscription/session changes, IDOR and
smuggled authority, deterministic pins/order/ties/digests, people and crews,
100-member and evidence truncation, Part 2 hard/warning/needs-review inheritance,
geodesic zero/antimeridian/pole/range cases, unavailable/spoofed provider input,
origin/destination change, DST fold/overnight/multiday compatibility, hostile
stored bytes, constant query bounds, response bounds, and blocked transport with
zero external requests. Parts 1–2 remain mounted compatibility gates. Part 3
adds no UI or browser-executed code, so a new Chrome/WebKit matrix is not
applicable; WebKit would not establish physical Safari. Hosted checks, physical
Safari/devices, providers, credentials/configuration, production migration or
deployment, and independent exact-head approval remain unavailable or pending
until their separate gates.

The correction writer additionally closes the prior exact-head audit findings
without broadening Part 3: person candidates receive the same normalized member
shape even when a tenant has no crew; this repository categorically excludes
demo/simulation transcripts instead of accepting request-header session scope;
the exact non-capability POST retains bounded operational telemetry but creates
no generic durable audit row; and an early identity-encoded UTF-8 JSON boundary
enforces the inclusive 65,536-byte raw limit before the global parser while
rejecting decoded duplicate keys and ambiguous/malformed envelopes. Mounted
regressions cover fixed/chunked/absolute-form request targets, security headers,
success/error/replay/concurrency all-table deltas, paid/demo/session substitution,
and profile/crew/empty candidate shapes. The corrected head still requires a
different fresh exact-head independent audit before release.

### Part 4 — Human-approved scheduling and dispatch workflow (planned)

Mount preview and approve for assign, reassign, unassign, schedule, reschedule,
and dispatch. A preview expires after 15 minutes and is not a capability.
Approval pins the exact target, times, current revision, evidence/recommendation
digest, warnings acknowledged, actor, tenant, and reason. The transaction
reloads authority and hard constraints. Stale, replayed, duplicate,
cross-tenant, inactive, out-of-scope, or target-divergent approvals reject.

### Part 5 — Owner and dispatcher experiences (planned)

Calendar/Scheduling is the detailed authoritative board. Command Center is an
overview of unassigned, due-today, overdue, at-risk, and conflicting work; quick
actions use Part 4. Paid and demo surfaces use the same mounted contract, but
demo persistence and sessions remain server-isolated. Cover truthful loading,
empty, restricted, stale, conflict, error, and success states plus accessible
keyboard/dialog behavior and desktop/mobile responsive rendering.

### Part 6 — Crew Today experience (planned)

Deliver the mobile-first self/current-crew view of assigned work, schedule and
dispatch facts, route implications, instructions, and minimum permitted
customer/job/crew context. Exclude margins, internal costs, payroll, billing,
subscriptions, settings, broad customer data, other workers' schedules, and all
Mission 23 execution controls.

### Part 7 — Mission-wide acceptance and release (planned)

Trace one exact assignment through creation/backfill, evaluation,
recommendation, human approval, Calendar, Command Center, Today, reassignment,
reschedule, dispatch revocation, access revocation, and immutable audit. Exercise
fresh and supported-upgrade PostgreSQL 18.x UTC, mounted HTTP, browser,
concurrency, restart/failure, tenant/session/role isolation, hostile stored
content, demo separation, compatibility, exact-head independent audit, normal
merge, sole automatic deployment, exact deployed migration/SHA, health, passive
acceptance, and separate visual/device/provider/legal verdicts.

## Threat and mounted-test ledger

These are attack hypotheses and acceptance targets, not pre-declared findings.

| Threat | Part(s) | Required mounted evidence |
| --- | --- | --- |
| Cross-tenant IDs, relationships, FKs, routes, projections, and browser state | 1, 4–6 | PostgreSQL direct-SQL and mounted HTTP/browser IDOR matrices |
| Request-supplied tenant, actor, role, crew, location, permission, session, or recommendation authority | 1, 3–6 | Real cookie/CSRF tests plus smuggled-field rejection |
| Inactive member, role/crew/plan downgrade, session revocation, or scope change between view/preview/approval | 1, 4, 6 | Mutate durable authority after preview and before commit |
| Concurrent assign/reschedule/reassign, write skew, stale revision, double booking, retry, replay, duplicate, and idempotency collision | 1, 2, 4 | Simultaneous PostgreSQL clients and exact final-history proof |
| UTC/tenant zone, DST gap/fold, midnight, overnight/multiday, clock skew, invalid/negative duration | 1, 2, 4–6 | Fixed-time HTTP plus PostgreSQL UTC matrix |
| Person/crew overlap, unavailable worker, working-hour/capacity/skill/location/buffer constraints, incomplete authority | 2 | Stable hard/warning/needs-review evaluator matrix |
| Missing/stale/spoofed route input, origin change, absent crew coordinates, provider timeout/error/oversize/unsafe URL | 3–6 | Blocked/intercepted transport and zero external requests |
| Recommendation bounds, ordering, evidence pins, stale rejection, alternatives, uncertainty, oracle resistance, and no automatic apply | 3, 4 | Bounded repository/HTTP and approval rejection matrix |
| Approval target/digest divergence, repeated confirmation, direct repository/SQL write, and audit failure | 1, 4 | Transaction/trigger bypass and rollback tests |
| Employee enumeration of other workers/customers/schedules/costs/settings/subscriptions | 6 | Self/crew/cross-worker HTTP and mobile-browser matrix |
| Hostile stored names, addresses, instructions, explanations, and route labels | 1, 3, 5, 6 | Raw PostgreSQL/API bytes and Chrome/WebKit DOM-sink matrix |
| Paid/demo isolation regardless of URL, request, or browser fields | 1, 5, 6 | Paired paid/demo session API and browser matrix |
| Fresh/upgrade constraints, tenant FKs, immutable history, compatibility projection, rollback, and deployed migration identity | 1, 7 | Exact migration blobs/checksums and fresh/supported-upgrade PostgreSQL 18.x UTC |
| Query/index/pagination/snapshot/N+1/resource bounds | 2, 3, 5–7 | High-cardinality query-count/plan and response-limit tests |
| Chrome and actual Playwright WebKit desktop/mobile, light/dark, keyboard/focus/dialog, zoom/reflow, reduced motion, non-color and complete UI states | 5–7 | Visual ledger; WebKit is never called physical Safari |

## Part 1 minimum terminal matrix

- Migration 032 fresh install and every supported upgrade, canonical LF and
  exact SHA-256, role separation, fixed function paths, hostile session-local
  name collisions, and direct-SQL bypass attempts.
- One record per appointment, deterministic valid/invalid legacy backfill, new
  appointment trigger, tenant/identity/target constraints, and immutable rows.
- Deterministic revisions/digests, stale and divergent digest rejection,
  simultaneous writes, replay, duplicate, and idempotency collision behavior.
- Atomic approval, revision, audit, idempotency, current record, and appointment
  projection; forced evidence failure must roll back every byte.
- Current session, CSRF, role, operational dispatcher, subscription, onboarding,
  inactive membership, session revocation, and tenant/demo isolation.
- Existing mounted route, permission, response, status, validation, Calendar
  client, full relevant Jest, PostgreSQL, migration, and startup compatibility.
- Real visible Calendar controls in Chrome and actual Playwright WebKit across
  desktop/light and mobile/dark, including keyboard, touch-equivalent,
  pointer drag/resize, loading, stale, forbidden, error, success, reload,
  exact request count/action pins, and durable PostgreSQL evidence. WebKit is
  not physical Safari.
- Hostile reason/action bytes remain bounded inert data.

## Release gate for every part

Each part uses one narrow branch and draft PR. The writer stops at terminal
evidence. A different fresh read-only auditor reviews the exact immutable head;
all P0–P3 findings are corrected and re-reviewed. Only exact-head approval
permits normal merge. Observe the sole automatic deployment—never manufacture a
pass with a manual redeploy/restart—and record exact merge/deployed SHA,
migrations, credential-free health, authorized passive acceptance, visual
verdict, unavailable evidence, refs, and cleanup. No next part starts before the
release verdict is terminal and clean.

## Explicit exclusions

- Mission 23 field execution, time, equipment hours, materials, inspections,
  maintenance, execution photos/notes, progress, and completion evidence.
- Mission 24 customer price and human price approval.
- Mission 25 outcome learning or imports.
- Mission 28 autonomous or owner-enabled automated scheduling/dispatch.
- Mission 29 custom roles, SSO, MFA policy, thresholds, or enterprise governance.
- Provider SDKs/accounts/credentials/configuration/live calls, production data,
  provider-readiness claims, and legal/recording/AI-identity decisions.
- Destructive replacement of accepted appointment, workforce, asset, Business
  Profile, Command Center, Calendar, demo/session/account, or knowledge authority.
