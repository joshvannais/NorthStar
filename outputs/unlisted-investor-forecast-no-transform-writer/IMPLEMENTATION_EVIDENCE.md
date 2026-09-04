# Hosted Investor Forecast `no-transform` Correction — Writer Evidence

Date: 2026-09-04

## Release boundary

- Base commit: `552a3f1334fa4c13a5a2b2af2a658b6a61e89036`
- Base tree: `684fb6f46c45f23248c70a20e081ab674a9fae88`
- Writer branch: `website/investor-forecast-no-transform`
- Writer checkout: `/home/joshv/codex-writers/hosted-investor-no-transform`
- Scope: one origin response-header correction on the existing exact `/investor/forecast` route, focused regressions, and writer evidence.
- Excluded: Cloudflare/provider configuration, global cache/security policy, calculator HTML or engine changes, path/discovery changes, other pages, Mission 23, production mutation, merge, and deployment.

This is writer evidence for an implementation candidate. It is not independent audit, production acceptance, investor approval, or legal/accounting/tax/CPA approval.

## Production finding reproduced before editing

The deployed release was Railway deployment `14d6802b-e2d7-4c64-8179-7cd97e138ee3` from the base commit above.

The supplied production comparison established that `GET https://northstar-os.ai/investor/forecast` returned:

- `4,022,894` bytes
- SHA-256 `6e494e2624d3ad1c73bf11a21695b08e8ccb7c15463179aec42b4ea97ba4adb1`
- a 367-byte Cloudflare Web Analytics module script immediately before `</body>`
- common prefix of `4,022,512` bytes and common suffix of `15` bytes when compared with the hosted artifact

A separate credential-free writer preflight at `2026-09-04T16:23:02Z` reproduced the exact production byte count and SHA-256, found the `static.cloudflareinsights.com` script marker before `</body>`, and observed a response cache policy without `no-transform`. No production state or provider setting was changed.

The repository-hosted artifact remains:

- `public/unlisted/investor-forecast.html`
- `4,022,527` bytes
- SHA-256 `f162b53d0d9c2d2b52c4a18675870aec9ee203d5a245279b4cb2f4d936cc71ae`

The OneDrive canonical source remains unchanged at `4,022,457` bytes and SHA-256 `b395c52c594f89d2eea9e26fe848da4dd2a9e6e125f81b859d398c0eb3c96e3a`.

## Documentation basis

Cloudflare's official Web Analytics FAQ states that automatic setup injects a JavaScript snippet across pages, and that an origin `Cache-Control` response containing `no-transform` prevents Cloudflare from modifying the original payload and automatically injecting the beacon:

- <https://developers.cloudflare.com/web-analytics/faq/>

Cloudflare's origin cache-control documentation explains that origin `Cache-Control` directives instruct intermediaries, lists `no-store`, and describes origin-directive handling:

- <https://developers.cloudflare.com/cache/concepts/cache-control/>

The correction relies on the documented `no-transform` behavior and does not change Cloudflare account configuration.

## Surgical correction

Only `src/routes/investorForecast.js` changes at runtime:

- Before: `Cache-Control: no-store, no-cache, must-revalidate`
- After: `Cache-Control: no-store, no-cache, must-revalidate, no-transform`

The existing route-specific CSP, noindex response/meta policy, no-referrer/nosniff/frame denial, permissions policy, exact GET/HEAD path, public direct-link semantics, and no-store behavior remain unchanged. No external script or connection permission was added.

The calculator HTML, canonical source, route path, public pages map, navigation, footer, sitemap, robots content, and discovery behavior have no diff.

## Regression coverage

The focused hosting test now proves:

- exact GET and HEAD both contain `no-transform`;
- GET and HEAD retain every existing noindex and security header assertion;
- `/` and `/faq` do not receive the calculator-only directive;
- the hosted file still reconstructs the exact canonical bytes after removing only its existing non-visible robots meta line;
- CSP capabilities, self-contained-source checks, exact-path 404 behavior, and discovery exclusions remain intact.

The browser harness additionally asserts that the real Express response contains `no-transform` before testing the existing calculator behavior.

## Test results

- JavaScript syntax: PASS for the route, focused test, and browser harness.
- Focused hosting contract: 1 suite, 6 tests passed.
- Full ratification: 21 suites, 342 tests passed.
- Broad unit: 90 suites, 5,298 tests passed.
- Applicable API/cross-contract selection (`customers`, `health`, `homepage-demo`, `polaris`, `product-telemetry`): 56 tests passed and 1 existing test skipped.
- Chromium: 4 of 4 desktop/mobile light/dark-preference cases passed.
- Playwright WebKit: 4 of 4 desktop/mobile light/dark-preference cases passed.

Every browser case returned `no-transform`, populated 120 monthly and 10 annual rows, recalculated, exercised the existing expand/collapse controls, remained horizontally bounded, and recorded zero console errors, page errors, request failures, or external network requests. Each desktop-light case also completed one seeded uncertainty iteration through the blob-backed worker.

Evidence:

- `browser-evidence-chrome.json`: SHA-256 `e32047b33c4260bc1739dc72b51608005bff62f9def74f76fd648ce9212df4b9`
- `browser-evidence-webkit.json`: SHA-256 `cebb989b50befdf75f406b0072913c8ade93eeff6207b9faf0a3222beadbfe22`
- Eight screenshots and their individual hashes are recorded under `outputs/unlisted-investor-forecast-no-transform-writer/screenshots/` and in the JSON evidence.

The first full-ratification attempt under concurrent test load encountered the pre-existing legacy-retirement child-process test's fixed 15-second spawn timeout. That test then passed 9 of 9 alone, and the clean full-ratification rerun passed all 342 tests. This was an execution-load retry, not a product-code correction or omitted failure.

No PostgreSQL test is claimed: this release changes no migration, schema, persistence, query, authorization, or tenant boundary.

## Remaining proof and limitations

- Local and browser evidence proves that the origin route emits `no-transform`; it cannot emulate or certify Cloudflare's production transformation behavior.
- Only a post-merge deployment followed by a fresh production byte-for-byte GET can prove that Cloudflare stopped injecting the beacon and that the live body equals the exact `4,022,527`-byte hosted artifact with SHA-256 `f162b53d0d9c2d2b52c4a18675870aec9ee203d5a245279b4cb2f4d936cc71ae`.
- A successful post-deploy body comparison must also confirm the existing security/noindex headers and zero external request behavior; deployment success alone is insufficient.
- The direct link remains public to anyone who has it. `noindex` and `no-transform` are not authentication or confidentiality controls.
- Playwright WebKit is not physical Safari or physical-device evidence.
- Fresh independent audit is required before merge/deployment authorization.
