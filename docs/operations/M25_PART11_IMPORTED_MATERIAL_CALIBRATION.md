# Mission 25 Part 11F — Multi-job material and purchasing calibration

## Authority

This backend-only slice creates a tenant-private advisory calibration proposal from five to 100 current same-service jobs. Every sampled job must have one fresh Part 11D quantity observation and one fresh Part 11E cost observation for the same exact imported job and adopted Mission 24 material plan. Current external-material source permission, current quantity-outcome consent, current cost-outcome consent and separate calibration consent are all required.

The sample pins the source, quantity and cost consent periods; both immutable observation identities, revisions and digests; their complete current source digests; the normalized service; and the deterministic calculation version and request identity. Each distinct current pair of canonical estimate and exact imported job contributes one equal-weight job sample. Two separately reviewed imported jobs linked to the same estimate remain two samples; only later revisions of the same exact pair replace that pair's earlier observation.

## Equal job weight and independent dimensions

Each job first reduces all of its complete comparable plan lines to one median actual-to-planned ratio for each dimension. The cross-job calibration then gives each job equal weight and reports the median, lower quartile and upper quartile separately for:

- total material use;
- recorded waste;
- material unit cost;
- purchased quantity; and
- material purchase cost.

A dimension needs at least five current jobs on one exact basis. Plan-line coverage, units, plan shape and currency must already be compatible. Missing, duplicated, stale, mixed or incompatible provenance makes only the affected dimension unavailable. No unit, currency, valuation or missing-value conversion is inferred.

Raw robust statistics are preserved. A proposed multiplier is available only when the median is within the inclusive `0.25` to `4.00` review range. Values outside that range remain visible as evidence but cannot produce advice. Vendor lineage and recorded inventory balance are not calibrated because the accepted evidence establishes neither a numeric future vendor baseline nor current availability.

## Staleness and recovery

The live Part 11D and Part 11E basis functions are recomputed before a proposal is created or read. Source correction or tombstone, reconciliation change, adopted-plan change, target change, observation revision or consent-period change makes prior advice stale and masks its multiplier.

Source or purpose revocation hides and blocks derived work. Re-granting source, quantity or cost permission does not revive calibration permission or earlier proposals. A new calibration consent period is explicit and still cannot reveal proposals from an earlier period.

## Boundary

This backend-only slice adds no rendered owner surface. The output is advisory. It changes no estimate, price, material plan, job, purchase, vendor, inventory record, stock balance, reservation, schedule or business policy. Provider-specific connections, lifecycle and cleanup remain Slice G; the paid and isolated-demo Learning Center and complete Part 11 acceptance remain Slice H.
