# Mission 23 implementation-to-wording inventory

This inventory applies the founder's mandatory wording gate retrospectively to
**every implementation in Parts 1–12**, and before every subsequent step. It is
not limited to the most recent diff or five acceptance suites. It maps authority
to the actual display sink; an early backend-only release is not exempt when a
later part renders its output. The canonical twelve-part sequence is unchanged.

## Implementation and display map

| Part and authority | Rendered sink and users | Required wording/state review and evidence lane |
| --- | --- | --- |
| 1 root contract and ratification | No executable product change at Part1; all following sinks implement its contract | Roadmap/docs are engineering artifacts, not product text. No Part1-only UI pass is inferred; Parts2–12 below cover subsequent consumers. |
| 2 execution identity/lifecycle; `src/operations`, mounted field-execution routes | Today job cards; worker Work detail/status/confirmation; owner/admin Operations and Completion review; dispatcher minimized overview; linked work on Calendar, Command Center, customer and communications drawers | Initialization, start/pause/resume, assignment/access changes, loading/empty/read-only/retry/offline/stale, saved but refresh failed, history. Worker suite, overview presentation + database modes, execution-link suite, same-job journey. |
| 3 labor/time; operations labor authority | Work detail Time card, timer/manual/correction forms and confirmation; overview summaries; completion evidence; Polaris source counts; handoff counts | Running/stopped timer, category, local date/time, reviewed/unreviewed records, empty/unavailable, invalid input, saved action, consent. Worker suite and journey; no payroll inference. |
| 4 material movements/units | Work detail Materials card/form/confirmation; overview summaries; completion evidence; Polaris and handoff counts | Movement kind, quantity/unit, location/material reference, correction/review, empty/unavailable/invalid input. Worker suite and journey. Business references remain meaningful; raw internal IDs are not labels. |
| 5 exact equipment catalogue/research and equipment operations | Business Profile Vehicles & Equipment cards/filter/disclosures/draft dialog; shared Polaris Add equipment dialog; Work detail Equipment card/form; overview, completion, advice and handoff projections | Empty/filter counts, denied/loading/error, clarification/unknown/research-needs-review, citations, review/confirm/cancel/saved/conflict, keyboard/dialog focus; checkout/use/check-in/readings/condition/fault/downtime/maintenance. Equipment suite + worker + journey. Live research/provider readiness remains unavailable. |
| 6 checklist/inspection/note/file authority | Work detail Evidence card and checklist/response/observation/note forms; file-unavailable explanation; completion evidence selection/history; owner overview, advice and handoffs | All form labels/help/options/confirmations; current/superseded records, pagination incomplete/unavailable/selection limit, empty/unavailable, note saved, file unavailable. Worker + functional-corrections + journey. No upload, quarantine, scan or download success claimed while storage is unavailable. |
| 7 progress/blocker/exception/change facts | Work detail Progress and issues card/forms; owner overview constraints; completion gate explanations; Polaris explanations and handoff counts | Progress, blocker, exception and change descriptions/review states; resolution facts and no authorization to proceed; empty/unavailable/input failure. Worker suite + journey. No pricing/customer acceptance implied. |
| 8 completion/reopening | Worker proposal/withdrawal card/forms; owner/admin Completion review decisions/history/dialog; minimized overview pending/readiness states; Polaris/handoff stale state | Proposal/evidence selection/expiry, approve/cancel/reopen/resume/correct, reason and confirmation, denied/read-only/incomplete history, stale/concurrent outcome, exact retry, saved-but-refresh-failed. Completion suite + worker corrections + journey + handoff suite. |
| 9 operational experiences, including all released slices and My Work Profile | Today; Work detail; Operations; Completion review; Calendar/Command Center/customer/communications execution disclosures; My Work Profile and Work Profile Reviews | Worker/current crew and owner/admin/dispatcher/member/viewer boundaries; loaded/empty/loading/denied/stale/error/offline; forms/dialogs/filter/paging/help/title/accessible names. Profile adds self claims, certifications, expiry, availability, submit/review/reject/revoke/history/conflict. All mapped browser lanes apply. Part9 historical PR180 acceptance is distinct from new wording checks. |
| 10 operational intelligence | Collapsible Polaris card in worker and owner completion views, summary/recommendation/source disclosures | Initial/loading/ready/empty or missing inputs/conflict/stale/expired/denied/error/offline; confidence and uncertainty; source labels/counts/dates with IDs/digests kept internal. Intelligence suite + journey. No provider output readiness claim. |
| 11 downstream reference handoffs | Owner/admin Completion review handoff form, destination help, consent, status, retained history and revoke confirmation | Current/changed/expired/unavailable/restricted; mission choice and per-destination consequence; consent reset, save/retry/history/revoke. Handoff suite + journey. Later delivery/consumption remains unavailable and is explained plainly; practice-only destination stays disabled. |
| 12 acceptance and wording reconciliation | No separate new product page; all preceding sinks above | One real synthetic job traverses the integrated workflow; mission-wide wording inventory adds state-focused presentation checks. Detailed diagnostics, hashes, route names and test evidence stay in engineering artifacts. |

## Evidence interpretation

The browser ledger and final sealed handoff identify exact commands, source head,
browser versions, cases and screenshot paths. Existing e4402ec results cover
Chrome/WebKit journey (17 cases each), profile, equipment, intelligence and
handoffs, plus 51 focused Jest tests. Those are **intermediate** evidence after
scope expansion, not a comprehensive final-head verdict.

The added observer checks visible page text and accessible `aria-label`, `title`
and `placeholder` text during DOM changes, including transient states and dialogs.
Explicit browser assertions still verify behavior and action consequences; a
keyword check alone cannot establish good business language. Agent screenshot
inspection and source review of state copy remain required. Hidden request pins,
HTML data attributes and internal logs are not rendered product copy.

State-focused intercepted response fixtures are presentation evidence, not proof
of database persistence or actual provider failure. The mounted PostgreSQL journey
and database overview remain separate durable evidence. Ordinary synthetic fixtures
are used for this wording lane; security-specific payload runs are not added.

Desktop/mobile and light/dark coverage is recorded by each suite's actual profile,
not inferred from another browser. Shared wording across widths/themes is reviewed
in source, while screenshots establish layout at the listed profiles. Final
acceptance must explicitly list any unvisited state or surface rather than marking
it passed because it shares a component. Physical Safari/devices, manual assistive
technology, founder personal visual approval, real storage/provider behavior and
private production remain unavailable. The inherited 15 wider-suite failures are
not replaced with an all-green corpus claim.
