# Mission 26 Part 11A: forecast preference status in Settings

Status: isolated, unreleased bounded presentation candidate. Full Part 11A remains open.

The paid Settings page reads the guarded current forecast-settings record through the existing `/api/v1/forecast/settings` route. It displays a cautious system default, a recorded owner/admin-reviewed off preference, restricted access, or an unavailable state. It never treats a preference as source coverage, an enabled algorithm, or an issued forecast. A response that contradicts this candidate's `forecastIssued: false` and `sourceEligibilityVerified: false` contract is withheld. The panel is read-only and does not join the page's general Save Changes form.

The same Settings page runs in the account-free demo. DemoRuntime is detected before any paid forecast request; the panel shows a clearly fictional off state and hides refresh. It does not write a preference or call the paid forecast API. This is a status preview, not a full demo forecasting journey.

Rendered browser checks cover default, reviewed-off, denied, malformed and unavailable paid states, plus refresh recovery, at desktop and phone widths in Chrome and Playwright WebKit. Mounted disposable-PostgreSQL demo checks cover the same page at desktop and phone widths, no paid forecast request, no POST, and no page errors. The paid panel screenshots were reviewed for plain language and responsive spacing; the fictional demo mobile panel was also reviewed. Playwright WebKit does not prove physical Safari behavior. No live tenant, provider, CI, founder visual verdict or production deployment is claimed.

The enabled-preference policy, target/algorithm/source eligibility checks, editable owner workflow, complete paid/demo forecast journey and independent full-slice acceptance remain open. Earlier Part 2 and Part 4–6 source and forecast gaps also remain open; this later-part display is an additive status consumer, not a waiver of those gates.
