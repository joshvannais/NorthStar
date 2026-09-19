# Mission 25 Part 11E acceptance evidence

## Frozen scope and base

- Accepted base: `b0f859aa2b96a75721f207925e8e58cf85655c13`.
- Scope: separately consented single-job imported unit-cost, purchasing, reviewed-vendor and recorded-inventory-balance observations against one exact adopted Mission 24 material plan.
- Excluded: currency, unit or valuation conversion; inferred current availability; vendor verification or ranking; cost allocation; purchasing actions; calibration; lifecycle cleanup; rendered Learning Center work; providers and production state.

## Implemented authority

- Migration `109_canonical_imported_material_cost_observations.sql` adds current-source-period purpose consent and immutable observation chains.
- Guarded owner/admin routes read or mutate consent and read or record observations.
- Every observation pins the exact estimate, adopted revision, material plan, current source permission, current job/material/vendor/location matches, explicit line bindings and complete relevant current imported-record manifest.
- Unit cost, job purchase quantity and line total, reviewed vendor lineage and recorded inventory balance are evaluated independently. Unit cost requires exactly one compatible current record; equal values never collapse separate provenance. Missing, duplicate, incompatible, ambiguous or mixed evidence remains unavailable for only the affected dimension.
- A purchase line total is never divided into an inferred unit price. A timestamped balance never claims present availability.
- Runtime receives only guarded entry functions; tables, projections, validators, match and basis helpers remain withheld.

## Executable evidence

- Fresh disposable PostgreSQL 17 applied migrations `001` through `109` and recorded the exact migration checksum once.
- Mounted Part 11E API exercise passed with an exact two-line adopted supplier plan, distinct reviewed materials, reviewed supplier and inventory-location links, USD and CAD cost evidence, job purchases, single and ambiguous balance records, concurrent deterministic replay, correction staleness and masking, purpose revoke/regrant non-revival, source revoke/regrant non-revival, tenant isolation, immutability and least privilege.
- The correction exercise proved that two identical-value current unit-cost records and two divergent current records both fail closed, every source change stales and masks prior advice, tombstoning one duplicate restores comparison only when one provenance chain remains, and a higher-version correction replaces its own chain without being counted as a second record.
- Five mounted Part 11A-D PostgreSQL compatibility exercises passed, including the bounded Part 11B import performance fixture.
- Ten mounted Part 11A-E contract and ratification suites passed with 33 assertions.
- JavaScript syntax checks and `git diff --check` passed.

## Evidence boundaries

- No provider credentials, provider calls, production data, production database, push, pull request, merge or deployment were used.
- No frontend surface changed. Physical-device, manual assistive-technology and founder visual verdict evidence are unavailable and not required for this backend-only slice.
- Slice F multi-job materials calibration, Slice G lifecycle operations and Slice H rendered Learning Center acceptance remain unavailable.
