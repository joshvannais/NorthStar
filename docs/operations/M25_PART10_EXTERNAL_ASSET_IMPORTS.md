# Mission 25 Part 10 — external vehicle and equipment import boundary

## Slice B authority

Migration `097_canonical_external_asset_import_authority.sql` and the guarded routes under `/api/v1/learning/external-asset-sources/:sourceKey` add provider-neutral historical-backfill and continuing-update staging for vehicle and equipment utilization, operating-cost, maintenance and downtime evidence. A source is an opaque tenant-owned key. No vendor name or provider credential is part of the authority.

A current owner or administrator explicitly grants source-specific consent. Every batch pins the current consent revision and digest, schema `m25-external-asset-actual-v1`, independent mode cursor, exact normalized records, confirmation, actor/session authority, request digest and idempotency key. Batches contain one to 100 records. Current projection is bounded to 20 runs and 100 records.

Each active record has one typed claim. Utilization requires an explicit measured unit and basis. Operating cost requires amount, currency, cost class and basis. Maintenance requires its service class and status and may retain an opaque work-order reference, exact meter observation and explicit maintenance cost. Downtime requires a reason class and scheduled state. All records retain exact period, time zone, evidence class, source update time and an opaque provider-evidence digest without storing provider credentials or an unrestricted raw payload.

## Correction, consent and non-mutation boundary

Exact record-version duplicates are deduplicated only when their normalized digest matches. Conflicting same versions and older versions fail closed. Higher versions append immutable corrections. A tombstone is another immutable version with no operational details. Source-consent revocation blocks new writes and hides current evidence. An exact delayed request still replays its original immutable receipt after revocation; changed content under the same key conflicts.

The runtime role can call only guarded consent, batch and read entries. It cannot read or mutate protected tables or execute projection and validation helpers. Every record remains staged source evidence. It does not become a Mission 23 operational fact, reconcile an external job or asset, calculate an outcome, allocate a cost, or change any job, estimate, schedule, asset or business policy.

## Acceptance and wording boundary

The package adds API routes and no HTML, CSS or browser renderer. Plain-language API messages cover invalid evidence, permission, conflict, refresh and temporary-unavailable states. No raw internal digest, table name, route name or provider implementation detail is added to a rendered surface. The future owner experience still requires the standing wording, focus, keyboard, mobile, theme and founder visual-review gates.

Disposable PostgreSQL evidence must apply the complete migration chain through `097`, stage all four record classes, verify explicit units/currency/source provenance, correction, conflict, tombstone, consent revocation, exact replay after revocation, tenant isolation, immutable tables, entry-only runtime privileges and exact migration checksum registration. Hosted CI, production migration/application, live provider state, provider credentials, private production data, physical devices and founder visual approval remain unavailable and are not treated as passing.
