# Mission 24 — Part 2 Slice 3 Calendar Readiness Follow-up

This corrective package follows released PR191 (`7a65da989d4f2087acab64097a7bd6c22b7f11a6`). It does not add a material-intelligence slice or complete Part 2.

## Cause and contract

The ordinary demo Calendar was rejected because `src/routes/demo.js` converted the first estimate's string calculation-profile version to a number. For the canonically calculated seeded example this becomes NaN, serialized as null. `public/js/canonical-intelligence.js` correctly rejects a non-positive/non-integer Calendar profile revision. The renderer then mislabeled the rejected state as Loading. Both actual browser engines reproduced this at the released source.

`demoCalendarTimeZoneAuthority` in `src/commandCenter/workspace.js` now projects the current synthetic workspace configuration independently of historical estimates and result filtering. Its tenant-namespaced profile ID, persisted workspace revision, hash of the actual configuration profile, and saved time zone form a synthetic read-snapshot reference. This is not a new database profile or a numeric reinterpretation of the estimate's historical version. Workspace revision starts at 1 in `src/commandCenter/demoRepository.js:recordFromRow`; subsequent demo mutations advance it. No graph, estimate/profile pin, decision, material plan, adoption, price, or schedule is rewritten. Filtered empty Calendar results retain valid current time-zone context. Paid profile authority validation is unchanged.

## Rendered behavior and coverage

The shared Calendar distinguishes pending from rejected loads. Failed reads clear unavailable counts and show a plain-language Try Again button. Keyboard retry returns focus to Today after success or the new retry button after failure. Empty Agenda no longer refers to a nonexistent New Event action. An absent end time stays unrecorded; display formatting uses the actual saved time zone, without inventing a duration.

Previously unreachable demo event buttons invoked paid edit authority and threw. Existing event data now opens a compact read-only details dialog when current editing authority is unavailable, with Escape/Tab and return focus. Edit/resize/drag controls still depend on the current scheduling operator and matching record; no permissions or server mutation contracts change.

`src/routes/demo.js` exposes lead simulation/reset and estimate decision/material operations, but no schedule/reschedule mutation. `src/commandCenter/demoRepository.js` has no schedule-edit operation. Therefore this package restores readable demo schedule interaction, **not complete paid/demo schedule-edit parity**. The standing shared-functional-demo requirement remains open for a bounded scheduling-engine adoption follow-up; do not treat a read-only explanation as completion or assign it away solely to Mission 31. Existing paid scheduling proposal controls remain available.

Focused acceptance: `tests/unit/m24-calendar-readiness.test.js` binds configuration/revision/hash, empty results, legacy history and invalid revisions. `tests/browser/m24-calendar-readiness.js` mounts the actual app with disposable PostgreSQL and exercises ordinary navigation, Month/Week/Day/Agenda/Today, event details, keyboard focus, held-loading, service failure, denied response, missing time-zone reference, failed/successful retry, server-filtered empty results, original estimate metric, saved demo graph/revision invariance, and paid read/proposal/cancel. Four desktop/mobile light/dark contexts per Chrome and WebKit. Error/missing/empty cases are explicitly controlled response fixtures, not provider failures or production evidence.

Wording gate covers Calendar KPI, Agenda, Today list, retry, event labels/details, and affected time labels/accessibility. Existing cards/transcripts/material adoption renderers are unchanged. Source-only comparison, not a rerun, establishes that boundary. No raw backend errors are inserted in user copy.

## Operations and remaining evidence

No schema, migration SQL, startup guard, provider, configuration, backup or recovery-policy change. Rollback is the application patch only; no history is dropped. The existing physical-restore and automatic-backup/post-cutoff evidence limitations remain unchanged and are not waived. No production operation or prior consumed release check is repeated. Broader historical test failures and unavailable physical Safari/device/provider evidence remain inherited, not passing. Playwright WebKit is not physical Safari. Fresh independent review is required before root-owned release; founder visual acceptance is separate.
