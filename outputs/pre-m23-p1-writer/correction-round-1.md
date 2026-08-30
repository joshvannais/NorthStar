# P1 independent-audit correction round 1

Audit source head: `b30b25d167462e45a3081aa557cfb0908dfae67d`.

The fresh independent audit returned `CHANGES_REQUIRED`, P0/P1/P2/P3 `0/0/2/0`. This writer round changes only the two confirmed roots.

## Corrections

1. Restored native typography synthesis by removing `font-synthesis: none`. The four P1-introduced synthetic numeric font weights were normalized from `650` to the approved native `600` weight so the unchanged native-typography ratification remains authoritative.
2. Restored the route-complete theme-toggle accessible name to `Switch to {next} theme`. Current state remains available through `aria-pressed`, `data-current-theme`, the visible slider position, and the descriptive `title`; keyboard operation and persistence are unchanged.

## Writer verification

- Authentic static/focused suite: 6 suites / 63 tests passed.
- Mounted route matrix for `/dashboard/today`: installed Chrome and actual Playwright WebKit, 1440x900 and 390x844, light and dark, passed. The matrix exercised the unchanged accessible-name assertion, theme transition, keyboard/focus/interactive-state audit, contrast and no-overflow checks.
- A complete all-route matrix was attempted first. It reached the corrected theme control but the existing first-arrival Quick Start modal on a Command Center route intercepted the test's pointer click. The writer did not force-click, modify that unrelated P2 onboarding behavior, or weaken the unchanged browser contract.
- The exact-head P1 ordinary and hostile/security visual matrices are regenerated after freeze and remain separate.

Playwright WebKit is not physical Safari. PostgreSQL 18 identity, hosted CI, providers, credentials, private production data, merge, deployment and production acceptance remain unavailable in this writer lane.
