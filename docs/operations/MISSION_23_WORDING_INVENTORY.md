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

## Founder-required extension: structured Business Profile controls

The all-implementation wording gate explicitly extends this Part12 candidate to
four ordinary editors reachable from the Mission23 Business Profile host. This is
an added legacy-host correction, not a claim that original Part5 authorized their
original financial or pricing implementation. Part5's asset presentation authority
remains at the roadmap's equipment catalogue contract.

| Reachable editor | Existing shape and current surface | Required evidence |
| --- | --- | --- |
| Service Area boundary | Ordered latitude/longitude rows with add, remove, move up/down and clear. Saved pairs and coordinate objects keep their original representation. New coordinates are blank until entered; zero is never an inferred location. | Browser roundtrip, ordered editing, required coordinates and minimum point count; mounted profile save; desktop light/mobile dark. |
| Financial material costs | Service, Material, Internal cost rows. Exact key is service key plus colon plus material, as consumed by canonicalPolarisCalculation143-146. Existing composite service references are retained, not treated as equipment IDs. | Exact composite-key and zero roundtrip; mounted financial save and preserved sibling profile data. |
| Financial equipment costs | Equipment pricing reference and internal cost rows. A pricing reference is not assumed to be an individual equipment identity. Missing configuration, configured empty map and explicit zero remain distinct. | Reference/amount editing, absence/empty/zero, mounted save, unchanged equipment identity contracts. |
| Services pricing | Existing fixed charge, price per unit, price per unit by choice and price per listed item rules. Required details, allowed typed choices, range percentage and typed/nested exact-match conditions remain editable. Existing charge references and detail keys stay internal and roundtrip unchanged. | Existing server validation for all four rule types, new rule creation/type changes, exact roundtrip of codes/conditions, generic and financial version conflicts, member denial, invalid draft and keyboard checks. |

The new `profile-structured-fields.js` supplies typed form controls while hidden
carriers preserve the existing page's save, dirty, reload and version boundaries.
It does not create a backend schema, modify a calculator, connect a provider or add
a Mission24 commercial action. Existing unrecognized/malformed settings are shown
as unresolved, with their original data retained. They cannot be overwritten by a
save until explicitly corrected or replaced; replacement requires two visible
steps explaining that existing settings will be removed. Ordinary validation and
permission failures give actionable text rather than raw API error details.

`m23-part12-profile-fields.js` covers isolated rendered form/model parity and
`m23-part12-profile-fields-host.js` covers mounted PostgreSQL saves, sibling
preservation, competing versions and member permission denial. These are separate
evidence lanes. They do not prove physical devices, manual assistive technology,
provider actions, arbitrary production configuration or every role/theme/width
combination. Per-run source identity and actual screenshots remain mandatory.

### Founder visual correction and material compatibility follow-up

Today/Work shell wordmark color changes only within that work shell (also used by owner-operators); header backgrounds and owner navigation retain their colors. The traditional logo accompanies the wordmark. Completion review follows the owner Operations lockup, adds timestamp/decision spacing, and uses the established Polaris purple-to-slate gradient. Handoffs keep action consequences beside consent and move explanatory detail into native keyboard-accessible disclosure. Desktop/mobile and both themes require fresh rendered evidence.

Material controls must accept every supported nonblank saved reference, including an unspecified material (`service:`) and legacy references without a separator. Legacy rows remain editable without whole-map replacement; changing other costs must preserve them. Adding a row cannot overwrite an existing unspecified-material entry. Isolated editing, mounted roundtrip and unchanged backend calculation authority are required evidence.

Draft recovery: cancelling a new material cost clears only that draft and its errors, preserving unrelated invalid existing-row entries. Explicit whole-map removal clears the pending draft consistently and supports saving the removal.
