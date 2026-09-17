# Mission 25 Part 11E — Imported material cost and purchasing observations

## Authority

This slice records a tenant-private advisory observation for one exact imported job and one exact adopted Mission 24 material plan. It requires current external-material source permission and separate `imported_material_cost_vendor_availability_v1` consent. The job, every material, and every vendor or inventory location used by a dimension must retain a current owner-reviewed Part 11C link.

The caller binds every plan line to one distinct opaque material reference. Vendor and inventory-location bindings are explicit and nullable because those dimensions can remain unavailable without suppressing compatible purchasing or cost evidence. Distinct imported materials must reconcile to distinct company material targets.

## Independent dimensions

- **Unit cost** compares the adopted line price only when current evidence contains one unambiguous `unit_cost` amount in the exact planned unit and estimate currency. A line total is never divided into a unit cost.
- **Purchasing** compares exact job purchase quantity in the planned unit. A recorded purchase total is shown only when every selected purchase uses `line_total` valuation and the estimate currency. Shipping, tax, discounts and unit prices are not added as line totals.
- **Vendor** reports only current reviewed lineage between the opaque source vendor and the supplier-quote label already adopted on that plan line. It does not verify, rank or recommend the supplier.
- **Recorded balance** compares one exact imported inventory balance at one reviewed location with the waste-inclusive planned quantity. It preserves the source timestamp and explicitly states that the record does not confirm current availability. Missing, conflicting or multiple current balances remain unavailable.

No unit conversion, currency conversion, valuation conversion, cost allocation, vendor selection, stock reservation, lead time, purchase need or current availability is inferred.

## Provenance and recovery

Each immutable observation pins the estimate, adopted revision and plan, current source-permission period, exact job/material/vendor/location reconciliation revisions, sorted bindings and the complete relevant current source manifest. Corrections, tombstones, source permission changes, purpose-consent changes, adopted-plan changes, target changes and reviewed-link changes stale and mask prior output.

Source or purpose revocation hides derived history and blocks new observations. A later grant starts a new consent period and revives neither old evidence, reviewed links nor observations.

## Boundary

The output is advisory. It changes no estimate, price, material plan, job, purchase, vendor, inventory record, stock balance, reservation, schedule or business policy. Multi-job materials calibration remains Slice F; lifecycle and cleanup remain Slice G; the rendered Learning Center and Part 11 acceptance remain Slice H.
