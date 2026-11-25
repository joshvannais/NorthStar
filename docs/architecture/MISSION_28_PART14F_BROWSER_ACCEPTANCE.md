# Mission 28 Part 14F — genuine browser acceptance

Status: **Implementation candidate only. Not independently accepted or released.**

Part 14F exercises the paid Automation Center and its isolated fictional-demo
counterpart through the real canonical local server, a fresh disposable
PostgreSQL database, real owner session and CSRF authority, and ordinary
browser networking. The matrix uses system Chrome and Playwright WebKit at
desktop and mobile sizes in light and dark modes. It installs no request or
response interception, route fulfillment, browser-side fixture, or product
shortcut.

## Released baseline

Part 14E was independently accepted at source
`d63b9ff59f6af6aae63e6eeaa2f9683354245eea`, tree
`bf795536a331b940519c33e05115ce2f93c47daa`, with P0=P1=P2=P3=0. PR #612
normally merged to main `1c7eea4fd98773ed07b91bc632b10ca6f1ff03e3`.
Its sole automatic deployment `d9a02817-9850-4d80-a399-a47e47b1d0ec`
succeeded with running instance `203f21f2-f1d8-485c-a840-9c992614973f`
and image
`sha256:dfa302420bc877542997d3295567a4361769d46364d9772edf597358013564aa`.
Read-only production reconciliation proved exact 285/285 migrations through
289 with no 290. The fresh confirmed retained backup is
`e1c505fc-9f5b-4ac4-b4ef-7c6568773030`, named
`pre-m28-part14e-d63b9ff5-20261125`, external identity
`vs_1795566457688_tsr7y98iee96hi9w`; the former backup was removed only after
the exact replacement was confirmed, leaving one retained backup.

The complete fresh root source audit report is
`m28-part14e-root-audit-d63b-v3.json`, SHA-256
`E73DFDCE2F19F2611093B9E10EB4A906C685D3813A6CA5462F6C74A74A74DB82`.
Exact Node 22.23.3 reproduced 64 Mission 28 suites and 974 tests, supporting
167 passes with three intentional skips, impacted navigation one pass with ten
unrelated skips, syntax 67, JSON 63, references 522, and all 285 source
migrations through 289 with no 290. Fresh actual PostgreSQL independently
passed the three authority adversarials, six mounted Part 14E cases and 75
retained Parts 6A–6F cases. Migration 289's released raw SHA-256 is
`47C7AA1BC02C4DBC0CE03F3C57A014B16080070792E503F5616DF97B1DD52B08`.

## Browser matrix

The executable browser driver is
`tests/browser/m28-part14f-automation-center-acceptance.js`. Each engine runs
paid and demo pages at 1440×1000 and 390×844 in both themes. Every page is
entered directly with a fragment deep link, reloaded, navigated away from and
returned to with browser history. It validates a single main landmark,
heading order, live status semantics, named controls, unique IDs, 44-pixel
interactive targets, no horizontal overflow, owner-readable primary copy and
an inspectable accessibility snapshot. Every one of the sixteen
engine/surface/layout/theme slots executes its full applicable workflow; no
stateful journey is restricted to a preferred layout or theme.

The keyboard journey reaches the skip link, transfers focus to main, opens the
custom disclosure, prepares a real no-effect preview, and confirms focus moves
to the result. The paid flow uses the real owner session and CSRF boundary. A
real isolated membership downgrade proves prior paid data clears on lost read
authority and a restored exact owner membership recovers by explicit refresh.

The demo journey uses only buttons rendered from exact allowed actions. It
exercises source change/correction, pause/resume, safeguard/recovery, virtual
time, deterministic provider-fixture steps when available, terminal stop and
reset. Two real pages prove an old saved revision receives 409 and clears
instead of retaining obsolete state. A real PostgreSQL table lock provides a
delayed read without browser interception. A real local database-pool outage
produces a fail-closed error, followed by explicit pool reinitialization and
recovery with saved fictional authority unchanged.

Writer execution passed on exact Node 22.23.3 and Playwright Core 1.62.1. The
Chrome matrix passed 8/8 paid/demo layout-theme cases with all four paid and
all four demo workflow slots executed and 1,444 same-origin requests and 1,444
responses. Playwright WebKit 26.5 revision 2336 passed 8/8 cases with all four
paid and all four demo workflow slots executed and 900 same-origin requests
and 900 responses. Each engine captured eight screenshots and recorded zero
page errors, zero unexpected console errors, zero external-origin requests and
twelve expected browser console messages: four each from the deliberately
exercised fail-closed 403, 409 and 503 HTTP responses. No request or response
interception was installed. The external writer result ledgers are bound by
SHA-256
`A07301B02E8E3AEE5652432A4B0CB5095A70ABE2B9D169DDCE93C6AC88FBC009`
for Chrome and
`A814B411C1235033019B077FF0ED1492E1CC10365FFBCB6CB063D56A7B215A4B`
for WebKit.

The rendered acceptance exposed and corrected three shared accessibility
defects before the final green runs: the theme switch and mobile navigation
open/close controls were shorter than 44 pixels, and compact-demo scenario
selectors could become narrower than 44 pixels at the mobile layout. These
writer results are browser-automation evidence only. They cannot constitute
physical Safari/device evidence, manual assistive-technology review, founder
visual approval, private-production acceptance, provider/live evidence,
professional review, or a production performance claim.

## Effect and release boundary

All sources are local synthetic or fictional `example.test` data. The matrix
permits no external origin request and asserts zero recipients, provider calls,
external effects, financial effects and money effects. It performs no
production read or write. No migration is added; source remains 285 migrations
through immutable migration 289 with no 290.

This candidate is writer evidence. Independent whole-head acceptance, PR,
merge, deployment and production verification remain Part 14G and are not
claimed. Physical Safari/devices, manual assistive technology, founder visual
approval and provider/live/private-production evidence remain unavailable and
unclaimed.
