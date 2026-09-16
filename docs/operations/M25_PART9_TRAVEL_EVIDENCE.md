# Mission 25 Part 9 — Travel evidence release boundary

## Slice A authority

Migration `090_canonical_external_travel_import_authority.sql` and the guarded routes under `/api/v1/learning/external-travel-sources/:sourceKey` stage provider-neutral route, mileage and fuel evidence for one paid tenant. A current owner or administrator must grant source-specific consent. Historical and continuous batches carry the current consent revision and digest, a checked cursor, one exact schema version and 1–100 normalized records.

Each active record requires an opaque job reference, opaque vehicle reference, completed UTC route interval, IANA time zone and evidence class. It must provide distance or fuel evidence. Distance uses miles or kilometres and identifies GPS, odometer, provider-recorded or owner-confirmed basis. Fuel uses US gallons, litres or kWh; cost and a currently supported `USD`, `CAD` or `EUR` currency are both present or both unavailable. A source correction appends a higher version. A tombstone retains identity, version and source update time while removing route details.

The runtime role has no direct table or projection-helper access. It can call only four guarded entry functions. Consent revocation blocks writes and hides current records. Request keys, source versions, cursor chains, immutable history and the migration checksum make recovery and replay inspectable.

## Slice B reconciliation boundary

Migration `091_canonical_external_travel_reconciliation.sql` and `/api/v1/learning/external-travel-sources/:sourceKey/matches` let a current owner or administrator review and link the opaque job and vehicle references. A job link may select only a same-tenant canonical estimate. A vehicle link may select only a current active vehicle whose exact asset version has been reviewed. No name or identifier similarity creates a link.

Every immutable link or unlink pins current consent, source manifest, target digest, actor, session, request identity and explicit confirmation. A source correction or tombstone, reviewed vehicle identity or equipment-ledger change, target loss or consent revision makes an earlier link stale. Revocation hides references and targets and blocks new writes; exact delayed retries still return the original immutable receipt. Re-granting requires a fresh review.

## Deliberately unavailable after Slice B

- No provider-specific OAuth connection or credential storage.
- No estimate-versus-actual calculation or calibration yet.
- No conversion of an estimate, MPG model or straight-line geometry into an actual.
- No update to estimates, routes, schedules, reimbursement, payroll, assets, prices or policies.
- No Learning Center travel source UI yet.

Part 9 remains in progress until observations, multi-job calibration, source operations, owner UI and independent release acceptance are complete.
