# Mission 25 Part 11D — Imported material quantity outcomes

## Authority

This slice records a tenant-private advisory observation for one exact external job and one exact adopted Mission 24 material plan. It requires current external-material source permission plus separate `imported_material_quantity_variance_v1` consent. Every external job and material reference must have a current owner-reviewed Part 11C link.

The caller supplies an exact binding from every adopted plan line to one distinct opaque external material reference. The plan-line set, binding set and current recorded material-reference set must be equal. Reusing one external reference or one reconciled target item for multiple plan lines fails closed. NorthStar does not match names, guess a material, convert a unit or infer a missing record.

## Independent dimensions

Only current `inventory_movement` records marked `consumed` or `waste` support this slice. Purchases, vendor costs, balances, receipts, returns, transfers and adjustments do not establish job use here.

For each line:

- recorded consumption is available only when at least one current consumed record exists and every consumed record already uses the planned unit;
- recorded waste is available only when at least one current waste record exists and every waste record already uses the planned unit;
- total recorded use and plan variance are available only when both consumption and waste are available;
- absence is reported as unavailable and is never treated as zero.

The overall advisory is available only when every planned line has a comparable total. The deterministic five-percent band matches the accepted native material comparison. Partial observations retain their independent recorded dimensions while withholding the overall advisory.

## Provenance and recovery

Each immutable observation pins the estimate snapshot, adopted estimate revision, material plan, source-permission period, exact job match, exact material matches, sorted bindings and complete current job-record manifest. Corrections, tombstones, source permission changes, plan adoption changes, target changes and reviewed-link changes alter that basis and mask prior advice until a new observation is confirmed.

Source revocation or purpose-consent revocation hides derived values and blocks new observations. A later source grant requires a new purpose grant and does not revive evidence, links or observations from an earlier permission period. Reads expose only the current consent period.

## Explicit boundaries

The slice is advisory only. It changes no estimate, price, job, plan, material movement, inventory balance, purchase, vendor record, cost, schedule or business policy. Unit cost, vendor, purchasing and availability observations remain Slice E. Multi-job calibration remains Slice F. Retention and deletion operations remain Slice G. The owner Learning Center and Part 11 acceptance remain Slice H.
