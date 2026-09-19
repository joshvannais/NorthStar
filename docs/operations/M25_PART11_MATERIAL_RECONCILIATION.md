# Mission 25 Part 11C material reference review

## Purpose

An owner or administrator can explicitly link opaque references from one currently permitted external material source to current NorthStar records. This is lineage for later learning. It does not merge records or change the operating system.

The four independent reference types are:

- a job reference linked to one same-company canonical estimate;
- a material reference linked to one exact item key that has current accepted Mission 23 movement evidence;
- an inventory-location reference linked to one exact location key that has current accepted Mission 23 movement evidence; and
- a vendor reference linked to one exact supplier label in a currently adopted Mission 24 material-plan line whose reviewed evidence type is `supplier_quote`.

Supplier-quote evidence remains owner-recorded evidence. A vendor link does not verify a supplier, create a vendor directory entry or establish that a price is still available.

## Exact review contract

The service never searches by similar name, case-folds a target, converts a unit or currency, or creates a missing target. The reviewer chooses one exact opaque source reference and one exact current target. Each link pins:

- the current source permission ID, revision and digest;
- every current record in that permission period carrying the source reference;
- the exact current target manifest and digest;
- the reviewer, current membership and authenticated session;
- the immutable request identity, reason and confirmation; and
- the previous match revision for the same source permission period.

Job target manifests pin the estimate snapshot. Material and location target manifests pin the complete current movement set, including review state, item, unit and location fields. Vendor target manifests pin every current adopted plan line carrying that exact reviewed supplier label, including the estimate revision, plan revision and full line evidence.

## Current, stale and unavailable

A linked match is current only while its source permission, complete source manifest and complete target manifest still match. A source correction or tombstone, accepted movement change, estimate change, plan adoption change, link revision or permission change makes earlier lineage stale or unavailable. Unlinking appends an immutable unmatched revision.

Revocation immediately hides reference and match detail and blocks new review. A later grant begins a new permission period. Old imported records and old matches do not reappear, and an exact delayed replay returns only a minimal unavailable receipt.

## Authority boundary

Only guarded owner or administrator read and mutation functions are executable by the runtime role. The runtime role cannot read or write the match table or execute its source, target or projection helpers.

This slice adds no provider credentials, provider adapter, automatic matching, material catalogue, vendor catalogue, inventory valuation, quantity or waste outcome, unit-cost or availability outcome, calibration, cleanup operation or rendered page. It cannot change an estimate, job, schedule, material plan, movement, inventory balance, purchase, vendor record, cost or company policy.
