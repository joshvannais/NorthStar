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

## Validation boundary

The bounded evidence campaign executes the real mounted Express route graph and production HTML/JavaScript. It covers all 28 pages in dark and light modes in installed Chrome and actual Playwright WebKit at 1440×900 and 390×844. It separately exercises OS preference, live OS changes, explicit persistence, corrupt/unavailable storage, one-toggle/listener ownership, first-frame theme, recovery and verification states, action-token non-retention, and loopback-only request containment. Actual Playwright WebKit is not physical Safari.

Final additive-remediation evidence on 2026-08-03:

- Mounted theme inventory/static/authority: 3 suites, 71/71 tests. The added nested-router negative control failed inventory equality as intended; the exact production inventory remained 28 rendered routes plus two redirect-only aliases.
- Complete mounted matrix: 224/224 renders passed (28 routes × 2 themes × 2 viewports × 2 engines). Chrome audited 2,444 text/control-value instances and 334 interaction-state groups at 1440×900, plus 2,112 text/control-value instances and 286 groups at 390×844. Actual Playwright WebKit produced the same counts. Aggregate: 9,112 text/control-value instances and 1,240 interaction-state groups.
- Contrast and geometry: zero final contrast, component-boundary, hover, focus, clipping, horizontal-overflow, hidden-action, or theme-control-intersection failures. Both engines' inherited-background, component-boundary, and overlap negative controls detected their deliberately injected defects.
- Preference behavior: installed Chrome and actual Playwright WebKit both passed OS default, live OS change, explicit persistence/override, corrupt storage, and unavailable-storage cases.
- Recovery/verification matrix: 8 engine/viewport/theme combinations passed, with 29 presentation states per combination (232 state checks). Each combination mounted 2 forgot-password, 5 reset-password, and 5 verification POST outcomes, covering validation, submitting/disabled, success, enumeration-safe response, invalid, expired, replay, malformed/missing token, network/provider-safe unavailable presentation, and safe failure. All 96 state-driving POSTs remained loopback-only; raw action-token retention and provider destinations were zero.
- PostgreSQL-backed Account Lifecycle B1 regression: four journeys passed in installed Chrome and actual Playwright WebKit at both viewports against one disposable loopback PostgreSQL 17.10 database freshly migrated through 001–012. Existing pending, verification, exact trial start/expiry, active-banner removal, forgot/reset, session revocation, request, storage, and mutation assertions remained intact.
- Required skips: zero. No HTML document or inline script changed in this remediation, so HTML/inline parsing was not applicable. JavaScript syntax, CSS/static references, protected-object identity, and Git integrity are recorded in the PR evidence ledger.

Intermediate failures were retained rather than relabeled as passing. The old reviewed head reproduced the legacy heading at approximately 1.077:1 and quick actions at approximately 1.467:1, plus the broad route and mobile-overlap failures. During implementation, the expanded WebKit audit then found native select focus, an opacity-fading Business Profile notice, and browser-default Connect buttons; focused corrections passed before the single final complete campaign. The first disposable PostgreSQL initialization failed before startup because the sandboxed Windows process could not create PostgreSQL's restricted token; the same task-owned cluster was initialized once outside that sandbox, completed the lifecycle campaign, and was stopped and removed with zero remaining listeners.

A complete serial Jest run was not repeated because the final delta changes presentation CSS and its browser/ratification harness only; no production JavaScript, server/API source, migration, manifest, lockfile, dependency, data, or fixture changed. `--detectOpenHandles` was not applicable because no production timer, listener, worker, or persistent handle was added. All browser and PostgreSQL evidence was disposable and loopback-only; no production system or provider was contacted.
