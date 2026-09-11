# Mission 24 Part 2 Slice 3 — demo assignment parity

This package adds target discovery and assign/reassign/unassign to the existing shared scheduling dialog. It is a Slice 3 follow-up within the designated seven-slice Part 2 plan, not completion of Part 2 or dispatch/create parity.

## Evidence and authority

`src/commandCenter/demoWorkforce.js` creates one finite simulated workforce snapshot for new/reset demo sessions. Stable seeded names/IDs, explicit crew membership, service-key skills and seven local days of availability feed both Team and the real scheduling conflict/recommendation evaluators. A technician has an explicitly unavailable example interval. The coverage never moves on reload. Job location, operating policy, travel and other missing evidence remain review items. Synthetic skills do not assert real certification or availability.

Existing sessions without this snapshot keep their time-only workflow and saved history. They are not reset or retrofitted. The shared dialog and Team explain missing evidence and the consequence of the existing deliberate Reset action. No paid workforce/account identity is created or impersonated.

Assignment transitions mirror the existing paid operation family: assign from unassigned, reassign to a different target, unassign to null. They preserve exact time/status; unscheduled work retains null times. Schedule/reschedule preserve the current target. Dispatch/create remain refused. Shared preview/approval normalization, actual conflict and recommendation engines, current state/expiry checks, warning acknowledgment and exact-key replay remain in use. Hard conflicts cannot be confirmed. A read-only demo directory adapter uses the shared query/cursor contract and UI; it never calls private paid APIs.

## Read-consumer map

| Consumer | Current source |
|---|---|
| Calendar authority board and event scheduling dialog | Current overlay, current target directory and shared approval UI |
| Command Center scheduling board and upcoming work | Current overlay plus work.assignedTo projected from its saved target label |
| Canonical demo Calendar compatibility, surfaces and details | demoCanonicalItems overlays scheduleAuthority; integrity includes scheduling digests |
| Customer work context and shared Polaris surface scheduling summaries | Shared workspace work projection; original source graph remains immutable |
| Legacy demo-command-center detail/work renderers | Same projected workspace work.assignedTo/current schedule |
| Team members, crews and service skills | Same server-owned workforce projection used by discovery/evaluation |
| Historical seeded graph/scenario assigned-name hints | Immutable source data only; never treated as current approved assignment or availability |

Material plans, selected estimate revisions, price decisions, CAPELLA and transcripts retain their existing identities and calculation authority. No financial repricing occurs.

## Persistence and recovery

No schema change: migration 060 already admits schedule_preview/schedule_approve. All 58 SQL files remain unchanged, as do startup and paid permissions. New assignment receipts append to the existing bounded private session ledger. Earlier receipt bytes/digests remain readable; new validation handles assigned and unscheduled states. Session-row transaction/current revision, evidence digest, reset generation and 15-minute preview expiry bind consent. Current expiry is rechecked after waits and before replay/commit. New state is subject to the existing mutation limit and explicit snapshot/history size bounds.

The source-controlled demoSchedulingPolicy pause disables new time/assignment changes while reading saved targets, intervals and history. A candidate-derived paused build must actually be run against populated assigned history, then forward-resumed. PR195's old time-only reader is not a safe rollback after assignment writes. No new maintenance stop, backup, migration, provider setting or deployment action is implied. Physical restore and automatic/post-cutoff backup coverage remain unavailable.

## Verification and wording gates

Focused units cover transitions, exact source preservation, real member/crew overlap, wrong skills, explicit unavailability, stale coverage and scoped directory pagination. Mounted tests cover persistence/replay, current-state serialization, expiry after a row wait and read alignment. Populated process-level recovery verifies all 58 migration identities, legacy state, actual pause and forward resume. Chrome and WebKit exercise real search/selection/preview/keyboard consent/save/reload, desktop/mobile light/dark, Team service names and the affected paid dialog. Sealed handoff records exact tested sources and any retained failures; this document does not assert a run passed by itself.

Rendered wording covers the shared selector's search/loading/empty/error states, labels and accessible name, warnings/consent, the current Team notice and target summaries. No raw authority/digest/UUID or database language belongs in user-facing explanations. Consent reset and uncertain retry retain PR195 behavior. Founder visual approval remains separate from technical browser checks.

Next ordered scheduling family: dispatch/revocation with explicit consequences. New appointment creation/lifecycle parity requires a separately reconciled operation contract. Material Part 2 Slices 4–7 remain open.
