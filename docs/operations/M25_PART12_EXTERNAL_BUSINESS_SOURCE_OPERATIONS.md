# Mission 25 Part 12J external business source operations

Part 12J gives current owners and administrators one provider-neutral lifecycle for the accepted CRM and field-service, project and change-order, communication and external financial sources. A source can record a file import or provider API connection plan, manual/hourly/daily update cadence, retention period, deletion request and legal or audit hold. These records describe NorthStar's source handling; they do not connect to a provider or store a provider password, token or account identity.

Every lifecycle change is an immutable revision with an exact prior revision and digest. Historical-backfill and continuing-update checkpoints remain separate. Cleanup adds minimized tombstone revisions to the accepted import tables and processes no more than 100 current records per request. The returned checkpoint resumes the same exact retention or deletion revision. Changing retention or deletion authority starts a separate cleanup chain.

All source permission, import, hold, deletion and cleanup mutations for one company/source pair take the same transaction lock. A legal or audit hold that commits first blocks cleanup. Cleanup that already owns the lock finishes before a new hold can commit. The hold is checked again under that lock immediately before current records are selected.

A deletion request immediately revokes the current source permission. While deletion is active, imports and permission grants are blocked and ordinary source and downstream learning reads stay hidden through the existing current-period permission boundaries. Recovery requires an explicit deletion cancellation and a new source permission period. That new period starts empty and cannot revive deleted records, earlier reviewed links, observations or calibration.

An exact retry is returned only while the permission, connection, retention, deletion, hold or cleanup result is still the current revision for that source. Connection revisions pin the exact source-permission period that authorized them. A later revocation, deletion, cancellation, policy change, hold change, cleanup page or new permission period retires the earlier result. Retrying its old request key then reports that the source changed and never returns the retired success details.

The authority is tenant private, owner or administrator controlled, bounded, resumable and idempotent. Runtime can use only the guarded read, lifecycle and cleanup entries. It cannot update a customer, lead, job, appointment, estimate, project, change order, execution, schedule, dispatch decision, price, invoice, payment, collection, accounting record or company policy. Native NorthStar financial truth remains unavailable until Mission 27.

This slice adds no rendered page. Part 12K owns the paid and isolated-demo Learning Center, responsive behavior and complete Part 12 acceptance.
