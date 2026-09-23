# Mission 26 Part 11A: reviewed off preference in Settings

Status: isolated, unreleased bounded user-flow candidate. Full Part 11A remains open.

The paid Settings page can now record an explicit off preference through the existing guarded `/api/v1/forecast/settings` POST. It starts from the current revision and digest, uses the account session's CSRF handling and a request-specific idempotency key, and sends only the disabled profile already accepted by the Part 11A store. The backend remains the authority for current tenant, role, session, idempotency and exact revision. The action is separate from the page's general Save Changes control. A default-off state can become a reviewed-off state; later enabled preferences, if supported, can be turned off through the same path. Nothing here enables forecasting, verifies source coverage, changes customer output or erases history.

An ambiguous response is not reported as success. The page asks the user to refresh; if the saved revision appears, the action disappears. If the prior revision remains, the same pending idempotency key is retained for a subsequent retry. A conflicting revision requires a fresh read and decision. Access denial and malformed reads fail closed. The demo hides the write action and makes no paid forecast call.

Focused browser checks on the actual paid Settings route cover successful save, stale revision, lost response after a simulated commit, refreshed current state, duplicate-click prevention, desktop/mobile layout and page errors in Chrome and Playwright WebKit. The prior paid status checks were repeated because the same script and markup changed. Mounted demo Settings checks confirm no paid forecast request or POST. Mobile screenshots were inspected for wording and layout. Playwright WebKit does not substitute for physical Safari or founder visual approval.

This candidate does not close Part 11A. Enabled target/horizon settings, target and algorithm validation, complete owner workflow, source and calibration gates, full paid/demo acceptance, release and independent exact-head review remain separate. It does not issue a forecast or make a live-data claim.
