# Mission 25 Part 11 Slice C acceptance candidate

This candidate starts from independently accepted Slice B head `a06968bad9620de8199286d7011bce511ea43a39` and implements only explicit reviewed job, material, vendor and inventory-location reconciliation.

## Source-controlled acceptance

- Owner or administrator review links each opaque source reference to one exact same-tenant current target.
- Each immutable link pins the current source permission period, complete current source-record manifest and complete current target manifest.
- Jobs use canonical estimates; materials and locations use accepted Mission 23 movement authority; vendors use exact supplier labels from currently adopted Mission 24 supplier-quote evidence.
- Source corrections or tombstones and target changes make lineage stale. Unlinks append history.
- Revocation hides reference and match details and blocks mutation. A later permission period revives neither old imported evidence nor old matches.
- Runtime authority is limited to guarded entry functions. No operational source or target is mutated.

## Executed evidence

- Fresh disposable PostgreSQL 17.10 applied the complete migration chain `001` through `107` under separate migration and runtime roles.
- The mounted Slice C API passed six end-to-end groups covering all four reference types, accepted target authority, exact source and target manifests, owner-only access, tenant isolation, no fuzzy matching, concurrent deterministic replay, source correction staleness, movement and location target staleness, immutable relink and unlink history, revocation, delayed replay masking, regrant non-revival, runtime least privilege, table immutability, exact checksum registration and operational non-mutation.
- Mounted Slice A and Slice B regressions both passed six end-to-end groups against the `001`–`107` chain. These preserve native material outcome authority and external source consent, import, correction, tombstone and non-revival behavior.
- Four focused unit and ratification suites passed 16 checks for the Slice A-C contracts, source-period scoping, exact target authority, entry-only privileges, set-based import validation and absence of a rendered surface.

## Boundaries

Slice C adds no provider credential, provider-specific adapter, fuzzy match, unsupported conversion, automatic reconciliation, inventory inference or valuation, outcome, calibration, source cleanup or frontend. Supplier-quote evidence is reviewed company evidence and is not supplier verification. It cannot change any operational record or business policy.

Production migration/application, deployment, private production data, provider state, physical-device evidence, manual assistive-technology review and founder visual approval are unavailable and are not treated as passing. Independent exact-head acceptance remains required before release.
