# Mission 25 Part 10 Slice E asset health outcomes

Owners and administrators can separately authorize tenant-private maintenance and downtime summaries for one exact reviewed external vehicle or equipment reference. A current source consent, current Slice E learning consent and current explicit reviewed asset match are required. NorthStar does not match by name, manufacturer, model or similar text.

Maintenance and downtime are evaluated independently. Maintenance reports recorded service kinds and statuses. Downtime reports exact non-overlapping recorded duration and reason counts. Overlapping periods remain unavailable until the source is corrected. A maintenance event does not prove current condition, and downtime without a complete observation window does not prove availability, so condition and availability remain explicitly unavailable.

Each observation retains the complete current source-reference manifest, source and learning consent, reviewed match revision, exact current asset version and equipment-ledger basis, every current maintenance or downtime record used, calculation version and request identity. Corrections, tombstones, consent changes, match changes, asset-version changes and ledger changes make prior advice stale and hide its outcome values. Revocation hides outcomes and blocks new observations. Re-granting consent cannot revive an earlier observation or match.

The output is advisory. It does not change an estimate, price, schedule, job, vehicle, equipment record, maintenance plan, cost allocation, reimbursement, payroll record or business policy. This API-only slice adds no rendered owner surface. Calibration, source lifecycle operations and the Learning Center experience remain Slices F-H.
