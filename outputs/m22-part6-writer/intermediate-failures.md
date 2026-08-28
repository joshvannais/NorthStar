# Mission 22 Part 6 preserved intermediate failures

1. Front-loaded unit/static tests were initially `6/6` red because the Today
   route, repository, page, script, CSS, and paid navigation destination did not
   exist. They became green only after the mounted read authority and UI were
   implemented.
2. The first mounted browser fixture generated schedule strings ending in `Z`,
   bypassing the exact tenant-wall-time form required by the human approval
   route. The fixture now resolves tenant wall time through the accepted
   scheduling time authority and supplies explicit-offset RFC 3339 instants.
3. The first PostgreSQL day-bound query converted `date AT TIME ZONE zone`,
   which PostgreSQL interpreted through the session zone and produced the wrong
   tenant midnight. Explicit `date::timestamp AT TIME ZONE zone` conversion and
   mounted 23/25-hour DST assertions closed the failure.
4. Early browser runs found the shared Command Center narrow CSS hid the reload
   control. The real read-only reload control now lives in the Today page-title
   actions, remains at least 44×44 CSS pixels, and passes touch/keyboard/reflow.
5. Early restricted-state rendering retained prior ready cards in the DOM.
   Every non-ready state now clears prior records before showing restricted,
   stale, loading, empty, offline, or error presentation.
6. The first network assertion classified the existing same-origin telemetry
   POST as a worker mutation. The corrected assertion separately permits only
   the existing telemetry endpoint and still proves zero Today/worker mutation
   requests and zero external/provider requests.
7. Manual source-to-sink review found that treating an accepted Part 3
   recommendation digest as pinned route evidence would be false: Part 3 marks
   route evidence unavailable absent separately authorized durable evidence.
   Today now renders only provider-neutral unavailable/needs-review uncertainty,
   null evidence/distance/duration, and zero provider calls.
8. The first available full Jest run was `152/153` suites and
   `2,127/2,128` tests green in `592.718s`. The single red was the exact mounted
   theme inventory missing the deliberate new `/dashboard/today` route/file.
   Adding only that page to the existing inventory closed its focused rerun.
9. The first expanded offline screenshot flow tried to click the state-panel
   reload after restoring network. The real page's existing `online` listener
   had already begun its automatic reload, so the hidden control correctly was
   no longer clickable. The harness now waits for that real automatic recovery
   before continuing; it does not weaken the page or fabricate state.
10. After the exact page/file inventory was corrected, the next available full
    run was `152/153` suites and `2,129/2,130` tests green in `593.682s`.
    The sole red was the paired final-reachability assertion retaining the
    historical count of 37 canonical pages. Its title/count now state 38 and no
    reachability, redirect, or retired-asset rule was weakened.
11. The first complete run of the subsequently hardened exact source was
    `152/153` suites and `2,129/2,130` tests green in `583.625s`. The sole red
    was the historical public-script provenance ledger correctly detecting the
    new mounted `public/js/today-page.js`. Only that exact new customer script
    was added to the authorized tracked-script list; no missing, retired, or
    unrelated script was allowed.

These are preserved as intermediate evidence and are not reclassified as
passes. Terminal results are recorded separately.
