# Mission 26 Part 2B — prospective Business Profile applicability

This bounded source closes one gap in the reporting-window contract: a current
Business Profile cannot prove what calendar, time zone, or service area applied
to a past observation period. A paid owner or administrator can capture the
active profile as a prospective anchor. A second transaction observes that
capture committed. A completed local month is eligible only when that commit
observation predates the month's start and no profile source change occurred
before its end. The guarded read derives the month from the pinned version,
including its actual UTC boundaries and daylight-saving offset.

Migration 169 adds a private ordered sidecar to Business Profile writes and
append-only anchor/activation receipts. The capture, activation, pin, and
window functions enforce current paid tenant and role authority; runtime has
only guarded function access. The source lock orders profile writes against
capture and read. Missing anchors, an unelapsed month, or a changed profile
return unavailable. A later raw-profile change may conservatively withhold
an older window even when the change occurred after its end.

The mounted fictional-tenant tests cover capture/replay, separate activation,
past-month refusal, tenant/role denial, and guarded local-month derivation. A
test-only timestamp shift exercises an elapsed positive month; it is not
evidence that real time elapsed or that historical customer observations were
complete. This source proves only NorthStar-observed profile applicability
prospectively. It does not certify old owner month claims, approved-price
event coverage, comparable two-period observations, calibration, or a forecast.
Part 2B remains open until those source-backed comparisons are implemented
and independently audited. Deployment and live-data validation remain open.
