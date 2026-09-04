# Investor Forecast Monthly Layout — Writer Evidence

Date: 2026-09-04

## Release boundary

- Exact live base commit: `327f7ddd5f8090842f6f79fa632271262e5a6976`
- Exact live base tree: `2a4077b70d904c30d1e22c9fbac92af567e591fe`
- Writer branch: `website/investor-monthly-scroll`
- Isolated full-history checkout: `/home/joshv/codex-writers/investor-monthly-scroll`
- Scope: the unlisted calculator's monthly/annual result layout, narrow hosting/provenance assertions, browser coverage, and reproducible evidence.
- Excluded: Mission 23 Part 4, calculator formulas or defaults, the OneDrive source, route/discovery/security-policy behavior, other site pages, database/provider/private-data actions, deployment, and merge.

This is writer evidence for an implementation candidate. Automated checks do not create investor approval or legal, accounting, tax, or CPA approval. A fresh independent audit remains required.

## Source and hosted-artifact provenance

The canonical source remained read only:

`C:\Users\joshv\OneDrive\Documents\NorthStar Investor Calculator - Independent Review\Northstar Investment Calculator.html`

- Bytes: `4,022,457`
- SHA-256: `b395c52c594f89d2eea9e26fe848da4dd2a9e6e125f81b859d398c0eb3c96e3a`
- Title: `<title>Northstar Investment Calculator</title>`
- The exact byte count, hash, and title were rechecked after implementation.

The layout candidate is:

`public/unlisted/investor-forecast.html`

- Bytes: `4,023,971`
- SHA-256: `c7207560deb15cf1c86c569187a9e0e9c0761249bd6d83b68d0fe1ee18a2c7db`
- Its canonical formula/model script remains byte exact: `456,566` bytes, SHA-256 `d0915a1dbfbedbc82b8e9d613f2c00fd86f8e0535864d4be2d5fb48b4cc5d53c`.
- Its blob-worker template remains byte exact: `609,556` bytes, SHA-256 `068e47956832ede7a66830fa4690bb9b34f0423b894b364ff07b9662e408715a`.
- The intentional hosted delta is limited to the existing non-visible noindex metadata plus this release's result-markup, render-only mapping, and layout CSS.
- The existing visible title and all financial formulas, defaults, source data, and calculation functions remain unchanged.

## Implemented layout

- `Monthly projection` is now the first content section immediately after `Forecast overview`.
- It is a normal rendered section, not a collapsed details control.
- One table contains exactly 120 contiguous rows with `data-month="1"` through `data-month="120"`; there are no year wrappers or year-group markers in the monthly section.
- A bordered, rounded internal scroll region shows the sticky header plus Months 1–12 before vertical scrolling.
- Months 13–120 remain in the DOM. Month 120 is reachable by internal scrolling without increasing document height to 120 rows.
- The wide table scrolls horizontally inside the region. The first month/date column also stays pinned as other columns move.
- The region contains touch momentum/contained overscroll behavior, stable numeric alignment, a visible keyboard focus ring, `role="region"`, an accessible name and description, and `tabindex="0"`.
- The annual summary remains a separate collapsed secondary section immediately after the monthly projection and retains exactly 10 rows.
- The existing assumptions/details hub follows those result sections and retains its expand/collapse behavior.

## Engine semantic regression proof

Before editing, a real Chromium run captured deterministic default-result values from the exact live base. The final browser matrix compares the candidate against that exact snapshot in every case. The snapshot includes:

- summary: starting cash, ending cash, ending active customers, exit ARR, total revenue, total operating profit, cumulative investor distributions, and recovery month;
- Months 1, 12, and 120: planned additions, capacity-supported additions, ending active customers, revenue, total OPEX, and ending cash;
- Years 1 and 10: planned/capacity-supported additions, ending customers, and revenue.

All values remained exactly equal. Recalculation from starting investment `25000` to `25001` also retained 120 contiguous monthly rows and 10 annual rows.

## Browser and visual evidence

The real Express route was exercised in Chromium and Playwright WebKit at 1440x1000 desktop and 390x844 mobile, each under light and dark operating-system preferences. The canonical calculator supports a light color scheme only, which remained stable under both preferences.

Every case proves:

- Forecast Overview immediately precedes the visible Monthly projection;
- all 120 sequential monthly rows are in one table, without year groups;
- Months 1–12 fit initially and Month 13 starts below the viewport;
- vertical and horizontal internal scrolling work, the header stays sticky, and Month 120 is reachable;
- the scroll region accepts keyboard focus;
- 10 annual rows remain in a separate section;
- recalculation and remaining details expand/collapse behavior work;
- the exact noindex/no-transform response remains present;
- zero page/date/pill/suffix horizontal overflow;
- zero console errors, page errors, request failures, and external network requests.

The desktop-light case in each browser also completed one seeded uncertainty iteration through the blob-backed worker. Eight screenshots and two browser-evidence JSON files are stored beside this document. Screenshots were manually inspected at both widths; borders, radii, padding, row rhythm, typography, sticky-header treatment, and responsive containment are consistent and polished.

- Chromium evidence JSON: `3,040` bytes, SHA-256 `0832018d6ca38ac023a02c363d5443138110f28aa5b540992d8178bea4c0b27e`
- WebKit evidence JSON: `3,040` bytes, SHA-256 `d9b8a4599ee4561a271edfbd1ed34391c8abfc102ba36e4648baf008a7358478`
- Exact screenshot byte counts and SHA-256 values are recorded inside those JSON receipts.

## Findings corrected during implementation

1. The first fixed viewport height used the pre-existing table row minimum, but real Chromium line metrics made Month 12 partially clipped. The viewport now uses a measured 50px header and twelve 64px rows; Chromium and WebKit both prove Month 12 fully visible and Month 13 below the initial viewport.
2. Initial browser evidence output reused the previous hosting release directory. Before publication, those prior tracked artifacts were restored byte-for-byte and this release received its own evidence directory.

## Test results

- Inline JavaScript syntax: PASS for both embedded scripts.
- Browser harness syntax: PASS.
- Focused hosting/layout ratification: 1 suite, 8 tests passed.
- Full ratification: 21 suites, 344 tests passed.
- Broad unit: 90 suites, 5,298 tests passed.
- Contract/cross-contract: 2 suites, 108 tests passed.
- Applicable non-PostgreSQL API selection (`customers`, `health`, `homepage-demo`, `polaris`, `product-telemetry`): 5 suites, 56 tests passed, 1 existing test skipped.
- Chromium browser matrix: 4 of 4 cases passed.
- Playwright WebKit browser matrix: 4 of 4 cases passed.
- Repository whitespace validation: PASS.

No PostgreSQL test is claimed because this release changes no schema, migration, persistence, query, tenant, or authorization boundary.

## Remaining limitations and release gates

- This branch is not merged or deployed. Production route behavior is not claimed.
- Fresh independent audit is required before any merge/deployment decision.
- Production byte equality and absence of edge transformation require post-deployment verification; local `no-transform` evidence cannot certify Cloudflare behavior.
- The direct link remains public to anyone who has it; `noindex` is not authentication or confidentiality.
- Playwright WebKit is not physical Safari or physical-device evidence.
- The OneDrive source intentionally remains unchanged in this lane, so its prior grouped monthly layout is not represented as byte-identical to this hosted layout candidate.
- The calculator declares a light color scheme only; this scope did not introduce a new dark theme.
- Financial formulas and outputs were preserved and regression-checked, not newly audited for real-world forecast credibility.
