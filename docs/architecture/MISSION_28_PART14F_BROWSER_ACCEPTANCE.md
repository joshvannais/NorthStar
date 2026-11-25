# Mission 28 Part 14F — genuine browser acceptance

Status: **Released and terminally accepted.**

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
custom disclosure, activates every one of the four catalog templates through
an ordinarily focused button, and confirms each no-effect result receives
focus. It then fills every bounded custom field, submits a valid preview,
submits an out-of-range daily limit, proves the prior preview is exhaustively
cleared on the exact 400 validation response, and explicitly recovers with a
corrected valid preview. The paid flow uses the real owner session and CSRF
boundary. A tenant policy stored through the accepted canonical function makes
the paid positive control non-empty. A real isolated membership downgrade
proves that populated policy data clears on lost read authority and that a
restored exact owner membership recovers the same tenant-private projection by
explicit refresh.

Every one of those sixteen slots also repeats the first template and the
bounded custom setup through an ordinary mouse pointer on desktop or an
ordinary touch gesture on mobile. The resulting receipt records the input
class and both preview outcomes. A separate root-authored pointer/touch
reproducer executed by the writer passed 8/8 cases with exactly eight action
POSTs and zero page errors; its result SHA-256 is
`769E53ACCF03C3BC64B335A81EA6C7ECAE5D1164CB994EBC80B7265AA6F6D86A`.
Every desktop matrix slot also performs two hit-tested native canceled gestures:
press inside then release outside, and press outside then release inside. Both
must remain at zero POSTs. A separate root-authored, writer-executed Chrome and
WebKit paid/demo probe verified the button interior and outside `ARTICLE` or
`DIV` with `elementFromPoint`, recorded ten trusted native events per case,
passed 4/4 cases with zero POSTs and zero page errors, and produced result
SHA-256
`DFB7CA81C5043BD8DF5FAD23379B64FEE1772EE6FEEEB1FAC4CFFEF2D47C2486`.

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
all four demo workflow slots executed and 1,508 same-origin requests and 1,508
responses. Playwright WebKit 26.5 revision 2336 passed 8/8 cases with all four
paid and all four demo workflow slots executed and 964 same-origin requests
and 964 responses. Every slot exercised all four catalog templates plus valid,
invalid and corrected custom setup submissions through the keyboard, followed
by a genuine pointer or touch template preview and custom preview. Each engine
captured eight screenshots and recorded zero page errors, zero unexpected
console errors, zero external-origin requests and twenty expected browser
console messages:
eight deliberate bounded-input 400 responses and four each of the deliberately
exercised fail-closed 403, 409 and 503 responses. No request or response
interception was installed. The shared styles changed by Part 14F are bound to
an explicit Part 14F version in the common paid/demo Automation Center
document; every slot reloaded and traversed history with that versioned asset
set, including the version-bound Automation Center page script, so a warm
public cache cannot retain the prior target geometry or activation path on
this surface. The external writer result ledgers are bound by
SHA-256
`D36517CC0DBA714DF5CB0FBDED0A0012F455EAEC230943047F88272BAF713C03`
for Chrome and
`3D9C4594A84F0F4D563A732844842ABDAC822851B852039CE4A5DA1B7AE5899E`
for WebKit.

The rendered acceptance exposed and corrected three shared accessibility
defects before the final green runs: the theme switch and mobile navigation
open/close controls were shorter than 44 pixels, and compact-demo scenario
selectors could become narrower than 44 pixels at the mobile layout. These
browser runs also exposed and corrected the canonical preview validation
adapter's status mapping so an invalid bounded setup remains a truthful 400,
not an internal error. Genuine WebKit runs then exposed intermittent omission
of the compatibility `click` after an otherwise completed pointer or touch
release. The shared page now accepts a completed primary pointer/touch release
as the same semantic activation while retaining the ordinary `click` path for
keyboard and assistive technology, and suppresses only that gesture's follow-on
compatibility click. A broader mouse-event fallback was rejected because the
delayed compatibility mouse sequence produced a duplicate request and exact
409; it is not present in the final source. The normal PR review then exposed a
stale pending gesture after release outside the control. The shared page now
binds activation to the same still-valid pointer or touch identifier, clears
the pending gesture on an outside start, outside release or cancellation
through temporary document capture guards, and requires the release hit target
to remain inside the same button. Ordinary keyboard and assistive-technology
click activation remains unchanged. These writer results are
browser-automation evidence only. They cannot constitute
physical Safari/device evidence, manual assistive-technology review, founder
visual approval, private-production acceptance, provider/live evidence,
professional review, or a production performance claim.

## Independent acceptance and terminal release

Exact source `eedce86851a017ac8ecc0c08b6f63788b4dae88e`, tree
`20cb0a9b103fc927ed2e19eabd0b2410343fe09e`, passed the fifth complete fresh
full-history isolated root audit with P0=P1=P2=P3=0. Immutable report
`m28-part14f-root-audit-eedce-v5.json` has SHA-256
`28E2BF55BD634D3521F9AAFA7C33D0A3C4197DCE6305D542BDD871C374998E9F`.
Root independently reproduced 65 Mission 28 suites/1,002 tests, 167 supporting
passes with three intentional skips, one impacted-navigation pass with ten
unrelated skips, syntax 66, JSON 64, references 522, exact PostgreSQL 285/285
through 289/no290, Chrome 8/8, WebKit 8/8, native positive 8/8 and corrected
arm-first canceled gesture 4/4. The prior exact-eada P2 was valid, corrected by
the same sole writer, independently verified and resolved before exact-head
review completed with no findings or unresolved threads. Empty CI status and
workflow lists are not claimed green. Six baseline-reproduced legacy
full-parity failures are not claimed passing.

PR #613 normally squash-merged to exact main
`6b29a739d6df1660847aa7d70559a98979dc8021`, with the accepted tree unchanged.
The sole automatic deployment `8762dcc6-e838-419e-8c2d-70a5b8e5dcda`
reached `SUCCESS`; instance `b22069d1-e75e-4339-820f-0ee9cfa48774` is
`RUNNING` on image
`sha256:9cfd5e82dd3853bb3515a6966944802e74dfcf46e6f8c38fa04955d27af92a63`.
Canonical startup, both-domain health and six routes, exact paid/demo Automation
Center HTML and nine assets, unauthorized paid 401/no-store, read-only fictional
demo 200/no-store/zero effects, invalid query 400 and zero production POSTs were
passively verified. Fresh direct production read-only reconciliation proved
285/285 exact migration names/checksums through 289/no290 with no extra,
duplicate, mismatch or pending rows. Temporary SSH material was removed and a
fresh remote key listing was empty.

Fresh backup `9819cdb8-09ae-4eb0-b286-2db427ab4892`, named
`pre-m28-part14f-eedce868-20261125`, external identity
`vs_1795581896622_wsn1hz24t8l57y3o`, was confirmed before the predecessor was
removed, leaving one retained backup. Restore is unexercised and backup workflow
status unavailable.

## Effect and release boundary

All sources are local synthetic or fictional `example.test` data. The matrix
permits no external origin request and asserts zero recipients, provider calls,
external effects, financial effects and money effects. It performs no
production read or write. No migration is added; source remains 285 migrations
through immutable migration 289 with no 290.

Part 14F is released. Its browser automation does not establish physical
Safari/devices, manual assistive-technology review, founder visual approval,
authenticated private-production paid browser acceptance, provider/live
evidence or professional review; all remain unavailable and unclaimed. Part
14G's final cumulative audit and release procedure remains a separate slice and
is not pre-accepted by the Part 14F release.
