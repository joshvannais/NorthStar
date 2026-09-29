# Mission 26 Part 2B — supported price cohorts at capture

This bounded comparison joins two normalized local months to NorthStar's
ordered Mission 24 approved-price source. Both months must use the same
prospectively anchored Business Profile version, time zone, area and calendar.
The first price receipt must be separately observed committed before the
earlier month begins. A guarded current receipt must contain the bounded
post-anchor source events and be captured after both months end. Different
currencies, missing anchors, partial periods, changed profiles or source
receipts return unavailable. The mounted comparison invokes the canonical
`compareReportingWindows` structural check and carries its
`normalizationRequired` decision, separate elapsed/open-minute/calendar
dimensions, and each month's elapsed and open minutes. No rate or preferred
denominator is selected, especially when known open minutes are zero. Those
values must be considered before comparing raw counts across months of
different length or daylight-saving offset. The paid owner/admin
route exposes only derived counts and source digest, never private raw rows.

The reported count is the number of approved-price decision rows whose
**source-order timestamp** falls inside each local month in the guarded
receipt. A zero count means no such selected-source rows were committed and
visible at capture for that window after the prospective anchor. Migration
146 assigns that timestamp
under a tenant transaction lock held through commit; migration 147 refuses to
capture while a same-tenant writer holds the lock. Once a post-period capture
commits, any later writer advances the source-order high-water mark and makes
that receipt stale on a current read. The receipt therefore contains the
committed selected-source events visible at capture, and later changes fail
closed. It does **not** reconstruct the exact month-end
commercial balance, certify off-platform or whole-business source coverage,
or establish that every decision committed before the month ended. The route
keeps the broad `observationCoverageVerified: false` and issues no forecast.
The separately activated first receipt proves only the source start was
committed before the first period. Source currentness must be checked again
when a later run uses this comparison.

Focused mounted fictional-tenant tests cover prospective refusal for past
months, tenant/role denial, currency mismatch, and a test-only date-shifted
two-month zero-at-capture comparison across New York daylight saving time.
The date shift exercises the comparison path, not genuinely elapsed history.
The capture-time selected-source event-window method requires the immutable
source-order trigger, guarded prospective anchor, post-period receipt and
same-tenant lock together. The synthetic tests exercise this combination;
genuine elapsed production months and area-filtered price events remain
unverified. Independent full-slice acceptance is separate. No real customer
history or paid forecast is asserted.

The prospective profile anchor also supports a separate guarded
`/effective-anchors/:anchorId/compare-months` read for `tenant_all` or
`profile_area`. It pins the same Business Profile and verifies both effective
local months before comparing time zone, calendar and area context. A
`profile_area` result carries the configured service-area digest; `tenant_all`
has no area digest. Missing or changed area, partial source applicability,
wrong tenant, and unauthorized roles fail closed. The returned elapsed/open
minutes and normalization dimensions describe **profile context only**. This
read does not filter Mission 24 price events by geography or certify area
observation coverage, completed price periods, or a forecast. Three focused
mounted fictional-tenant tests cover the two scopes, New York DST, missing and
changed area, partial months, and tenant/role denial. The elapsed positive is
test-only date-shifted, not real elapsed source history.

A further mounted fictional-tenant test uses the genuine Mission 24 decision
HTTP writer for approval, price correction and withdrawal. It then shifts
only disposable fixture timestamps to place the three immutable source events
in two older local months; the guarded comparison counts one and two decisions
known at capture. This proves that the joined paid route handles positive and
corrected source identities, but the artificial dates do not prove genuine
elapsed observation or month-end finality. A held same-tenant price writer
causes HTTP capture to return busy; after that writer rolls back, a new guarded
receipt still contains exactly the three committed events and the two-month
comparison remains available. The failed HTTP attempt counts toward its normal
throttle, so the recovery receipt is captured through the same guarded SQL
function in a fresh runtime transaction and read through the mounted route.
Whole-business observation coverage and full Part 2B acceptance remain open.

The focused test also holds a later same-tenant source decision open across a
guarded capture attempt. Capture fails busy until the decision commits; the
previous receipt then reads stale. A fresh receipt sees the committed event.
After a disposable test-only timestamp shift places that late decision in the
second older month, the new comparison counts one and three, while the first
receipt remains immutable and unavailable as current. This proves the tenant
source-order fence and currentness behavior at **capture time**. It does not
prove a transaction's commit preceded the historical month boundary or that a
whole-business calendar month is final. The late in-period placement in this
test requires owner-only fixture backdating after commit; production's
immutable source order does not permit that mutation. The output still keeps
`observationCoverageVerified: false` because it does not certify all business
activity or any source outside the selected NorthStar decision ledger.
