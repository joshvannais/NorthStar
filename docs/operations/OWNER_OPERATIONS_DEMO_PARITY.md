# Owner Operations Demo Parity

This unsplit delivery follows Mission 24 Part 2 and precedes Part 3. It does not add a material slice or complete every demo workflow. The sealed source contract at `m24-owner-operations-contract-a19083d` remains historical authority; the following source-driven adjustments were explicitly accepted by the root coordinator during implementation.

## Shared rules and separate authority

Additive migration 064 extracts deterministic lifecycle transitions, progress successor documents and completion gate reduction from immutable migrations 038, 048 and 049. `scripts/build-owner-operations-extraction.py` asserts each replaced paid block and reproduces the new migration. Paid wrappers retain their actor, tenant, source, locking, idempotency and persistence responsibilities. The demo calls the same deterministic SQL rules with its isolated, finite evidence set. No helper reads private paid records on behalf of a demo visitor.

The existing mutation column allows sixteen characters. The admitted operation is therefore `work_action`, replacing the proposed seventeen-character `operations_action`; neither the column nor the operation family is broadened. All 61 previously applied migration files remain immutable. Only migration 064 admits the new demo operation and replaces the exact shared-rule portions of existing routines.

The progress successor helper uses the new `canonical_operations_progress_successor_document` identity. Existing `canonical_progress_*` ACLs intentionally withhold internal helpers; those ACLs remain unchanged. The new callable helper accepts only deterministic document inputs and is not a private row/source loader.

## Source-grounded new-session scheduling basis

`src/commandCenter/workspace.js` already displays `Monday-Friday, 8:00 AM-5:00 PM` in its synthetic business profile. `demoOperationsBasis.js` introduces an optional, versioned `demo-owner-scheduling-basis-v1` only when creating a new or deliberately reset session. It records the same structured weekday hours and closed weekends. Its three original jobs have expressly simulated main-office responsibility; this is not geocoded or verified geographic coverage. Existing scheduling conflict evaluators consume this evidence, with no paid rule override.

Old sessions retain their original graphs, receipts and missing basis. New simulated leads do not silently acquire the original jobs' location applicability. Missing basis continues to produce scheduling review requirements; it is not converted to a clean authority result. The owner details disclose the simulated basis concisely. Reset remains deliberate and destructive to that demo's saved changes; no automatic retrofit or reset is performed.

## Paid owner detail read

The existing operational overview requires a `READ ONLY` transaction. Existing protected progress/completion reads acquire row `SHARE` locks. Combining them in a single transaction would change an existing contract. The approved adapter consequently performs read-only discovery first, then uses a new bounded `REPEATABLE READ` snapshot with the existing pre-snapshot material/work shared locks. Discovery supplies only an execution identity.

The protected read revalidates actor, session, tenant and source in that second snapshot. The adapter checks the returned execution's appointment and current assignment association before returning detail. No prior overview facts are treated as current. Selection without an existing execution remains in the read-only snapshot; later initialization retains its existing current-state validation. Missing or changed associations fail closed. All mutations retain their original source and revision pins.

## Recorded evidence and consent

New demo work has no labor, material-use or equipment records. This is a complete empty set for that isolated job, not a claim about physical work, inventory or safety. Present unresolved evidence and required missing files/checklists/inspections continue to block their actual completion gates. Files are not fabricated or marked scanned. Progress never implies completion.

The shared owner forms expose existing initialization, lifecycle, progress, issue/change, supporting evidence and completion review operations. Each save requires deliberate review. Known rejected requests refresh current state and clear consent; genuinely uncertain outcomes retain the same request key and body. A completion deadline entered with a local offset is stored as the same UTC instant, matching the paid projection convention. Original history is immutable.

The existing 24-mutation and 512-KiB PostgreSQL JSONB limits remain. A proposed work snapshot that exceeds the existing byte limit is rejected before update; saved history is retained. No record is truncated to fit.

## Recovery and evidence boundary

`demoOperationsPolicy.js` is the source-controlled demo mutation pause; saved work and completion history remain readable. Candidate-compatible combined decision/material/adoption pause and forward-resume builds must be executed with populated histories before acceptance. Prior-source rollback is not claimed compatible with new work history. Migration 064 uses the existing tighter-of-inherited startup lock and statement caps.

This document is not a release receipt. Current topology, backup cutoff, maintenance and forward recovery require a later concrete release disposition. No provider calls, employee login, customer notifications, physical restoration, production migration or deployment are authorized by this implementation. Browser-engine evidence is separate from physical devices, assistive technology and founder visual approval.

## Acceptance evidence map

- `tests/api/owner-operations-demo.test.js`: ordinary isolated scheduling/dispatch through completion, withdrawal, correction, reopening and resume; paid owner/member reads; changing authorization and proposal state between read phases; current pins, exact replay, row-wait expiry and atomic history/commit acknowledgment recovery. Old and extracted paid completion snapshots are compared as exact JSON text, including populated progress/evidence.
- `tests/integration/owner-operations-gates.test.js`: all eleven gate failures use their corresponding explicit missing/unresolved typed evidence. Incomplete evidence is rejected. The complete lifecycle state/action matrix separately checks supported and unsupported transitions. These are functional fixtures, not proof of physical field conditions or file scanning.
- `tests/unit/owner-operations-basis.test.js`: new synthetic hours/applicability, old-session absence, unknown hours and invalid changes.
- `tests/browser/owner-operations.js`: mounted shared paid/demo forms, desktop/mobile light/dark, note and measured progress with owner review, completion consent/cancel focus/reload, accessible error contrast and no private demo requests. Extended cases exercise actual reopening, resume and cancellation. Paid initialization is explicitly attributed to its existing fixture; demo initialization/start use the browser.
- `tests/api/owner-operations-startup-timeouts.js`: actual 064 table/advisory contention, tighter limits, statement timeout, rollback, apply-once and zero-op. Its estimate-preservation comparison may be empty; the separate populated recovery test supplies concrete paid operational-history evidence.
- `tests/api/owner-operations-upgrade-recovery.js`: released-base populated paid execution/progress/proposal/approval histories survive upgrade byte-for-byte; actual source-controlled individual and combined pause builds preserve new demo pending history, deny mutations, and forward-resume approval with current pins.

The sealed handoff records exact source identities, corrected test assertions, retained exploratory failures and separate build attribution. Tests do not establish provider readiness, external writer absence, production table sizes/locks, physical restoration, real employee accounts, all paid devices or the founder's visual verdict. The inherited wider-suite failures remain outside this bounded acceptance and are not relabelled as passing.

### Independent-review corrections

The Refresh Work Details control reloads the job list, retains a still-valid selection and never requests an empty appointment. The demo error envelope exposes only an allowlisted `limitKind` for429: session action limit, saved-work capacity, or temporary throttling. Permanent-limit copy retains saved history and explains that a deliberate reset clears that demo's changes; uncertain exact-key retry is unchanged. Demo completion review identifies simulated work throughout the page and confirmation dialog; paid copy is unchanged. `tests/browser/owner-operations-corrections.js` targets these states with controlled local errors and actual proposal history, while a focused route test checks category mapping. Earlier domain/migration/recovery evidence remains attributed to its tested source; these corrections do not change those rules or storage.
