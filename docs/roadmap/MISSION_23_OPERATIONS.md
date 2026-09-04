# Mission 23 — Operations

Mission 23 establishes the tenant-scoped operating authority for what actually
happens while scheduled work is performed. It connects the accepted customer,
opportunity, appointment, assignment, workforce, asset, Business Profile, and
knowledge authorities without replacing any of them.

## Ratified status

- **Part 1: root-ratified contract and live-state reconciliation only.**
- **Parts 2–12: not implemented.**
- Part 1 adds no database migration, production route, runtime repository,
  browser control, provider transport, credential, production configuration, or
  claim that field execution is already available.
- Part 1 records the implementation and evidence boundaries that every later
  part must satisfy. Each later part must update this status only after its own
  exact-head audit and terminal release.

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
- Check-out/use/check-in, operator, hours, distance, meter readings, fuel or
  charge observations, condition, faults, downtime, and maintenance events are
  separate attributable facts with units and provenance.
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

Link Mission 20 asset identities to execution use, operator, check-out/in,
hours/distance/readings, condition, fault, downtime, maintenance, corrections,
and availability implications without provider, telematics, geolocation, cost,
qualification, or safety invention.

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
surfaces, and cover every truthful state without browser-side authority.

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
  personal review. Part 1 changes no rendered UI, so its visual verdict is not
  applicable.

### Release

- Every part uses exactly one isolated full-history writer, one narrow branch,
  one draft PR, ordinary additive commits, and then a different fresh read-only
  exact-head auditor. No writer self-approval substitutes for audit.
- All P0–P3 findings are corrected on the same branch and re-reviewed. Only a
  zero-finding exact-head verdict permits ready/normal merge.
- Observe only the sole automatic deployment. Record exact base/head/merge/
  deployed revisions, migration outcome, credential-free health, authorized
  passive acceptance, final refs, evidence hashes, cleanup, and unavailable
  gates. Never manufacture a pass with a manual redeploy or hidden configuration.

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
| Release truth | Serialized release contract | Exact-head audit, merge, automatic deployment, health, passive acceptance. |

## Part 1 acceptance contract

Part 1 is complete only when:

1. The complete Mission 21 and Mission 22 contracts and the current mounted
   schema/routes/legacy engine boundaries have been reconciled.
2. This document retains the exact twelve parts and mission ownership map.
3. The focused ratification test proves the current Part 1-only status, required
   invariants, preservation rules, downstream boundaries, and unavailable gates.
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
