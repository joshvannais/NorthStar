# Mission 25 Part 11F acceptance evidence

## Frozen scope and base

- Accepted base: `1effdbc5768efe091d788dda544a37084f65cd7c`.
- Scope: separately consented, tenant-private multi-job advisory calibration from five to 100 fresh paired Part 11D quantity and Part 11E cost observations for one exact normalized service.
- Excluded: source lifecycle and cleanup, provider credentials, rendered Learning Center work, automatic adoption, unit/currency/valuation conversion, vendor recommendation and current-availability claims.

## Candidate authority

- Migration `110_canonical_imported_material_calibration.sql` adds immutable calibration-consent and proposal chains.
- The current-pair identity is the exact canonical estimate plus imported job reference. Later revisions replace only that exact pair; two reviewed imported jobs linked to one estimate remain two equal-weight samples.
- Five dimensions are evaluated independently: total material use, waste, unit cost, purchased quantity and purchase cost.
- Every job has equal weight: complete comparable plan lines first reduce to one per-job median for a dimension, then cross-job median and quartiles are calculated.
- A dimension needs five compatible jobs with exact units, plan shape and currency. Missing, incompatible or ambiguous evidence remains unavailable.
- Raw statistics are retained. Only an inclusive `0.25` to `4.00` median may become an advisory multiplier.
- Vendor lineage and recorded balance remain outside numeric calibration because they do not provide an adopted future baseline or prove current availability.
- Current source, quantity, cost and calibration permissions are all required. Revocation masks history, and later grants revive no earlier proposal.
- Runtime receives guarded entry functions only. Tables, projections, validators and basis helpers remain withheld.

## Executable evidence

- Fresh disposable PostgreSQL 17 applied migrations `001` through `110` for every mounted exercise and recorded the exact migration checksum once.
- The focused mounted Slice F exercise passed seven adversarial cases: deterministic concurrent consent replay, owner-only and tenant-private access, five-job robust statistics, under-sampled and mixed-basis unavailability, exact lower and upper multiplier boundaries, zero and extreme outlier withholding, per-job dimension independence, insufficient paired-observation rejection, source and purpose-consent non-revival, immutability and entry-only runtime authority.
- A full mounted positive-path exercise built five adopted two-line Mission 24 material plans, six imported jobs, complete current Part 11D/E pairs and two successful proposals. Five distinct estimate/job pairs produced sample size 5 and all five dimensions returned median `1.0000`, Q1 `0.9000`, Q3 `1.1000` and multiplier `1.0000`. Adding a sixth imported job linked to the first estimate produced sample size 6 without omitting either job; all five dimensions returned median `1.0500`, Q1 `0.9250`, Q3 `1.1750` and multiplier `1.0500`. Same-key replay, changed-body conflict, source-correction staleness, tenant/role isolation, consent non-revival, immutability and no material-plan mutation passed.
- Seven mounted Part 11A-F PostgreSQL exercises passed with 42 cases. The Part 11B cold and repeated 100-record performance exercise also passed under the unchanged five-second statement timeout: cold 100 was 95.33 ms, 1/50/100 records were 32.22/43.86/54.07 ms, and repeated 100-record pages were 58.37/63.74 ms against a two-second evidence ceiling.
- Twelve Part 11A-F contract and ratification suites passed with 42 assertions.
- Four related Mission 23/24 material-inventory, material-plan, adoption and cost-composition suites passed with 132 assertions.
- JavaScript syntax checks and `git diff --check` passed.

## Evidence boundaries

- No provider credentials, provider calls, production data, production database, push, pull request, merge or deployment are used.
- No frontend surface changes. Physical-device, manual assistive-technology and founder visual-verdict evidence are unavailable and not required for this backend-only slice.
- Slice G lifecycle operations and Slice H rendered Learning Center acceptance remain unavailable.
