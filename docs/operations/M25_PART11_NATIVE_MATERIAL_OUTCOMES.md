# Mission 25 Part 11 — Native material outcome boundary

## Slice A authority

Migration `105_canonical_native_material_outcomes.sql` and the guarded routes under `/api/v1/learning` add one tenant-private native material comparison. A current owner or administrator must separately grant `native_material_quantity_variance_v1` consent. The owner then selects one estimate, one completed job and one exact recorded item reference for every line of the estimate's currently adopted Mission 24 material plan.

Each plan line and recorded item reference must be unique. The exact plan-line set must match the submitted binding set. The completed job must still be linked to the estimate and must have a current matching completion record. Every current movement for a bound item is included in the source manifest. Unreviewed or review-required movements block the comparison.

For each line, the calculation compares the plan's waste-inclusive quantity with accepted `consumed` plus accepted `waste` movements. Units must already match exactly. Accepted returns, transfers and inventory adjustments remain pinned in the evidence but do not establish job use. Missing accepted use, a unit mismatch, a changed plan or completion, or changed movement evidence fails closed or makes earlier advice stale.

## Consent, corrections and adoption boundary

The observation pins the estimate, adopted estimate revision, material plan, execution, completion, sorted exact bindings and every matching current material movement revision and digest. Existing Mission 23 review, correction and reversal authority remains the only way to change source evidence. A source change alters the digest, masks the old advisory and requires a new immutable observation.

Purpose-consent revocation blocks writes and hides saved observations. Re-granting consent creates a new period and does not revive earlier records. Another tenant receives no record-existence signal. Runtime can execute only the guarded consent and observation entries; it cannot read the tables or call the source-basis helper directly.

The result is advisory. It does not change an estimate, price, job, material movement, inventory balance, purchase, vendor record or business policy. It does not match material names, convert units, infer stock, value inventory, create purchasing facts or claim vendor cost or availability.

## Slice A acceptance boundary

Disposable PostgreSQL coverage must apply the complete chain through `105`, exercise the mounted runtime API, verify exact line coverage, matching-unit behavior, deterministic replay and concurrency, stale masking after reviewed source changes, revocation and non-revival, tenant isolation, immutability, least privilege and migration checksum registration. Focused Mission 23 material, Mission 24 material-plan and accepted Mission 25 regressions must remain green.

External inventory, purchasing and vendor-cost imports; reviewed job, material, vendor and location reconciliation; broader quantity and waste observations; unit-cost, vendor, availability and purchasing outcomes; calibration; lifecycle cleanup; and Learning Center work remain mandatory Slices B-H. No provider, production, rendered or deployment evidence is claimed by Slice A.
