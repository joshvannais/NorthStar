# Unlisted Investor Forecast — Writer Evidence

Date: 2026-09-04

## Release boundary

- Base commit: `15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`
- Base tree: `5f6ac55116e3488a51f0b1c3a06d04df3274ea91`
- Writer branch: `website/unlisted-investor-forecast`
- Writer checkout: `/home/joshv/codex-writers/unlisted-investor-forecast`
- Scope: one unlisted hosted calculator route, its route-specific policy, narrow inventory adjustments, and reproducible tests/evidence.
- Excluded: Mission 23 Part 4, calculator-model edits, production/provider/private-data actions, deployment, and changes to the OneDrive canonical source.

This writer evidence supports an implementation candidate. Automated tests and browser checks do not create investor approval or legal, accounting, tax, or CPA approval.

## Canonical-source provenance

Canonical source (read only):

`C:\Users\joshv\OneDrive\Documents\NorthStar Investor Calculator - Independent Review\Northstar Investment Calculator.html`

- Bytes: `4,022,457`
- SHA-256: `b395c52c594f89d2eea9e26fe848da4dd2a9e6e125f81b859d398c0eb3c96e3a`
- Title: `<title>Northstar Investment Calculator</title>`
- Final pre-commit recheck: the OneDrive file retained the exact byte count and SHA-256 above.

Hosted artifact:

`public/unlisted/investor-forecast.html`

- Bytes: `4,022,527`
- SHA-256: `f162b53d0d9c2d2b52c4a18675870aec9ee203d5a245279b4cb2f4d936cc71ae`
- Hosting delta: exactly one 70-byte, non-visible line was inserted in the document head: `<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">` plus its existing indentation/newline.
- Removing that one exact line produces `4,022,457` bytes and the canonical SHA-256 above.
- No visible banner, route reference, public-site link, wording, calculator style, or calculator-engine change was introduced.

## Direct-link and discovery behavior

- Exact route: `GET /investor/forecast` and `HEAD /investor/forecast`.
- No login is required. Anyone who receives the exact URL can access it.
- The route is deliberately unlisted, but it is not private and does not rely on obscurity as an access-control guarantee.
- The path is absent from the public pages map, navigation, footer, landing-page content, public discovery files, sitemap, and robots content.
- `robots.txt` does not advertise it through a `Disallow` entry.
- `/investor`, `/investor/`, `/investor/forecast/`, `/investor/forecast.html`, `/unlisted/`, and direct static-artifact paths return 404.
- The meta directive and `X-Robots-Tag` are crawler instructions, not authentication or confidentiality controls.

## Route-specific browser policy

The route replaces the shared application CSP with a policy scoped to the self-contained calculator:

- Allows only inline script/style, data images, and the calculator's blob worker.
- Denies network/API connections, forms, frames, objects, media, external fonts, base URLs, manifests, and framing ancestors.
- Sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`.
- Sends `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, same-origin resource policy, constrained permissions, and no-store/no-cache response policy.
- HTTPS requests retain the shared one-year HSTS policy.

The canonical document contains textual reference URLs in existing explanatory content, but it has no external script/style/frame dependency. Browser evidence recorded zero external network requests. Existing user-click navigation behavior inside the canonical document was not rewritten; forms, framing, and network APIs remain denied by policy.

## Findings corrected during implementation

1. Express's default string-route behavior initially accepted the trailing-slash variant. An exact-path guard now passes `/investor/forecast/` to the 404 route with no document disclosure.
2. Existing global visual-inventory tests assumed every HTML file was an application-shell page. The exact standalone canonical artifact is now explicitly classified and excluded only from shared-shell CSS/font-weight assertions; dedicated provenance, policy, browser, and overflow tests cover it instead.
3. Browser containment checks were limited to visible controls so intentionally collapsed descendant content cannot produce a false overflow result.

## Browser evidence

Final local replay served the real Express application and exercised the exact route in Chromium and Playwright WebKit. Each browser passed four cases: 1440x1000 light preference, 1440x1000 dark preference, 390x844 light preference, and 390x844 dark preference.

Every case proved:

- exact title, meta directive, route response, and response noindex directive;
- initial deterministic calculation with 120 monthly rows and 10 annual rows in both data and rendered tables;
- successful recalculation from starting investment `25000` to `25001` while retaining 120/10 rows;
- collapsed initial detail hub plus functional annual, monthly, and team expand/collapse controls;
- zero page, projected-date, visible pill, or suffix horizontal overflow;
- zero console errors, page errors, failed requests, or external network requests.

The desktop-light case in each browser also ran one seeded uncertainty iteration through the blob-backed worker and enabled the simulation export control.

Evidence files:

- `browser-evidence-chrome.json`: SHA-256 `53ad4329bcb59258ae71ebcaa7062b513f5fdc0912ef5f17cfa01420794e38c8`
- `browser-evidence-webkit.json`: SHA-256 `a91ee7f32b73a927964e7dd464e07ee15c5611cde0df4dd87fe7f89788e56900`
- Eight case screenshots are under `outputs/unlisted-investor-forecast-writer/screenshots/`; their individual SHA-256 values are recorded in the JSON evidence.

The screenshots were manually inspected at desktop and mobile sizes. They preserve the canonical NorthStar-themed calculator presentation, bounded card/control geometry, centered projected-date control, readable pill spacing, and responsive width without adding hosting UI.

The canonical calculator explicitly declares light color-scheme only. Dark operating-system preference was tested and remained a stable, readable light presentation; this release does not claim a calculator dark theme.

## Test results

- JavaScript syntax: route, server, and browser harness passed `node --check`.
- Focused hosting contract: 1 suite, 5 tests passed.
- Focused hosting/theme/professionalism ratification: 3 suites, 60 tests passed.
- Full ratification: 21 suites, 341 tests passed.
- Focused design-system plus hosting contract: 2 suites, 13 tests passed.
- Broad unit: 90 suites, 5,298 tests passed.
- Applicable non-PostgreSQL API/cross-contract selection (`customers`, `health`, `homepage-demo`, `polaris`, `product-telemetry`): 56 tests passed, 1 pre-existing test skipped.
- Chromium browser matrix: 4 of 4 cases passed.
- Playwright WebKit browser matrix: 4 of 4 cases passed.
- Repository whitespace validation: `git diff --check` passed.

An aggregate `tests/api` invocation was also attempted. PostgreSQL-backed suites correctly refused to run without the required `M19_PG_ADMIN_URL` disposable-database authority: 11 suites reported that unavailable prerequisite, 23 suites were skipped by their own gates, and the 5 applicable non-PostgreSQL suites passed. This route adds no migration, schema, query, or persistence code, so no PostgreSQL result is claimed for this release.

## Remaining limitations and release gates

- This is writer evidence only. The branch must receive a fresh independent audit before any merge or deployment decision.
- The route has not been validated in production and has not been deployed by this lane.
- No password or authenticated access was requested or added; possession of the direct URL is sufficient for access.
- `noindex` is a crawler directive and cannot guarantee that third parties will never save or share the URL.
- Playwright WebKit is not physical Safari or a physical iPhone/iPad result.
- The underlying forecast assumptions and arithmetic were preserved from the supplied canonical source; this hosting release does not independently certify their business credibility.
