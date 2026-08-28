# Mission 22 Part 6 browser and visual ledger

## Frozen employee-only package

`employee-only-screenshots/` contains 96 exact-source screenshots across:

- installed Chrome 151 desktop light/dark and 390px mobile light/dark;
- actual Playwright WebKit 26.5 desktop light/dark and 390px mobile light/dark;
- direct-assigned work, current-active-crew work, no-work/unassigned empty,
  scheduled/not-dispatched, dispatched plus bounded route uncertainty and
  instructions, needs-review/unavailable evidence, crew removal, session
  revocation, loading, network error, offline, stale/reload, and paired Command
  Center reference views.

Every screenshot entry records the browser/engine and version, viewport, theme,
durable test role/identity, assignment mode, UI state, exact implementation
revision/tree, nonsecret disposable tenant/session provenance, expected visible
fields, withheld categories, source route, timestamp, and SHA-256. Fixtures use
isolated disposable PostgreSQL databases plus real cookie-session and durable
user/member/workforce/crew authority; no production account/data, client-only
role fabrication, weakened auth, or test endpoint is used.

## Visual and minimization result

The Today surface reuses the Command Center hierarchy, widths/gutters, section
rhythm, cards, borders/radii/shadows, gold/purple/neutral palette, shared shell,
footer, focus treatment, touch sizing, reduced motion, and light/dark behavior.
Mounted checks exercise 320/375/390 mobile widths, desktop/tablet widths,
keyboard, touch, 200%/400% zoom/reflow, and all frozen states without horizontal
overhang or clipped controls. The employee page deliberately suppresses broad
Quick Start and broad paid navigation because those enumerate owner-only
surfaces; accepted behavior elsewhere is unchanged.

DOM and captured response/network assertions, not screenshot absence alone,
prove the Today payload/DOM contains no financials, prices/margins/internal
costs/payroll, invoices/payments, billing/subscription settings, broad customer
history, other-worker schedules, owner-only Polaris cost intelligence, provider
credentials, or Mission 23 controls. Hostile durable bytes render only as text.

WebKit is not physical Safari. Physical-device and user visual approval remain
separate and unclaimed. After terminal Part 6 release, the Mission 22 lead must
copy this immutable in-repository package to the already verified canonical
OneDrive evidence/screenshots destination and surface key views in the master
chat; the writer does neither.
