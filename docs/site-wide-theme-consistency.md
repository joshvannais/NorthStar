# NorthStar site-wide theme consistency

## Authority and scope

This correction makes `public/js/theme.js` the sole presentation-theme authority for every customer-visible HTML document mounted by `src/server.js`. Theme state remains browser-only presentation metadata. It does not identify a user, organization, membership, role, session, subscription, or trial, and it grants no application authority.

The mounted inventory contains 28 HTML routes and two redirect-only aliases. `public/design-system.html` remains an unmounted internal reference and is deliberately excluded from customer-route coverage. An executable inventory test compares the real Express GET graph, the enumerated route-to-file map, and every tracked production HTML document so a newly mounted or tracked customer page cannot silently bypass theme integration.

## Before-state inventory at `3d75cdd9140ef389af36c2ec171560430ee0936e`

| Mounted route | Before this correction |
| --- | --- |
| `/` | Shared controller plus duplicated inline storage bootstrap and page toggle; external font dependency |
| `/login` | Shared controller plus duplicated inline bootstrap and page toggle |
| `/signup` | Shared controller plus duplicated inline bootstrap and page toggle |
| `/verify-email` | Styled dark-only surface without shared theme authority or control |
| `/forgot-password` | Raw/partial account form without shared theme authority or control |
| `/reset-password` | Raw/partial account form without shared theme authority or control |
| `/account/pending` | Partial card with no shared theme authority or control |
| `/dashboard` | Fixed root theme, shared controller, duplicated inline storage/control logic |
| `/dashboard/executive-brief` | Fixed root theme with controller; external font dependency |
| `/dashboard/legacy` | Fixed root theme, controller, duplicated control/bootstrap; external font dependency |
| `/dashboard/leads` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/communications` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/calendar` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/ai-settings` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/business-profile` | Fixed root theme without shared theme authority or control |
| `/dashboard/my-number` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/settings` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/integrations` | Shared controller plus duplicated inline bootstrap; external font dependency |
| `/dashboard/lead` | Fixed root theme with controller; external font dependency |
| `/dashboard/polaris` | Fixed root theme without shared theme authority; external font dependency |
| `/contact` | Shared controller plus duplicated inline bootstrap and page toggle; external font dependency |
| `/privacy` | Shared controller plus duplicated inline bootstrap and page toggle; external font dependency |
| `/terms` | Shared controller plus duplicated inline bootstrap and page toggle; external font dependency |
| `/refund` | Shared controller plus duplicated inline bootstrap and page toggle; external font dependency |
| `/legal` | Shared controller plus duplicated inline bootstrap and page toggle; external font dependency |
| `/admin` | Partial unavailable card without shared theme authority or control |
| `/preview-dark` | Fixed dark presentation without shared theme authority; external font dependency |
| `/preview-light` | Fixed light presentation without shared theme authority; external font dependency |

Redirect-only `/dashboard/calls` and `/demo-login` retain their existing immediate destinations and do not render a transitional document.

## Shared theme design

Every mounted document now loads the same synchronous controller before the shared stylesheet. The controller applies `data-theme` and `color-scheme` before CSS can render, then creates exactly one fixed, keyboard-operable theme control after the body exists. Dashboard navigation no longer owns a competing theme control, and page-specific storage bootstraps were removed.

Selection precedence is:

1. An exact saved value of `light` or `dark` under `northstar-theme`.
2. The current `prefers-color-scheme` value when no valid explicit choice exists.
3. A deterministic light fallback if media-query access is unavailable.

Corrupt values are ignored. Storage reads and writes are exception-bounded. A system-theme change updates open pages only while no explicit choice exists; an explicit selection remains stable across later system changes, navigation, and reload. Cross-tab storage changes are accepted only for the two valid presentation values. The controller stores no credential or account authority.

Shared CSS tokens now cover page background, surfaces, muted and primary text, borders, headers, inputs, status text, links, controls, shadows, focus rings, and responsive shells in both modes. Customer pages no longer fetch third-party fonts or other theme resources.

## Account recovery surfaces

`/forgot-password` and `/reset-password` use the same branded responsive recovery shell. Their mounted API routes, HTTP methods, request bodies, password rules, enumeration-safe response, reset-token capture and URL cleanup, `no-referrer` policy, token consumption, session revocation, and redirect authority are unchanged.

The forgot-password UI now represents submitting, disabled, enumeration-safe success, and bounded failure states without revealing account eligibility. The reset UI retains valid-token entry, malformed/expired failure, submitting, success, and safe failure behavior. This change deliberately adds no confirm-password field or password-visibility control.

## Security and behavior preservation

- Theme preference never influences authentication, membership, onboarding, trial, subscription, billing, tenant, or provider decisions.
- Verification/reset action tokens retain their existing earliest capture, visible-URL removal, no-referrer, single-use, and no-storage boundaries.
- Signup, login, logout, refresh, resend, verification, password recovery, trial, and subscription APIs are unchanged.
- Trial banners and server-side access gates are unchanged.
- `/admin` remains a static fail-closed unavailable surface; no admin data or authorization was added.
- No migration, dependency, provider, billing, Stripe, Railway, or production configuration is part of this correction.

## Independent-audit correction

The independent review of head `ea54f2228351b861b0649b6549b3f5c89c1dc69c` found material presentation gaps that the first evidence campaign did not detect. Dark `/dashboard/legacy` used near-black foregrounds against its dark canvas, ordinary text or controls failed contrast on 22 of 28 mounted routes, and the fixed mobile theme control intersected visible controls on `/`, `/contact`, and `/dashboard/polaris`. The original inventory walker also stopped at the top Express router instead of traversing nested routers.

This additive correction:

- maps legacy dashboard headings, copy, counts, summary text, quick actions, and interactive states to the shared dark-theme tokens;
- corrects ordinary text, links, placeholders, controls, disabled states, transient notices, hover states, and focus indicators while retaining NorthStar navy and gold surfaces;
- reserves one shared responsive control rail for the 44×44 theme toggle so it intersects no visible input or action at 390×844;
- recursively traverses mounted Express router stacks and rejects an unrecognized mount pattern instead of silently omitting it;
- adds an in-memory nested child-router negative control whose hidden mounted HTML route must break the exact 28-route allowlist; and
- measures element-level effective-background contrast, field/control boundaries, hover/focus states, clipping, and theme-control intersections in both browser engines.

The accessibility audit applies 4.5:1 to ordinary text, 3:1 to large text, and 3:1 to meaningful component boundaries and graphical controls. Its only explicit exclusions are hidden content, the unfocused skip link, and standalone decorative glyph/logo content that has no actionable or textual meaning. Transparent ancestor colors are composited against the first effective opaque background rather than assumed to sit directly on the body.

## Targeted interaction and evidence correction

The targeted review of head `7b28d2721be436e31a2fdf05b228e3e94b79256f` found that the interaction audit still collapsed controls by tag/type/role/class/disabled signature, sampled hover after only 10 ms, and checked only the 44 px toggle rectangle instead of the reserved 64 px mobile control rail. That blind spot allowed the mounted `/dashboard` light quick-action hover to settle at 2.453:1. It also found the Executive Brief desktop Sign Out focus outline extending below the 900 px viewport.

Commit `95ef8fad727d25714b0185fd62664a73dec9ced8` closes those findings without changing destinations or application authority:

- every visible control context is exercised; signatures retain effective ancestor/background context for diagnostics instead of selecting one class-level representative;
- finite hover and focus transitions are paused and sampled deterministically at 0%, 25%, 50%, 75%, and 100%, while controls without a finite transition are checked at their settled state;
- mobile geometry checks the complete reserved 64 px rail, excluding only the theme control that owns it;
- all six quick actions on the mounted `/dashboard` and `/dashboard/legacy` command-center surfaces keep an accessible light foreground for the complete hover transition, and the same timing audit corrected their Refresh controls plus the communications Clear All and dark pricing-card hover states it exposed;
- the Executive Brief footer has explicit desktop focus clearance and an explicit keyboard stop so natural traversal and direct focus can be verified in both browser engines; and
- negative controls prove the old grouping, 10 ms timing, and 44 px-only geometry behaviors miss their injected defects while the corrected harness detects each one.

The inherited base-era focusability of links inside the closed off-canvas mobile navigation is outside this targeted correction. The final evidence therefore makes no universal claim that every hidden/off-canvas action is unfocusable; it covers visible mounted controls, visible action/input geometry, and the reserved theme-control rail.

## Asynchronous mounted-route readiness correction

The targeted re-review of head `4eec3770fed2ff81f613ae810ed4369ba58d8f0b` found that the mounted audit could run after `DOMContentLoaded` but before `/dashboard/communications` completed its asynchronous canonical read and rendered its KPI grid. A fresh pre-correction campaign therefore produced timing-sensitive totals: installed Chrome reported 2,436 desktop and 2,108 mobile instances, while actual Playwright WebKit reported 2,444 desktop and 2,112 mobile instances (9,100 aggregate). Those results did not support the prior 9,112-instance documentation claim and remain recorded as an intermediate failure.

The later targeted re-review of head `ca463cef62358c53b6b49950ce9f2d2edd238d40` found a narrower sequencing gap: the gate's wait completed after the first request, while the expected count of two was asserted only after release. Its exact negative control observed one request before release and the second request after release, yet the old final count still passed.

The corrected harness controls only the mounted communications reads at the loopback boundary. It requires the complete exact set—`GET /api/v1/canonical/compat/communications` and `GET /api/v1/canonical/compat/communications?limit=50`—to be pending before the initial audit. An incomplete set fails with a bounded identity-aware diagnostic, and release refuses to proceed. The pending DOM is audited while both responses remain held; only then are they released. The harness next waits for production-observable completion: canonical authority must be `server`, all eight KPI cards must exist, and the successful empty result must render `No communications yet`. No production render marker or application code was added. The settled accessibility audit runs before any hover/focus scan and is the only route audit included in the canonical complete-matrix totals.

Across all eight engine/viewport/theme combinations, the controlled pending audit counted 39 desktop or 28 mobile text/control-value instances; the completed render counted 50 desktop or 39 mobile instances. Each combination therefore proves that the pre-completion ordering omitted 11 settled instances. The two-read first-red reproduced `PRE_RELEASE_REQUEST_COUNT=1` and `POST_RELEASE_SECOND_REQUEST_COUNT=2`; the corrected contract rejected that sequence because the filtered request identity was missing at release. The corrected focused matrix passed in both engines, both themes, and both viewports.

## Validation boundary

The bounded evidence campaign executes the real mounted Express route graph and production HTML/JavaScript. It covers all 28 pages in dark and light modes in installed Chrome and actual Playwright WebKit at 1440×900 and 390×844. It exercises one-toggle/listener ownership, first-frame theme, recovery and verification states, action-token non-retention, and loopback-only request containment. Actual Playwright WebKit is not physical Safari.

Final additive-remediation evidence on 2026-08-04:

- Mounted theme inventory/static/authority: 3 suites, 71/71 tests. The nested-router negative control continued to fail inventory equality as intended; the exact production inventory remained 28 rendered routes plus two redirect-only aliases.
- Complete mounted matrix: 224/224 renders passed (28 routes × 2 themes × 2 viewports × 2 engines). Installed Chrome audited 2,448 settled text/control-value instances and 824 visible control contexts at 1440×900, plus 2,116 settled instances and 516 contexts at 390×844. Actual Playwright WebKit audited the same 2,448 settled instances and 824 contexts at 1440×900, plus 2,116 settled instances and 516 contexts at 390×844. Aggregate: 9,128 settled text/control-value instances, 2,680 visible control contexts, 9,784 hover frames, and 2,680 focus frames. The retained final output showed equal engine totals; no engine difference is inferred or forced.
- Communications readiness: 8/8 engine/viewport/theme combinations explicitly passed both audits. Before release, each held exactly the two expected loopback GET identities and no unrelated request; no late identity appeared after release. Each controlled pending state omitted 11 instances (39 to 50 desktop; 28 to 39 mobile), then reached `server` authority, eight KPI cards, and the successful settled empty-state before its settled count entered the totals.
- Two-read sequencing negative control: installed Chrome and actual Playwright WebKit each held only the unfiltered GET, rejected early release with the filtered identity still missing, then rejected and classified the filtered GET when it arrived after the test-only legacy release. Both controls were loopback-only, used GET/GET, and sent zero Authorization headers.
- Dashboard transition evidence: every one of the six quick actions was checked in both themes, engines, and viewports for 48 action-context transitions and 240 deterministic frames. The minimum ratios were 12.663:1 in dark mode and 7.169:1 in light mode, including settled hover.
- Contrast and visible geometry: zero final contrast, component-boundary, hover, focus, clipping, horizontal-overflow, theme-toggle intersection, or 64 px visible-control-rail failures. This is not a claim about the inherited closed off-canvas navigation focusability described above.
- Executive Brief focus: four desktop engine/theme combinations passed natural keyboard traversal and direct focus. The outside edge of the focus treatment remained at 899.719 px in installed Chrome and 900.016 px in actual Playwright WebKit within the bounded subpixel tolerance.
- Negative controls: on the old head, the same-signature fixture collapsed to one group with zero hover failures, the 10 ms transition fixture reported zero hover failures, and the object inside the 64 px rail but outside the 44 px toggle reported zero intersections. The corrected harness exercised all seven visible fixture contexts, retained the distinct effective-background failure, caught two bad transition frames, and reported the rail-only intersection in both engines.
- Preference behavior was not repeated in this targeted correction because `public/js/theme.js` and its storage/listener ownership are object-identical to the reviewed head. The prior executable preference evidence remains historical context, not a new run claim.
- Recovery/verification matrix: 8 engine/viewport/theme combinations passed, with 29 presentation states per combination (232 state checks). Each combination mounted 2 forgot-password, 5 reset-password, and 5 verification POST outcomes, covering validation, submitting/disabled, success, enumeration-safe response, invalid, expired, replay, malformed/missing token, network/provider-safe unavailable presentation, and safe failure. All 96 state-driving POSTs remained loopback-only; raw action-token retention and provider destinations were zero.
- PostgreSQL-backed Account Lifecycle B1 was not repeated because this targeted delta changes no production JavaScript, server source, account/session/trial authority, migration, or schema. The earlier four-journey result is not relabeled as current-run evidence.
- Required skips: zero. The current readiness-cycle JavaScript syntax check passed for its one changed browser harness, and the focused mounted inventory/static/authority suites remained 3/3 suites and 71/71 tests. The prior static campaign parsed all 28 mounted HTML documents and every inline script, including the four changed dashboard documents, and verified local CSS/static references. Protected-object identity and Git integrity are recorded in the PR evidence ledger.

Intermediate failures were retained rather than relabeled as passing. Historical failures from the first remediation remain recorded above. For the prior interaction correction, old-head controls reproduced the three harness blind spots; the first focused implementation run exposed the mounted command-center file distinction and then the Refresh transition; initial focus-clearance padding increased the measured outside edge to 911.719 px and was replaced with bounded visual clearance. The broad light run then exposed the legacy quick actions and communications Clear All hover, its correction rerun exposed legacy Refresh, and the first complete matrix exposed the dark pricing-card hover at 3.101:1. The first readiness correction retained the timing-sensitive 9,100 aggregate, and its first commit invocation failed because the disposable checkout had no author identity; a command-local identity produced the additive commit without changing repository configuration. The next publication claimed an unsupported 9,127 aggregate and a one-instance engine difference. This two-read cycle reproduced the remaining sequencing defect with one request before release and the second after release. After the exact-identity gate and late-request negative control passed, the single retained complete campaign produced 9,128 with equal engine totals. A later read-only Git status invocation omitted the required command-local safe-directory option and was rejected; the corrected status invocation supplied only that command-local option and made no configuration change.

A complete serial Jest run was not repeated because this two-read delta changes only the browser harness and evidence documentation; no production HTML/CSS/JavaScript, server/API source, migration, manifest, lockfile, dependency, data, or fixture changed. `--detectOpenHandles` was not applicable because no production timer, listener, worker, or persistent handle was added. All browser evidence was disposable and loopback-only; no production system, database, or provider was contacted.
