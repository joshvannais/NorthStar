# Mission 26 Part 11A: guarded disabled-settings history

Status: isolated, unreleased bounded prerequisite. Part 11A remains open.

The paid `/api/v1/forecast/settings` route reads the disabled system default
until an owner or administrator records a first reviewed revision. Later
revisions require the exact current revision and digest. The database keeps
each revision immutable, enforces tenant/session/role/CSRF authority,
serializes same-tenant writes, checks a request-key digest for replay and
rejects stale updates. Reads recompute the pure contract digest and fail
closed if stored content does not match. Responses are private and no-store.

This first store intentionally accepts **disabled settings only**. No target
or algorithm is active, so an enabled preference is unavailable. A stored
preference never proves source coverage, model eligibility or permission to
issue advice, and the route always reports `forecastIssued: false` and
`sourceEligibilityVerified: false`.

Disposable-PostgreSQL tests exercise default, immutable revision, replay,
stale update, changed replay, denied roles, unsupported activation, direct
table denial and tenant separation. The future Part 11A work still needs a
registered target/algorithm/source eligibility policy, enabled preferences,
owner-facing paid/demo UI, recovery and independent acceptance. This package
does not close Part 11A, Part 12A or any earlier Part 4–6 gap.
