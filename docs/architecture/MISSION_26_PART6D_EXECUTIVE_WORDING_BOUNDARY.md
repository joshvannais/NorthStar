# Mission 26 Part 6D — Executive Brief wording correction

The existing Executive Brief consumed `PolarisApi.getExecutiveSummary()`,
which places canonical `metrics.estimatedRevenue` into a legacy
`revenue.total` field. The page displayed that value as **Total Revenue** and
could display missing forecast, outstanding and collection fields as `$0`.
It also supplied default 50% and 85% confidence figures to recommendations.
None of those labels or default percentages proves earned revenue, cash,
approved price, a calibrated forecast or recommendation confidence.

The Executive Brief now identifies the supplied amount as **Original Estimate
Guidance** only when it is a positive finite number. An absent or zero
guidance value is shown as **Not available**, because this summary cannot
distinguish a measured zero from missing pricing coverage. Approved price,
booked work and cash received remain separate unavailable positions in this
page until their owning source readers are integrated. The note explains that
guidance is not revenue. The summary no longer presents graph count as priced
deals, a hardcoded weighted pipeline, outstanding revenue or projected
revenue. Recommendation cards no longer manufacture confidence percentages or
impact labels. This correction does not alter PolarisApi, canonical estimates,
any financial record or the Command Center's separate guidance view.

`tests/browser/m26-part6d-executive-boundary.js` renders fictional priced and
unknown cases at desktop and mobile widths in Chrome and Playwright WebKit.
It checks the rendered wording, absence of invented revenue/forecast claims,
page errors and horizontal overflow. The screenshots were reviewed for clear
wording and responsive layout. Playwright WebKit is not physical Safari, and
these isolated fixtures are not production or founder visual approval.

This is a targeted Part 6D presentation correction, **not** final Part 6
acceptance. Monthly source-backed cards, graphs, drilldowns, paid/demo
recovery, approved/booked financial source integration and the independent
Part 6 gate remain open. No numerical Mission 26 forecast is issued.
