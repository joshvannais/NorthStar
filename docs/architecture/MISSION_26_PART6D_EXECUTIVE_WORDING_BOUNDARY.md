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

This was a targeted Part 6D presentation correction and was not, by itself,
final Part 6 acceptance.

The Part 6D completion candidate now extends the existing embedded Command
Center insight with one compact **Open pipeline by stage** comparison inside
the collapsed **Review details** drill-in. It compares the source-backed
approved-not-booked and preliminary-estimate amounts for the current planning
window already supplied by the canonical revenue and cash outlook. The chart
does not add a dashboard, endpoint, migration, probability, earned-revenue
claim or cash-timing claim. Its accessible label states that the stage totals
can overlap and are not a probability or revenue forecast. Paid loading and
unavailable recovery remove the prior values and hide the chart; the fictional
demo remains isolated from the paid endpoint. Final Part 6 acceptance remains
subject to the independent whole exact-head audit and release gate.
