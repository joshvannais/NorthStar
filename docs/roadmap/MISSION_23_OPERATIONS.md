# Mission 23 — Operations

Mission 23 establishes the tenant-scoped operating authority for what actually
happens while scheduled work is performed. It connects the accepted customer,
opportunity, appointment, assignment, workforce, asset, Business Profile, and
knowledge authorities without replacing any of them.

## Ratified status

- **Part 1: independently accepted, merged, deployed, and production-accepted at
  `935a27e94f5df2869308a1b1ac691d212f35ae94`.**
- **Part 2: independently accepted, normally merged, automatically deployed,
  first-start production-applied, and later-start zero-op verified.** The
  implementation applied at `403576639ea0223a2a18340d87882a6cdfa47ca4`; the
  independently accepted receipt follow-up merged as
  `e8c30f96d9c0bc0c4287c1f181a400e3cedd4748`. The exact migration 038 row,
  healthy first start, later automatic container start with no migration
  application, and unchanged one-row checksum/timestamp are recorded.
- **Part 3: independently accepted, normally merged, automatically deployed,
  production-applied, health verified, and later-start zero-op verified.** The
  independent audit of first candidate head
  `a08421e601a0125a89298c3dca68dea2e1d888b1` required one P1 and two P2
  corrections. A second independent audit of corrected head
  `b92036215618ef2b26804fc7fce300ea3d34f331` found no P0/P1 finding and one
  remaining P2 transcript-source normalization gap. Forward-only migration 041
  closed that gap. Exact accepted candidate
  `8de66512d1baa335e4e7151b6a7232c94de9dc0a` merged as
  `ee6cac8b729f73a5af22c7d5747fd52c1d1d4035`; automatic Railway deployment
  `e1d88caa-339e-49b6-a08a-60cd20eddcf9` applied migrations 039–041 once and
  returned healthy canonical PostgreSQL persistence. Receipt head
  `2abef4be3e31c2c468762598edc0e79859f67c2f` merged normally through PR #164
  as `15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`; automatic Railway deployment
  `2b498fe1-d025-4be7-bd90-cef6154f9bb8` supplied the separate later ordinary
  application start with no migration application and unchanged exact one-row
  checksums and original timestamps for migrations 039–041.
- **Part 4: audit-correction writer candidate in progress after the first
  independent review; not accepted, merged, deployed, or production-applied.**
- **Parts 5–12: not implemented.**
- Part 1's no-runtime statements remain historical evidence about its exact
  released diff. They do not describe the deployed Part 2 implementation.
- Every later part must update status only after its own exact-head audit and
  terminal release. A writer test result is never a release claim.

The twelve-part sequence in this document is authoritative. It must not be
renumbered, compressed, reordered, or silently widened.

## Product outcome

NorthStar must answer, with attributable evidence rather than inference:

- What work was dispatched, what work was actually performed, and by whom?
- When did labor occur, what materials were used, and which equipment was
  operated?
- Which checklist, inspection, photo, note, reading, exception, or change fact
  supports the current state?
- What remains incomplete or blocked, and what human decision is required?
- Who proposed completion, who approved it, and why was work later reopened?

Mission 23 is operational evidence. It is not a substitute for payroll,
professional safety judgment, a customer-approved quote, an invoice, payment,
legal acceptance, or an AI-generated conclusion.

## Live-state reconciliation at the Part 1 base

Part 1 was reconciled against `main` revision
`1147f064916d8d3b2ea6e630daeac8a7984dcb4b`.

The Mission 22 document's opening status paragraph predates its final release,
but the Part 1 base contains the normal Mission 22 Part 7 merge
`415ca4dad374bc8c0ea062028dcea7a638090f86`. Mission 23 relies on the mounted
accepted Mission 22 authority and does not carry that stale status sentence
forward as current release truth.

| Existing authority or code | Current truth | Mission 23 treatment |
| --- | --- | --- |
| `canonical_operations` and the canonical customer graph | The table identifies an ingestion/idempotency operation and its canonical graph. The word `operations` does not make it a field-job authority. | Preserve it. A field-execution record may retain its operation and graph anchors, but must use a distinct Mission 23 identity and contract. |
| `canonical_opportunities` and `canonical_appointments` | They hold recognized work and appointment compatibility facts. An appointment status of `completed` is not field progress, labor, material, inspection, photo, or completion evidence. | Preserve the bytes and semantics. Never backfill Mission 23 completion from the compatibility status alone. |
| Mission 22 canonical assignment and schedule authority | It owns target, schedule, dispatch, conflicts, recommendations, human approval, Calendar, Command Center, and read-only employee Today scope. | Reuse exact current assignment revision/digest pins. Never rewrite schedule or dispatch state from an execution route. |
| Mission 20 Business Profile and workforce | It owns business identity, locations, services, workforce profiles, crews, skills, access roles, policies, and normalized configuration. | Read only the current authorized fields required for execution. Mission 23 does not create new workforce or access-role authority. |
| Mission 20 asset catalogue | It owns tenant asset identity, category, make/model/configuration, home location, capabilities, and catalogue lifecycle. Migration 016 explicitly excludes assignments, availability, meters, condition, maintenance, faults, downtime, telematics, and costs. | Keep identity in Mission 20. Mission 23 owns tenant-private execution usage, readings, condition observations, downtime, and maintenance events linked to that exact asset identity. |
| Mission 21 knowledge | It owns versioned, published, provenance-backed knowledge and minimized provider-neutral projections. Knowledge never authorizes a tool or mutation. | Mission 23 may pin published instructions/checklists as inputs and may create operational evidence for later review; it does not mutate published knowledge. |
| `src/polaris/job-engine.js` and `src/polaris/asset-engine.js` | These are legacy in-memory/file-era engines with generated IDs, mutable objects, swallowed persistence errors, and no current tenant/revision/database authority. Legacy `/api/v1/jobs`, `/api/v1/workflows`, and `/api/v1/assets` authority paths are retired with `410`; normalized `/api/assets` is the Mission 20 catalogue. | Do not mount, migrate, copy, or treat legacy engine state as canonical. Later parts may replace reachable presentation with new mounted authorities, but may not relabel legacy state as accepted evidence. |
| Mission 22 Today page | It is a minimized, read-only view of work currently assigned directly to the active worker or to a current crew. | Part 9 may add execution experiences only after Parts 2–8 establish server authority. Browser state is never the record of work. |
| Mission 24–32 | No later mission grants present Mission 23 authority. | Keep every downstream boundary explicit; no forward implementation is implied. |

There is no accepted Mission 23 migration, table, route, repository, or browser
mutation at this base. Any existing demo copy, analytics output, recommendation,
appointment status, legacy object, or browser-local value that resembles job
progress remains non-authoritative.

## Part 2 deployed implementation boundary

The Part 2 implementation is additive to the released Part 1 base. It creates
one distinct current execution per canonical appointment plus immutable event,
revision, audit, and idempotency evidence. The exact upstream operation, graph,
opportunity, appointment, and Mission 22 assignment identities are retained;
each mutation must match the current assignment revision and digest.

The implementation deliberately implements only these lifecycle facts:

- initialization into `not_started`;
- `start`: `not_started` to `in_progress`;
- `pause`: `in_progress` to `paused`; and
- `resume`: `paused` to `in_progress`.

It mounts only:

- `POST /api/v1/field-executions/appointments/:appointmentId`;
- `POST /api/v1/field-executions/:executionId/transitions`; and
- `GET /api/v1/field-executions/:executionId`.

Mutation bytes are owned before the general JSON parser, require exact UTF-8
JSON and an idempotency key, and reject duplicate keys, compression, extra
authority fields, missing pins, and oversize requests. Authenticated requests use
the existing bounded internal-API availability rate limit keyed by server-derived
tenant and individual account; database statement/lock/transaction deadlines and
record/replay locks bound concurrent work. The route derives tenant, individual
account, access role, session, and CSRF evidence from the current server-
authenticated request. PostgreSQL independently reloads the membership,
account, workforce profile, session, subscription, onboarding, assignment, crew,
appointment, and transcript authority inside the transaction. Owners and
administrators may act tenant-wide; a member may act only on a direct assignment
or current crew assignment. Dispatcher operational role alone grants nothing;
viewers cannot mutate. Reads remain tenant-private and assigned-member bounded.

The runtime role has no direct table or helper-function authority. It may invoke
only the three `SECURITY DEFINER` entry points. Writes use serializable
transactions; reads use repeatable-read, read-only snapshots. PostgreSQL computes
the canonical request and current-state digests, hashes idempotency keys, locks
replay identity, rejects stale pins, and requires current state plus matching
immutable event/revision/audit/idempotency evidence to commit atomically.
Before either mutation entry point returns an exact cached response, PostgreSQL
revalidates the active actor/session/subscription authority and reloads the
stored execution's exact current assignment, appointment, and transcript links.
The replay remains available across a benign assignment revision only while the
actor still has direct or current active-crew scope, dispatch remains current,
the appointment remains eligible, and the source remains non-demo. Reassignment,
crew removal or actor inactivation, dispatch or assignment revocation,
appointment completion/cancellation, demo-source invalidation, subscription or
session loss, and permission loss fail closed before cached response disclosure
without inserting or changing any current, history, audit, or replay evidence.

No Part 2 route writes schedule/dispatch state, time, labor, materials,
inventory, equipment, vehicles, machinery, files, notes, progress, blockers,
changes, completion, reopening, UI, Polaris, provider state, price, invoice, or
payment. Demo/simulation transcript sources are rejected. Retired legacy job,
workflow, and asset routes remain non-authoritative.

Disposable PostgreSQL and writer tests remain candidate evidence only. The
independent audit, normal merge, sole automatic deployment, first production
application, exact migration ledger row, and credential-free health are now
separately recorded in
`outputs/m23-part2-writer/PRODUCTION_APPLICATION_RECEIPT.md`. That receipt proves
the frozen 038 was applied once on the first deployed start and that a later
ordinary automatic start was zero-op with the original row, checksum, and
application timestamp unchanged. A backup/restore rehearsal remains unavailable.
The authorized conservative release disposition permits only a reviewed forward
fix and forbids destructive database rollback.

## Part 3 deployed implementation boundary

The Part 3 implementation is additive to the exact deployed Part 2 receipt base. It
records operational labor/time evidence only: individually attributable timer
and manual intervals tied to the exact current field execution and Mission 22
assignment revision/digest; an explicit versioned category vocabulary; UTC
instants plus raw RFC3339 offsets and the pinned tenant Business Profile time-
zone version/hash used for local display; immutable events, revisions, audits,
idempotency receipts, review decisions, and correction history; worker-wide
overlap/open-timer gates; and bounded operational summaries.

The server derives tenant, individual actor, session, role, and CSRF authority.
PostgreSQL reloads the current membership/account/workforce/session/
subscription/onboarding, direct or active-crew assignment, dispatch, execution,
Business Profile, and non-demo transcript authority on every mutation,
including cached replay. Writes are serializable and use worker/idempotency
locks; reads use repeatable-read read-only snapshots. The runtime role has no
direct table/helper access and can invoke only the two labor entry points.

The first candidate's independent audit found that review could restore a
rejected interval into an overlap, a manual/correction end instant could exceed
the future ceiling, and case/whitespace transcript-source variants could bypass
demo/simulation isolation. Frozen migration 039 remains unchanged. Forward-only
migration 040 redefines only the two labor entry functions: any review that
would restore authoritative evidence now passes the same serialized worker-wide
overlap gate before an evidence write; both manual/correction endpoints must be
no more than five minutes in the future; and every Part 3 mutation/read source
gate, including the pre-replay path, uses case-folded space trimming.

The second independent audit proved that PostgreSQL's default `btrim(source)`
does not remove TAB, newline, or other non-space edge characters, so a source
such as TAB + `demo` + TAB could bypass the 040 denylist on mutation, exact
replay, and read. Migrations 039 and 040 remain byte-for-byte frozen.
Forward-only migration 041 installs one fail-closed classifier used by both
Part 3 entry functions before replay or disclosure. It explicitly trims the
ASCII whitespace characters TAB, LF, VT, FF, CR, and space plus the Unicode
White_Space edge set; accepts only the canonical production sources `lead`,
`retell`, and `voice`; and rejects demo, simulation, unknown, embedded-control,
and otherwise ambiguous values.
Observed or manually entered intervals are evidence of recorded operational
time. They are not payroll timecards, wages, billable hours, customer pricing,
profitability, overtime/break compliance, tax, employment classification,
union, geolocation, consent, or any legal conclusion. Part 3 does not add
materials, inventory, equipment, files, checklists, notes, progress, blockers,
changes, completion, reopening, UI, Polaris, providers, or later-part behavior.
It preserves Part 2 lifecycle state and every Mission 20–32 authority boundary.

The exact accepted Part 3 candidate
`8de66512d1baa335e4e7151b6a7232c94de9dc0a` merged normally as
`ee6cac8b729f73a5af22c7d5747fd52c1d1d4035`. Its sole automatic deployment
applied migrations 039, 040, and 041 once. The read-only production ledger
contains 39 rows and exactly one matching checksum row for each migration, all
with `applied_at = 2026-09-04T14:30:01.345Z`; three credential-free health GETs
returned HTTP 200 with PostgreSQL and canonical persistence healthy.

The separate later-start zero-op is recorded in
`outputs/m23-part3-writer/LATER_START_ZERO_OP_RECEIPT.md`. PR #164 merged
normally as `15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`; automatic Railway
deployment `2b498fe1-d025-4be7-bd90-cef6154f9bb8` produced the later ordinary
application start with no migration application. The read-only ledger remained
at 39 rows with exactly one unchanged checksum row for each of 039, 040, and
041 and the original common `applied_at = 2026-09-04T14:30:01.345Z`.
Part 3's later-start gate is therefore achieved rather than pending.

Part 3 changes no rendered surface. That no-UI boundary prevents a premature
visual implementation; it is not browser or founder visual approval. The Part
9 experience must use the then-current deployed NorthStar design system as its
minimum bar across typography, spacing, radii, borders, cards/drawers,
responsive widths, controls, dark/light themes, mobile/desktop behavior,
accessibility, mounted Chrome, Playwright WebKit, and visual inspection.

## Part 4 writer-candidate implementation boundary

Part 4 adds tenant-scoped material movement evidence to the exact current Part
2 field execution and Mission 22 assignment pins. The candidate recognizes
only explicit `adjustment`, `consumed`, `returned`, `transferred`, and `waste`
facts. Each fact records a positive bounded decimal quantity, an opaque
tenant-authored material key and unit code under the pinned
`m23-material-unit-v1` contract (digest
`8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba`),
optional source/destination location keys and
lot code, performer, recorder, observed server instant, review state, and exact
execution/assignment revision and digest. The unit contract applies no
conversion and never treats two unit codes as interchangeable.

The candidate uses immutable events, revision snapshots, audit evidence, and
idempotency receipts around one versioned current projection. Corrections
advance the original record while preserving every earlier revision. Reversal
creates a separate exactly linked compensating record; it never deletes or
rewrites the original. Tenant-wide serializable ledger locking makes concurrent
retries and balance decisions deterministic. Owner/administrator review may
accept or reject evidence only when the resulting recorded-movement balance is
bounded; unresolved underflow or absent location evidence remains explicitly
`needs_review`. Adjustments always require owner/administrator authority and
review. A recorded balance is only a bounded projection of non-rejected
movement evidence; it is never a claim that physical stock exists.

The server derives actor, tenant, role, session, and CSRF evidence. PostgreSQL
reloads active membership/account/workforce, subscription/onboarding, current
appointment, assignment, dispatch, execution, performer, crew, and fail-closed
production transcript authority before any new effect or cached replay. A
single ordered supporting-authority lock is acquired before the material
transaction snapshot; every insert/update/delete/truncate writer for those
authorities acquires the exclusive counterpart before its statement. Mutation,
replay, and read therefore reauthorize only after any earlier revocation has
committed, while a later revocation waits until the material operation ends.
Both database entry points verify that the shared session lock was acquired
before the snapshot and deny a direct caller that bypasses this ordering.
Reads use bounded repeatable-read snapshots and the same current scope. Runtime
SQL may execute only the material mutation/read entry points and has no direct
table or helper privilege.

Every required execution, assignment, and existing-movement revision/digest
pin rejects explicit `NULL` before replay or evidence access. Material
descriptions use the shared `m23-material-text-unicode-v1` code-point contract:
ordinary NFC international text is accepted within its character/byte bounds,
while defined controls, invisible formatting, bidi overrides, interlinear
annotation, object replacement, and tag characters fail closed in JavaScript
and PostgreSQL. Movement and balance truncation are reported independently;
balance reads expose a strict bounded offset/limit window with total, returned,
previous, and next evidence rather than silently presenting 200 groups as all
balances.

The writer candidate mounts only:

- `POST /api/v1/field-executions/:executionId/material-actions`; and
- `GET /api/v1/field-executions/:executionId/materials`.

It does not assert or infer stock existence, warehouse truth, unit conversion,
stock cost or value, procurement, purchasing, supplier facts, customer price,
quotes, invoices, payments, profitability, scheduling changes, customer
contact, provider state, or Polaris conclusions. It adds no equipment/assets,
files/photos/notes, checklists/inspections, progress/blockers/changes,
completion/reopening, UI, or later-part behavior. Part 4 changes no rendered
file; Part 9 retains the complete design-system and visual-acceptance gate.
This is writer evidence only until a fresh independent exact-head audit, normal
merge, sole automatic deployment, migration verification, and health evidence
are complete.

## Non-negotiable ownership boundaries

| Mission | Authority retained by that mission |
| --- | --- |
| Mission 20 | Business Profile, workforce structure, people, crews, skills, locations, asset identity/catalogue, and operating policies. |
| Mission 21 | Knowledge registry, deterministic generation, review/publication, provenance, retrieval, provider-neutral projection, and synchronization. |
| Mission 22 | Assignment, schedule, dispatch, availability/conflicts, route recommendations, Calendar, dispatcher experience, and read-only Today scope. |
| **Mission 23** | Actual field execution; labor/time; material and inventory usage; equipment/vehicle/machinery usage, readings, condition, downtime, and maintenance; checklists, inspections, photos, notes, progress, blockers, exceptions, completion, reopening, and execution change facts. |
| Mission 24 | Human-approved price, estimate, quote, commercial change amount, and customer-facing pricing authority. |
| Mission 25 | Tenant-private outcome learning and any properly governed aggregate learning. |
| Mission 26 | Predictive business intelligence and forward-looking analytics. |
| Mission 27 | Customer financial lifecycle, invoice, payment, collection, refund, and accounting handoff. |
| Mission 28 | Owner-controlled automation and any authority to apply an otherwise advisory recommendation. |
| Mission 29 | Enterprise governance, advanced custom roles, SSO, MFA policy, delegations, and organizational controls. |
| Mission 30 | Integrated operating-system composition across accepted authorities. |
| Mission 31 | Isolated simulation that cannot mutate paid production authority. |
| Mission 32 | Manual Scenario Calculator and conversion of its non-binding drafts through explicit reviewed actions. |

No Mission 23 row may become a second authority for a field that an earlier
mission already owns. Downstream consumers receive exact immutable references or
minimized projections, not ownership of Mission 23 records.

## Root canonical contract

### Tenant and work identity

- Every durable row is bound to one `organization_id`; all relationships use
  tenant-composite foreign keys. A UUID-shaped identifier is never authority.
- One canonical field-execution identity is anchored to one existing canonical
  appointment and retains its exact operation, graph, opportunity, and Mission
  22 assignment identities. It must not overload `canonical_operations`.
- At most one current execution authority exists for an appointment. Immutable
  revisions and events retain history; a second current row is forbidden.
- Demo execution uses a separately provisioned demo organization/session and
  distinct storage or deterministic disposable fixtures. A URL, header, body,
  browser flag, or copied demo ID cannot switch paid authority.
- Deletion of an upstream customer, opportunity, appointment, assignment,
  workforce profile, crew, asset, or knowledge version cannot cascade away
  accepted operational evidence. Retention and redaction are explicit,
  authorized, auditable operations, not ordinary deletes.

### Revision, digest, idempotency, and audit

- Every current aggregate has a gap-free monotonically increasing revision and
  a SHA-256 digest over one recursively canonical, NFC-normalized, bounded UTF-8
  document. The database independently binds/recomputes the semantic bytes.
- Every write requires the exact expected current revision and digest plus every
  relevant upstream source revision/digest. Missing pins return a precondition
  error; stale or divergent pins return conflict without partial evidence.
- An idempotency key is required for every mutation. Its tenant, action,
  identity, actor/session, expected pins, and canonical request digest are bound
  together. Exact replay returns the one committed response; concurrent replay
  performs one mutation; mismatched reuse fails closed.
- Current state, immutable event/revision evidence, individual attribution,
  idempotency response, and audit event commit atomically. Forced audit failure
  rolls back every byte.
- Audit evidence records organization, work identity, action, prior/new
  revision and digest, actor, performer when different, reason, database-owned
  decision time, request correlation, and applicable source pins. It never
  stores credentials or unrestricted file bytes.
- Accepted evidence is append-only. Corrections create a superseding event with
  reason and exact predecessor; they do not update history in place.

### Individual attribution and authorization

- The server derives organization, user, active membership, access role,
  workforce profile, crew membership, permissions, session, subscription,
  onboarding, current assignment, and current dispatch from mounted authority
  inside the transaction. Request claims cannot grant any of them.
- Shared crew, provider, kiosk, AI, or `system` identities never stand in for a
  human action. A genuine deterministic system transition must name its rule
  version and source event and may not fabricate human approval.
- `recordedBy` and `performedBy` are separate when one authorized person records
  evidence for another. Both identities are server-resolved, and the actor may
  never impersonate another worker or claim unverified labor.
- Owners and administrators may use tenant-wide operational controls only with
  the existing permission and subscription prerequisites. An assigned active
  worker may record only permitted evidence for work dispatched directly to the
  worker or to a crew in which the worker is currently active. A dispatcher does
  not thereby gain authority to fabricate another worker's execution evidence.
- Viewers are read-only. Removed/inactive members, expired/revoked sessions,
  archived assets, stale crew membership, read-only subscriptions, and changed
  assignment/dispatch scope are rechecked at commit and fail closed.
- Mission 23 adds no custom role system. Any later delegation beyond these
  defaults belongs to Mission 29 and must be explicit.

### Transaction and time rules

- Writes use serializable transactions, database-owned locks and time, fixed
  trusted search paths, schema-qualified relations, least-privilege runtime
  entry points, and immutable same-transaction evidence.
- Reads that return authority and content use one owned bounded repeatable-read
  snapshot. Pagination uses stable immutable ordering and dataset-bound cursors.
- UTC `TIMESTAMPTZ` is canonical. Observed local time retains the raw RFC 3339
  offset, tenant IANA zone, and device/server receipt distinction. DST gaps
  reject and fold occurrences remain distinguishable.
- Client clocks, offline queues, EXIF time, provider time, and browser time are
  evidence with provenance, never the database decision clock.
- No route acknowledges success before the authoritative transaction commits.
  A lost response is recovered only by exact idempotent replay.

## Operational state semantics

Target, schedule, dispatch, execution lifecycle, progress, blockers, quality,
and completion are separate axes.

- `not_started` — accepted execution identity exists, with no start event.
- `in_progress` — a currently authorized human started work from a currently
  dispatched Mission 22 assignment.
- `paused` — work intentionally stopped with an attributable reason; it is not a
  blocker by implication.
- `blocked` — a recorded unresolved blocker prevents or materially constrains
  work. Resolution is a later event and does not erase the blocker.
- `completion_pending` — an authorized worker proposed completion with the
  required evidence; this is not completion.
- `completed` — the configured human approval gate accepted an exact proposal
  and evidence set.
- `reopened` — a human explicitly reopened a completed execution with reason and
  a new revision while preserving the original completion.
- `cancelled` — execution was explicitly ended without completion, with reason;
  this does not rewrite Mission 22 scheduling history or create a refund.

State transitions are derived from immutable accepted events. Percent complete
is a bounded separately evidenced measure and never silently drives lifecycle.
A Mission 22 reassign/reschedule/dispatch revocation does not erase performed
work; it makes any new worker action unavailable or `needs_review` until current
scope is re-established.

## Evidence-domain boundaries

### Labor and time

- Labor intervals identify the exact execution, active performer, work type,
  start/end evidence, source, recorder, and correction chain.
- Open timers are unique per worker according to the accepted policy;
  overlapping, negative, zero, implausibly long, stale, or cross-work intervals
  fail closed or require an explicit review workflow.
- Break, travel, setup, production, cleanup, and other work categories remain
  distinct when enabled. Schedule time is never copied as actual labor.
- Accepted time is operational evidence only. Mission 23 does not calculate
  wages, overtime entitlement, payroll, worker classification, or legal
  timekeeping compliance.

### Materials and inventory usage

- Usage records retain item identity or bounded human description, quantity,
  unit, inventory location when known, lot/serial when applicable, usage kind
  (`consumed`, `returned`, `waste`, `transferred`, or authorized adjustment),
  actor/performer, execution, time, and correction chain.
- Units and conversions are versioned and explicit. Unknown conversions,
  quantities, stock, supplier, or location remain unknown.
- Inventory movement is an immutable tenant ledger. A computed balance is a
  projection; no browser balance or provider response is authority.
- Missing inventory authority may permit a usage fact marked `needs_review`, but
  NorthStar must not fabricate stock or silently produce a negative balance.
- Purchase orders, supplier payment, material cost, markup, price, invoice, and
  accounting treatment are outside this mission.

### Equipment, vehicle, and machinery operations

- Every operational event references the exact Mission 20 tenant asset version
  when a catalogue identity exists. Free-text equipment never creates an asset.
- A generic truck, trailer, machine, or equipment placeholder is not accepted
  knowledge or operational capability. The tenant asset identifies the specific
  make, model, year, series, and relevant engine, configuration, and attachment
  when applicable. Missing or ambiguous configuration remains unknown and
  `needs_review`; category, a similar model, and marketing shorthand cannot fill
  the gap.
- The exact configuration pins a cited, versioned Mission 21 universal-knowledge
  research record with provenance, confidence, and freshness evidence. That
  non-tenant-private research may be reused across tenants and is refreshed only
  when missing, stale, conflicting, superseded, or materially different from the
  tenant asset configuration. Part 5 does not itself authorize live web or
  provider research.
- The Mission 20 tenant-private asset instance pins the exact universal knowledge
  version. Serial/VIN, ownership, financing, condition, hours or mileage,
  location, attachments, maintenance, faults, downtime, and tenant-specific
  costs remain tenant-private and never enter universal knowledge or another
  tenant.
- Part 5 supplies two asset-onboarding entry paths: a professional Business
  Profile **Vehicles & Equipment** `Add equipment` workflow for minimal
  identifiers and use context, and a Polaris conversational request such as
  `add a Ford F-350 that I sometimes use for hauling or plowing`. Both call one
  server-authoritative reviewed draft/research pipeline; neither uses separate
  browser logic or browser state as authority.
- Polaris asks only the sequential clarifying questions needed to resolve exact
  year, series, make, model, engine, configuration, attachments, and access
  type. It proposes the categorized record, then requires explicit confirmation
  from an authorized tenant actor before durable Mission 20 tenant-inventory
  mutation. There is no silent AI write. The existing server OpenAI Responses
  integration, gated by `POLARIS_OPENAI_ENABLED` and the server-only
  `OPENAI_API_KEY`, is reused; no browser key or second credential is created.
  Model memory is never factual authority.
- The Business Profile Vehicles & Equipment surface must meet the current
  NorthStar design system on desktop, tablet, mobile, light, and dark themes.
  Categories such as Trucks, Trailers, Equipment, and configuration-derived
  categories render only when at least one saved tenant asset belongs to them.
  They provide accessible expand/collapse, counts, and search/filter where
  appropriate, with strong spacing, radii, typography, no edge-touching content
  or overflow, and truthful empty, loading, researching, `needs_review`,
  conflict, failure, and success states. Assets saved through either entry path
  appear in the same correct category. Part 9 still owns the full worker and
  owner operational-execution UI; this Part 5 surface is only existing Business
  Profile asset onboarding and catalogue presentation.
- Check-out/use/check-in, operator, hours, distance, meter readings, fuel or
  charge observations, condition, faults, downtime, and maintenance events are
  separate attributable facts with units and provenance linked to the exact
  tenant asset and its pinned universal-knowledge version.
- Meter readings are monotonic unless an explicit bounded correction or meter
  replacement/reset event explains the change.
- An assignment or use event does not prove qualification, safety, insurance,
  ownership, availability, geolocation, or legal compliance.
- Telematics, maps, fleet providers, live location, remote machine commands, and
  provider maintenance truth require separately authorized contracts and are
  unavailable by default.

### Checklists, inspections, photos, notes, and field evidence

- A checklist instance pins the exact published template/version when one
  exists; completion records each required item, actor, time, answer, exception,
  and supporting evidence. A changed template never rewrites a prior instance.
- Inspection and quality results distinguish observation, measurement, pass,
  fail, unavailable, and needs-review. NorthStar does not infer a professional
  certification or safety conclusion.
- Notes and captions are bounded inert text. Stored markup, URLs, prompt
  instructions, filenames, and Unicode controls never execute.
- Uploads require tenant-scoped opaque object identities, allowlisted media,
  extension/MIME/magic-byte agreement, bounded count and bytes, streaming limits,
  quarantine/malware disposition, digest, encryption, short-lived authorized
  retrieval, and orphan/retention cleanup. Active content is never served inline.
- EXIF/geolocation, faces, customer property, signatures, and other sensitive
  data require explicit privacy/consent/retention policy. No upload capability is
  accepted until durable storage and these controls are independently evidenced.

### Progress, blockers, exceptions, and change-order facts

- Progress records explicit completed/total quantities and units, milestone or
  checklist evidence, recorder/performer, and uncertainty. Free-text optimism is
  not a calculated percent.
- Blockers and exceptions have category, impact, severity, observed time,
  responsible follow-up, state, resolution evidence, and correction history.
  Severity does not make a legal or safety conclusion.
- A field change fact records the requested or observed scope difference,
  initiator/source, affected work, schedule/resource implications, evidence,
  and review state.
- A Mission 23 change fact is not an approved commercial change order, customer
  acceptance, revised price, invoice, purchase, or permission to continue. Those
  effects require the Mission 24 human price/quote workflow and later financial
  authority.

### Completion and reopening

- Completion is an explicit two-stage proposal and approval, never a side effect
  of a schedule, appointment status, progress percentage, AI recommendation, or
  provider callback.
- A proposal pins the exact current revision/digest, checklist/inspection gates,
  unresolved blockers/exceptions, labor/material/equipment evidence summaries,
  required files, proposer, reason, and expiry.
- Approval reloads every pin and current authorization. Missing required
  evidence, a hard gate, stale bytes, changed assignment, or expired proposal
  rejects with zero partial mutation.
- Reopening creates a new event/revision, preserves the original completion and
  its audit, states the reason and required next action, and never reuses a prior
  idempotency response.
- Customer acknowledgement or signature is distinct from operational completion
  and remains legally/privacy gated; its presence must not be invented.

## Operational experiences

- The worker experience extends the current scoped Today model: a worker sees
  only directly assigned or current-crew work, then one clear work detail with
  start/pause/block/evidence/completion actions authorized by current server
  state. It is mobile-first but remains complete on desktop.
- The owner/administrator experience shows tenant-wide work state, progress,
  capacity implications, blockers, exceptions, evidence readiness, and pending
  approvals. Dispatcher access remains limited to explicit coordination scope.
- Customer cards and existing Calendar/Command Center records deep-link to the
  same canonical execution identity; no surface maintains a private copy.
- Loading, empty, offline, restricted, read-only, stale, conflict, partial-file,
  retry, applied-but-refresh-failed, and success states are explicit. Offline
  device data is a local draft until a server acknowledgement returns the exact
  durable revision/digest.
- All mutations use descriptive confirmation where consequences are material,
  visible pending state, one result, focus restoration, non-color status, and no
  optimistic completion.
- Desktop, tablet, 390/320 CSS px mobile, 200/400 percent zoom/reflow, light/dark,
  reduced motion, keyboard, touch, screen-reader names/states, and horizontal
  overhang are required acceptance surfaces.

## Polaris operational intelligence

- Polaris may summarize accepted operational evidence, identify missing or
  conflicting inputs, explain risk, compare plan versus actual, and recommend a
  human next action.
- Every output pins the exact source revisions/digests, model/rule version,
  generated time, missing inputs, uncertainty, confidence basis, audience, and
  expiry. Unauthorized facts are filtered before retrieval or ranking.
- AI/provider output is advisory and non-authoritative. It cannot start, pause,
  complete, reopen, assign, dispatch, approve a change, create time/material/
  equipment evidence, contact a customer, order material, set a price, issue an
  invoice, or invoke a tool.
- A human may use an explicit reviewed workflow to act on a recommendation;
  Mission 28 owns any future automation. Provider activation, credentials,
  external research, live calls, and provider-readiness claims are not authorized
  by this mission.
- Polaris never declares code, permit, safety, employment, tax, insurance, legal,
  engineering, surveying, or other professional compliance. Missing specialist
  authority stays unavailable or needs review.

## Downstream handoff contract

- Mission 24 may consume exact operational facts as estimate/quote/change-price
  inputs, but only a current authorized human establishes a customer-facing
  amount. Mission 24 cannot rewrite the source facts.
- Mission 25 may learn from tenant-private outcomes and only from exact permitted
  source versions; correction/tombstone propagation and aggregation governance
  are mandatory.
- Mission 26 may project operational metrics and predictions with source,
  confidence, and uncertainty; predictions never become facts.
- Mission 27 may create invoices/payments from explicit accepted commercial and
  completion handoffs; operational completion never invoices automatically.
- Mission 28 may automate only separately enumerated owner-controlled actions
  with kill switches, limits, approvals, observability, and replay safety.
- Mission 29 may add enterprise delegations and governance without weakening
  individual attribution or tenant isolation.
- Mission 30 composes accepted authorities; it does not collapse them into one
  mutable record.
- Mission 31 simulations are isolated and cannot call paid mutation routes.
- Mission 32 calculations remain non-binding drafts and convert only through an
  explicit reviewed action.

## Serialized delivery

### Part 1 — Root contract and live-state reconciliation

Ratify this complete authority map, exact twelve-part sequence, current-state
ledger, threat model, evidence boundaries, and unavailable-evidence truth. Add a
focused ratification test. Do not add a Mission 23 migration or runtime.

### Part 2 — Canonical field-execution authority

Create the additive PostgreSQL execution identity, current state, immutable
revisions/events, tenant relationships, authorization entry points, exact source
pins, digests, idempotency, and audit foundation. Mount only the minimum bounded
server contract needed to exercise that authority. Do not add time, material,
equipment, files, completion, UI, or Polaris writes early.

### Part 3 — Labor and time evidence

Add individually attributable actual labor intervals, categories, timer rules,
review/correction history, UTC/tenant-zone evidence, overlap/concurrency gates,
and operational summaries. Do not claim payroll or employment-law compliance.

### Part 4 — Materials and inventory usage

Add versioned units, tenant inventory movement/usage/return/waste facts, bounded
balances, corrections, location/lot evidence, and needs-review handling without
inventing stock, cost, purchasing, or pricing.

### Part 5 — Equipment, vehicle, and machinery operations

Link the exact Mission 20 tenant asset version and its pinned Mission 21
universal-knowledge version to execution use, operator, check-out/in,
hours/distance/readings, condition, fault, downtime, maintenance, corrections,
and availability implications. Require specific make/model/year/series and the
relevant engine/configuration/attachment where applicable; generic placeholders,
category inference, similar-model substitution, and marketing shorthand are not
knowledge or capability. Reuse cited/versioned/provenance/confidence/freshness-
backed universal research across tenants and refresh it only when missing,
stale, conflicting, superseded, or materially configuration-different. Keep
serial/VIN, ownership, financing, condition, hours/mileage, location,
attachments, maintenance, faults, downtime, and tenant costs private to the
tenant asset. Unknown specifications/capabilities remain unknown or
`needs_review`. Do not authorize live research, providers, telematics,
geolocation, cost, qualification, or safety invention.

Expose the shared reviewed asset-draft pipeline through both Business Profile
Vehicles & Equipment `Add equipment` and Polaris conversation. Keep all draft,
research, categorization, authorization, and durable mutation logic on the
server; require explicit authorized confirmation and never permit silent AI or
browser-state writes. Reuse the existing server-only OpenAI Responses
integration and Mission 21 cited-source authority rather than model memory, a
browser key, or a second credential. The Business Profile catalogue follows the
NorthStar design system across responsive light/dark experiences, renders only
non-empty generated categories, and provides accessible disclosure, counts,
search/filter where appropriate, and truthful lifecycle states without
edge-touching content or overflow. Part 9 retains ownership of full operational
execution UI.

### Part 6 — Checklists, inspections, photos, notes, and field evidence

Add version-pinned checklist instances, inspection/quality observations, inert
notes, and a secure tenant-scoped file pipeline with explicit privacy,
quarantine, retention, accessibility, and unavailable-storage gates.

### Part 7 — Progress, blockers, exceptions, and change-order facts

Add quantity/milestone progress, blocker/exception lifecycle, resolution
evidence, field change facts, and owner/worker review without creating price,
customer acceptance, invoice, purchase, or authorization to continue.

### Part 8 — Completion and reopening authority

Add exact evidence-pinned proposal/approval, gate evaluation, expiry,
idempotency, concurrent winner, immutable completion, cancellation, reopening,
and correction history. Never infer completion from appointment or progress.

### Part 9 — Operational experiences

Mount the worker mobile execution flow and owner/administrator operational view
over Parts 2–8, integrate existing Today/Calendar/Command Center/customer
surfaces, and cover every truthful state without browser-side authority. Match
or exceed the current deployed NorthStar design system across typography,
spacing, radii, borders, cards/drawers, responsive widths, controls, dark/light
themes, mobile/desktop, accessibility, Chrome, WebKit, and visual inspection.

### Part 10 — Polaris operational intelligence

Add minimized, evidence-pinned summaries, missing-input/conflict detection,
plan-versus-actual explanations, and advisory recommendations. Keep all provider
output non-capability and human-reviewed.

### Part 11 — Downstream handoffs

Expose explicit immutable handoffs to Missions 24–32 with consent, audience,
source pins, idempotency, outbox/retry where needed, and no feedback mutation or
automatic financial/customer consequence.

### Part 12 — Mission-wide acceptance and release

Trace one exact job through dispatch, execution, labor, material, equipment,
field evidence, changes, completion, reopening, Polaris advice, and downstream
handoff across mounted PostgreSQL, HTTP, and browser authority. Complete the
fresh exact-head independent audit, normal merge, sole automatic deployment,
exact revision/migration verification, health, passive acceptance, and final
evidence seal.

## Security, reliability, and acceptance gates

### PostgreSQL and migration

- Every new migration is additive; migrations 001–037 remain byte-for-byte
  protected. Fresh install and every supported upgrade run on PostgreSQL 18.x,
  UTF-8, UTC, deterministic locale, checksums on, and separate owner/runtime
  roles.
- Every Part 2–12 candidate release records whether its exact diff adds a
  migration. A
  new migration is frozen by exact repository path, Git blob object ID, byte
  count, and SHA-256 over the bytes returned by `git cat-file blob`; writer,
  auditor, merge, and deployed-revision evidence must match that identity. A
  checkout-normalized or post-audit copy is not substitute evidence.
- Before any migration-dependent release, an authorized read-only production
  inspection records the authoritative migration history and reconciles its
  sequence and recorded checksums with the candidate. It also records the
  applicable PostgreSQL version, server encoding, `TimeZone = UTC`, locale, and
  timestamp/default-expression compatibility without exposing secrets or
  private production rows. Missing or conflicting evidence blocks the
  migration-dependent release; a disposable database cannot stand in for the
  authoritative production history.
- The same automatic migration runner and invocation used by the sole production
  deployment must discover the candidate, respect existing production history,
  apply it in deterministic order with the migration owner, and require no
  hidden manual DDL or configuration. A production-shaped rehearsal proves the
  new migration applies exactly once, creates one matching ledger entry, and
  leaves no partial state after a tested interruption/retry. A second runner
  invocation and an application restart must both be zero-op, with zero pending
  migrations at the candidate revision.
- Every migration-dependent release records recoverability evidence: a dated,
  relevant backup receipt plus a restore rehearsal into an isolated database,
  with integrity checks and stated recovery scope. If backup/restore evidence is
  unavailable, the unavailable-evidence ledger must bound why and what is
  unproved, and the release disposition must explicitly choose a forward fix or
  an application rollback, prove the chosen path's schema/data compatibility,
  identify responsible authority and release consequence, and state that no
  destructive down-migration is inferred. Without that disposition, ready,
  merge, and deployment are blocked. Proceeding despite unavailable recovery
  evidence requires separate founder authorization and remains an unavailable
  recovery claim rather than a pass.
- Runtime has no schema/DDL, ownership, role assumption, migration-ledger,
  trigger, truncate, or direct immutable-history authority. Entry routines use
  fixed search paths and revoke public execution.
- Direct SQL must fail for cross-tenant links, unapproved current-state writes,
  revision gaps, digest mismatch, missing audit, history update/delete/truncate,
  and forged actor/source/evidence.
- Concurrent start/pause/block/progress/timer/inventory/asset/completion/reopen
  writes prove deterministic locking, one winner where required, exact replay,
  no write skew, and no partial evidence after crash or audit failure.

### HTTP, browser, and demo isolation

- Mounted routes require current cookie session, CSRF on mutations, bounded
  canonical JSON, duplicate-key/ambiguous-envelope rejection, request and
  response limits, rate/concurrency limits, and server-owned authorization.
- Cross-tenant IDs, stale sessions, inactive workers, changed crews, revoked
  dispatch, read-only subscriptions, smuggled role/tenant/actor/source pins,
  forged provider data, and IDOR enumeration fail closed without oracle leaks.
- Stored text is inert in Chrome and actual Playwright WebKit. File names,
  metadata, URLs, SVG/HTML/polyglots, oversized/decompression payloads, and
  hostile Unicode receive adversarial coverage before files are enabled.
- Paid and demo sessions, databases/fixtures, caches, analytics, files, service
  workers, and browser storage remain isolated. Demo cannot call paid mutation
  authority and paid pages never infer demo state from URL or browser data.

### Privacy, legal, provider, and safety

- Data minimization, role-filtered reads, retention, redaction, export, deletion
  exceptions, access logs, sensitive-media treatment, and incident evidence are
  explicit and tested. Audit/legal holds never become silent indefinite storage.
- Employee monitoring, timekeeping, wage/overtime, worker classification,
  geolocation, photo/audio consent, biometric/facial data, customer signatures,
  safety checklists, professional inspection, permits, and record-retention law
  require founder policy and qualified legal/professional review where relevant.
  NorthStar records configured policy and evidence; it makes no legal conclusion.
- No live provider, credential, storage bucket, map, telematics feed, email/SMS,
  call, customer contact, material order, machine command, Stripe/Retell action,
  or production-data mutation is authorized by this contract.

### Accessibility and visual acceptance

- Semantic headings/landmarks, labels/instructions, programmatic names and
  states, error association, keyboard order, visible focus, modal containment,
  Escape/restoration, announcements, touch targets, non-color status, contrast,
  reduced motion, zoom/reflow, and mobile safe-area/overhang are release gates.
- Installed Chrome and actual Playwright WebKit are browser evidence; WebKit is
  not physical Safari. Physical devices and assistive-technology sessions remain
  separate evidence.
- The founder delegated routine visual decisions for this overnight sequence.
  Any resulting receipt is labelled **agent visual acceptance**, never founder
  personal review. Parts 1–3 change no rendered UI, so their visual verdict is
  not applicable; this no-surface evidence is not substituted for Part 9's
  required browser and visual acceptance.

### Release

- Every part uses exactly one isolated full-history writer, one narrow branch,
  one draft PR, ordinary additive commits, and then a different fresh read-only
  exact-head auditor. No writer self-approval substitutes for audit.
- All P0–P3 findings are corrected on the same branch and re-reviewed. Only a
  zero-finding exact-head verdict permits ready/normal merge.
- Observe only the sole automatic deployment. Record exact base/head/merge/
  deployed revisions; exact migration Git-blob/SHA-256 identity; authoritative
  production history and UTC/time compatibility; automatic-runner, exact-once,
  rerun/restart zero-op, and recovery/disposition outcomes; credential-free
  health; authorized passive acceptance; final refs; evidence hashes; cleanup;
  and unavailable gates. Never manufacture a pass with a manual redeploy or
  hidden configuration.

## Part 1 requirement-to-evidence boundary

| Requirement | Part 1 evidence | Later required evidence |
| --- | --- | --- |
| Exact scope and sequence | This document plus `tests/ratification/m23-part1-operations-contract.test.js` | Each part updates status without reordering the sequence. |
| Live authority reconciliation | The table above and source-backed test checks for retained Mission 20–22/legacy boundaries | Mounted PostgreSQL/HTTP/browser behavior in Parts 2–12. |
| No premature runtime | Part 1 diff contains documentation, evidence artifacts, and one ratification test only | Part 2 independently introduces the first runtime authority. |
| Tenant/revision/digest/idempotency/attribution/audit rules | Root canonical contract and ratification assertions | Direct-SQL, concurrency, mounted route, restart, and audit-failure tests. |
| Operational domain semantics | State and evidence-domain sections | Parts 2–8 schemas/repositories/routes and adversarial tests. |
| Owner/worker experience and accessibility | Experience and acceptance contracts | Part 9 mounted Chrome/WebKit evidence and agent visual receipt. |
| Polaris and downstream limits | Parts 10–11 and explicit ownership table | Non-capability, minimization, human-approval, and handoff tests. |
| Security/privacy/legal/provider boundaries | Acceptance sections and unavailable ledger | Technical proof where authorized; external approvals remain separate. |
| Parts 2–12 migration release safety | PostgreSQL/release contract and ratification assertions require exact blob identity, production history and UTC/time compatibility, automatic/exact-once/zero-op proof, and recovery or an explicit release disposition | Each later part records whether it adds a migration and supplies the applicable exact-head, production, runner, restart, and recovery evidence before release. |
| Release truth | Serialized release contract | Exact-head audit, merge, automatic deployment, health, passive acceptance. |

## Part 1 acceptance contract

Part 1 is complete only when:

1. The complete Mission 21 and Mission 22 contracts and the current mounted
   schema/routes/legacy engine boundaries have been reconciled.
2. This document retains the exact twelve parts and mission ownership map.
3. The focused ratification test proves the current Part 1-only status, required
   invariants, preservation rules, downstream boundaries, migration-release
   evidence contract, and unavailable gates.
4. No accepted Mission 20–22 authority, migration, route, page, fixture, provider
   contract, or production configuration is changed.
5. The diff adds no Mission 23 runtime, migration, route, repository, UI, or
   statement that field execution is available.
6. Proportional tests pass at the exact writer head, `git diff --check` is clean,
   requirement-to-evidence and unavailable-evidence artifacts are retained, and
   the draft PR reports all limitations truthfully.
7. A different fresh independent auditor reviews the immutable head before any
   ready, merge, deployment, or Part 2 work.

## Explicitly unavailable or unclaimed at Part 1

- Any Mission 23 production runtime or production data.
- A Mission 23 database migration, fresh/upgrade database proof, or runtime-role
  proof; no such migration exists in Part 1.
- Provider credentials/configuration, live AI, storage, file scanning, maps,
  telematics, Retell, Stripe, email/SMS, calls, or customer contact.
- Legal advice or approval for labor/timekeeping, employee monitoring,
  geolocation, photos/recording, retention, signatures, safety, payroll, tax,
  permits, or professional practice.
- Hosted CI when no check exists, private production logs/data, physical Safari
  or devices, manual assistive-technology review, penetration testing, load/
  disaster-recovery evidence, and founder personal visual review.
- Approval, merge, deployment, health, or passive production acceptance for
  Parts 2–12.

Unavailable evidence is not a pass. It prevents only the corresponding claim;
it must never be replaced by a simulation, source-string assertion, provider
marketing statement, or writer assurance.
