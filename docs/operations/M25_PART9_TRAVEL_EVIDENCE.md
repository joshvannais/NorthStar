# Mission 25 Part 9 — Travel evidence release boundary

## Slice A authority

Migration `090_canonical_external_travel_import_authority.sql` and the guarded routes under `/api/v1/learning/external-travel-sources/:sourceKey` stage provider-neutral route, mileage and fuel evidence for one paid tenant. A current owner or administrator must grant source-specific consent. Historical and continuous batches carry the current consent revision and digest, a checked cursor, one exact schema version and 1–100 normalized records.

Each active record requires an opaque job reference, opaque vehicle reference, completed UTC route interval, IANA time zone and evidence class. It must provide distance or fuel evidence. Distance uses miles or kilometres and identifies GPS, odometer, provider-recorded or owner-confirmed basis. Fuel uses US gallons, litres or kWh; cost and a currently supported `USD`, `CAD` or `EUR` currency are both present or both unavailable. A source correction appends a higher version. A tombstone retains identity, version and source update time while removing route details.

The runtime role has no direct table or projection-helper access. It can call only four guarded entry functions. Consent revocation blocks writes and hides current records. Request keys, source versions, cursor chains, immutable history and the migration checksum make recovery and replay inspectable.

## Slice B reconciliation boundary

Migration `091_canonical_external_travel_reconciliation.sql` and `/api/v1/learning/external-travel-sources/:sourceKey/matches` let a current owner or administrator review and link the opaque job and vehicle references. A job link may select only a same-tenant canonical estimate. A vehicle link may select only a current active vehicle whose exact asset version has been reviewed. No name or identifier similarity creates a link.

Every immutable link or unlink pins current consent, source manifest, target digest, actor, session, request identity and explicit confirmation. A source correction or tombstone, reviewed vehicle identity or equipment-ledger change, target loss or consent revision makes an earlier link stale. Revocation hides references and targets and blocks new writes; exact delayed retries still return the original immutable receipt. Re-granting requires a fresh review.

## Slice C outcome boundary

Owners and administrators may separately grant `imported_travel_variance_v1` consent, then record an observation for one reconciled external job and its exact adopted travel plan. Current job and vehicle matches are mandatory. The result compares route duration, driving distance, fuel or energy quantity, and fuel cost independently. A dimension is marked unavailable when its evidence is missing, incompatible, straight-line only, or uses a different currency.

Source corrections, tombstones, consent changes, match changes, vehicle basis changes, and adopted-plan changes make prior observations stale and suppress their advice. Exact delayed idempotency replay remains available after revocation. No observation updates an estimate, route, schedule, reimbursement, payroll record, vehicle, equipment ledger, or business policy.

## Slice D calibration boundary

Migration `093_canonical_imported_travel_calibration.sql` and guarded calibration routes require separate current calibration consent before an owner or administrator can summarize reviewed imported travel outcomes. One proposal covers one exact service key and pins five to 100 current observation chains, the active source and outcome consent, every observation and source digest, the calculation version, actor, session and request identity.

Route duration, distance, fuel or energy quantity and fuel cost are calibrated independently. A dimension needs five compatible observations with one exact unit or currency. It reports deterministic median and lower and upper quartile actual-to-planned ratios. The median is exposed only as an advisory multiplier. Mixed fuel classes or currencies suppress that dimension while valid dimensions remain reviewable.

Source corrections, tombstones, reviewed-match changes, adopted travel-plan changes, observation refreshes and consent changes stale the proposal and mask its multiplier and advisory. Exact delayed idempotency replay still resolves the immutable saved request with stale advice masked. The runtime role receives only guarded entry-function access and no direct table or projection-helper access.

## Slice E source-operations boundary

Migration `094_canonical_external_travel_import_operations.sql` and the guarded `/operations`, `/adapter`, `/retention`, `/deletion` and `/cleanup` routes add provider-neutral lifecycle and cleanup controls for one external travel source. Adapter revisions expose connect, pause, resume and disconnect state plus cadence while storing no provider credential. Historical and continuous import checkpoints remain separate.

Retention policy identifies current source records older than the configured 30- to 3,650-day interval. Deletion requests revoke source consent immediately and block further imports. Retention and deletion cleanup append minimized travel tombstones in batches of one to 100 and preserve immutable, resumable cursor lineage. A zero-record completion also persists an exact idempotency receipt. Changing retention or deletion authority starts a new checkpoint chain. Cancelling deletion does not reactivate source consent. Owners and administrators retain the only guarded mutation path; the runtime role has no direct operation-table or projection-helper access.

## Deliberately unavailable after Slice E

- No provider-specific OAuth connection or credential storage.
- No conversion of an estimate, MPG model or straight-line geometry into an actual.
- No update to estimates, routes, schedules, reimbursement, payroll, assets, prices or policies.
- No Learning Center travel source UI yet.

Part 9 remains in progress until the paid and isolated-demo owner UI and independent release acceptance are complete.
