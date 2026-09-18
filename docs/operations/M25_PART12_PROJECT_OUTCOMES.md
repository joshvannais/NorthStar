# Mission 25 Part 12G project outcome operations

Part 12G records tenant-private advice from current imported project and change-order evidence that an owner or administrator has explicitly reviewed against one NorthStar estimate. A separate project-outcome permission must pin the current project source permission before an observation can be recorded.

The observation reports three independent areas:

- Scope preserves the original and current contract claims from exactly one current project record. It calculates a contract change only when both values are recorded in the same currency.
- Change orders require every distinct current change-order reference for the project to have exactly one current record and a current reviewed link to the same NorthStar estimate. State counts remain separate from a signed value. A signed value is available only when every change order has a recorded amount in one currency.
- Project delivery preserves the recorded project state and time interval. Duration is available only when an end time was recorded.

The result does not claim that a contract change was caused by the imported change orders. It does not infer approval, completion, a missing change order, a missing end time or a missing amount. No exchange rate or native NorthStar invoice, payment, collection, revenue, cost, profit or margin record is invented.

Every observation pins the current source-permission period, purpose-permission period, reviewed project link, complete current change-order match set, current NorthStar estimate basis, complete project source manifest, calculation version and request identity. A correction, tombstone, source or purpose permission change, reviewed-link change or NorthStar target change makes prior advice stale. Revocation hides derived history. A later grant starts a new period and does not revive earlier evidence, links or observations.

The result is advisory and changes no project, change order, customer, job, estimate, schedule, price, financial record, imported record or company policy. This API-only slice adds no rendered owner surface. Slices H-K remain mandatory for external financial outcomes, calibration, lifecycle operations and the complete Learning Center experience.

No live provider, provider credential, private production account, production migration, deployment, physical-device review or manual assistive-technology review is claimed.
