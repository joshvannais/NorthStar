# Mission 25 import operations

Mission 25 Part 8 makes the released external labor authority usable from the Owner Learning Center. Owners and administrators can add a named company source, submit an exact-schema CSV historical page, record the provider-neutral lifecycle of a continuous adapter, inspect checkpoints, set a retention window, and execute retention or source deletion in bounded batches.

CSV files use the exact `m25-external-labor-time-v1` fields and contain one to 100 records per page. Parsing rejects unknown headers, malformed quoting, duplicate record identities, invalid timestamps and files over 256 KB before the guarded import entry runs. Historical and continuous cursors remain separate and resumable.

The adapter lifecycle records connection state, cadence and an opaque company account reference. No provider credential, access token or password is stored in this authority. A provider-specific connector still requires its own authorized implementation and release evidence; registering a lifecycle does not claim that a vendor connection exists.

Retention and deletion use revision and digest pins, idempotency keys, serializable transactions and a bounded cleanup limit of one to 100 current records. Cleanup appends detail-free tombstone revisions and records an immutable run checkpoint. Corrections and tombstones make dependent reviewed matches, observations and calibration proposals stale. A deletion request also revokes current source consent immediately, so new imports and derived reads stop before cleanup completes.

This package remains tenant private and advisory. Members and viewers cannot use these controls. Demo controls are read-only and cannot contribute evidence. Cleanup does not rewrite historical estimates and does not apply a rate, labor plan, schedule, payroll decision or business policy.
