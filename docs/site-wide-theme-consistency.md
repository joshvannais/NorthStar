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

## Validation boundary

The bounded evidence campaign executes the real mounted Express route graph and production HTML/JavaScript. It covers all 28 pages in dark and light modes in installed Chrome and actual Playwright WebKit at 1440×900 and 390×844, plus OS preference, live OS changes, explicit persistence, corrupt/unavailable storage, one-toggle/listener ownership, keyboard activation/focus, first-frame theme, responsive layout, recovery states, token non-retention, and loopback-only request containment.

The existing PostgreSQL-backed Account Lifecycle B1 browser campaign remains the authoritative behavioral proof for signup, verification, forgot/reset delivery, credential revocation, pending/trialing/expired/active presentation, and server-enforced trial gates. Local browser evidence does not claim physical Safari or production/provider readiness.

Final local evidence on 2026-08-03:

- Mounted theme inventory/static/authority: 3 suites, 70/70 tests.
- Complete page matrix: 28 pages × 2 themes at both viewports in each engine; 224 total mounted renders passed.
- Preference/recovery matrix: system default and live change, explicit override/persistence, corrupt and unavailable storage, keyboard focus/activation, one forgot request, and one reset request passed in each engine. Raw reset-token retention was false.
- Existing visual lifecycle campaign: four journeys passed (installed Chrome and actual Playwright WebKit at both viewports).
- Existing PostgreSQL-backed lifecycle campaign: four journeys passed against fresh migrations 001–012, including pending, verification, exact trial start/expiry, active-banner removal, forgot/reset, request, storage, and mutation assertions.
- Focused JavaScript syntax: 8/8 changed files passed `node --check`.
- Complete serial Jest on the repository-required disposable PostgreSQL 18.4 authority: 61 suites, 1,240/1,240 tests, zero required skips.

The first serial invocation used PostgreSQL 17 and omitted the two required migration negative-control databases; it was rejected as an environmental invocation mismatch (53/61 suites and 1,203/1,240 tests passed). No product change was made in response. One corrected run used PostgreSQL 18.4 plus the required fresh/upgrade controls and passed completely. Earlier focused browser corrections retained during development included a stale WebKit runtime, first-frame synchronization, loopback fixture identity, recovery-message, focus-visible, and WebKit body/canvas compatibility adjustments. No complete passing campaign was repeated after the final correction.

A separate complete API campaign was not duplicated because no server/API source changed and the complete serial run includes those suites. `--detectOpenHandles` was not applicable because this correction adds no Node timer, worker, server, or persistent handle. All browser and PostgreSQL evidence was disposable and loopback-only; no production system or provider was contacted.
