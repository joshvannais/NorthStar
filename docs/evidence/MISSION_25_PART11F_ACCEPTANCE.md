# Mission 25 Part 11F acceptance evidence

## Frozen scope and base

- Accepted base: `1effdbc5768efe091d788dda544a37084f65cd7c`.
- Scope: separately consented, tenant-private multi-job advisory calibration from five to 100 fresh paired Part 11D quantity and Part 11E cost observations for one exact normalized service.
- Excluded: source lifecycle and cleanup, provider credentials, rendered Learning Center work, automatic adoption, unit/currency/valuation conversion, vendor recommendation and current-availability claims.

## Candidate authority

- Migration `110_canonical_imported_material_calibration.sql` adds immutable calibration-consent and proposal chains.
- Five dimensions are evaluated independently: total material use, waste, unit cost, purchased quantity and purchase cost.
- Every job has equal weight: complete comparable plan lines first reduce to one per-job median for a dimension, then cross-job median and quartiles are calculated.
- A dimension needs five compatible jobs with exact units, plan shape and currency. Missing, incompatible or ambiguous evidence remains unavailable.
- Raw statistics are retained. Only an inclusive `0.25` to `4.00` median may become an advisory multiplier.
- Vendor lineage and recorded balance remain outside numeric calibration because they do not provide an adopted future baseline or prove current availability.
- Current source, quantity, cost and calibration permissions are all required. Revocation masks history, and later grants revive no earlier proposal.
- Runtime receives guarded entry functions only. Tables, projections, validators and basis helpers remain withheld.

## Executable evidence

- Fresh disposable PostgreSQL 17 applied migrations `001` through `110` for every mounted exercise and recorded the exact migration checksum once.
- The mounted Slice F exercise passed seven adversarial cases: deterministic concurrent consent replay, owner-only and tenant-private access, five-job robust statistics, under-sampled and mixed-basis unavailability, exact lower and upper multiplier boundaries, zero and extreme outlier withholding, per-job dimension independence, insufficient paired-observation rejection, source and purpose-consent non-revival, immutability and entry-only runtime authority.
- Six mounted Part 11A-F PostgreSQL exercises passed with 37 cases. The Part 11B cold and repeated 100-record performance exercise also passed under the unchanged five-second statement timeout: cold 100 was 93.75 ms, 1/50/100 records were 31.76/43.01/53.54 ms, and repeated 100-record pages were 58.45/62.02 ms against a two-second evidence ceiling.
- Twelve Part 11A-F contract and ratification suites passed with 42 assertions.
- JavaScript syntax checks and `git diff --check` passed.

## Evidence boundaries

- No provider credentials, provider calls, production data, production database, push, pull request, merge or deployment are used.
- No frontend surface changes. Physical-device, manual assistive-technology and founder visual-verdict evidence are unavailable and not required for this backend-only slice.
- Slice G lifecycle operations and Slice H rendered Learning Center acceptance remain unavailable.
