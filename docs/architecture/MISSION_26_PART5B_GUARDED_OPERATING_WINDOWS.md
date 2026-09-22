# Mission 26 Part 5B — guarded company operating-window position

Status: internal, unmounted source-to-calendar bridge. It does not issue worker availability, constrained capacity, a forecast, a schedule action, or a customer-facing value.

`readGuardedOperatingWindowPosition` reads the current tenant Business Profile hours through the existing Mission 22-guarded declared-availability snapshot. It verifies that the source digest, organization, horizon and time zone still match before passing the hours to the released Mission 26 operating-window calculation. A missing or incomplete source remains unavailable, rather than becoming zero. A valid but ambiguous Business Profile calendar also remains unavailable. The result exposes company operating intervals and minutes without returning the private workforce roster.

`sourceAuthenticated: true` means the current guarded snapshot supplied the hours. It does **not** establish an exact historical as-of cutoff; `temporalCutoffVerified` stays false. Business opening time does not imply any qualified employee is free, present, or assigned. `workerAvailabilityVerified`, `resourceConstraintsChecked`, and `forecastIssued` remain false. The guarded snapshot intentionally withholds this bridge if its broader workforce and approved-schedule evidence is incomplete; this is a Part 5B composite prerequisite, not a standalone business-hours service.

Focused tests verify source mapping, identity and digest mismatch, unavailable source, ambiguous hours, and error propagation alongside the existing calendar and guarded-reader unit tests. They do not provide disposable-PostgreSQL, private-production, exact-cutoff, provider, device, paid/demo, or forecast-accuracy evidence. Final Part 5B acceptance remains open.
