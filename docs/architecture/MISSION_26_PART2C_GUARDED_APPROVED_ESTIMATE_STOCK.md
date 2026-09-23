# Mission 26 Part 2C: guarded approved-estimate stock candidate

Status: isolated, unreleased bounded prerequisite. Full Part 2C remains open.

The released Part 2A Mission 24 decision snapshot and Part 2D guarded lineage read now feed the registered `pipeline.approved_estimate_stock` v1 feature. It counts active latest approved decisions in the captured as-of receipt; an explicit empty receipt yields zero. A later decision, withdrawal or added estimate changes the current source set and masks the old value as stale. A historical receipt is never silently rewritten.

The paid owner/admin route reads the same-tenant lineage through its existing PostgreSQL security-definer entry in a serializable transaction. It checks source purpose, target, tenant, time, source kind, definition identity and value contract, and returns a minimized count or unavailable stale state. Raw decision identities, customer data and approved prices are not returned. The pure evaluator explicitly does not authenticate caller-supplied objects; only the guarded route reports authenticated source evidence. The route requires current subscription/onboarding/session authority from the existing database reader and cannot create an estimate, appointment, quote or forecast.

Focused unit tests cover active, empty, withdrawn, stale and malformed source cases. Mounted disposable-PostgreSQL tests cover owner/member/other-tenant access, empty and positive counts, later approval/withdrawal invalidation, response minimization and no-store caching. This is one narrow historical stock. It does not prove the whole pipeline, future conversion, real tenant source coverage, calibration, UI presentation, or final Part 2C/12A acceptance.
