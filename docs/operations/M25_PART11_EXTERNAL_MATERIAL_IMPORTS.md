# Mission 25 Part 11 — External material evidence boundary

## Slice B authority

Migration `106_canonical_external_material_import_authority.sql` and the guarded `/api/v1/learning/external-material-sources/:sourceKey` routes stage normalized provider-neutral evidence for inventory balances, inventory movements, purchases and vendor costs. A current owner or administrator must grant separate permission for one opaque source before any page can be accepted.

Every record carries an opaque source record identity and version, one exact material reference, applicable opaque job, vendor and location references, event and source-update times, an IANA time zone, exact quantity and unit, applicable amount, currency and valuation, evidence class and provider evidence digest. Historical and continuing pages are bounded to 100 records and pin the current permission revision and digest plus the exact prior cursor.

Each distinct time zone in a page is validated once through a set-based lookup against PostgreSQL's IANA time-zone catalogue before any record is inserted. An invalid zone rejects the entire page. The public 100-record bound and fixed five-second database statement timeout remain unchanged.

Inventory balances require a location and permit an explicit zero balance. Inventory movements require a location, positive quantity and one declared movement class. Purchases and vendor costs require positive quantity, a vendor reference and an explicit cost object. Purchases accept only unit or line-total valuation. No unit, currency, quantity, amount, time or opaque reference is converted or inferred.

## Consent, correction and source boundary

Imports append immutable runs and records. An exact idempotency retry returns the committed run. The same request key with changed content fails closed. A changed provider record requires a strictly higher external version and preserves the prior revision. Removal requires a higher-version tombstone with no retained business detail.

Revocation immediately hides all source detail and blocks new pages. Re-granting begins a new permission period; records from earlier periods stay hidden. Another tenant receives no record-existence signal. Runtime can execute only the four guarded consent/import/read entries and cannot select protected storage or call its validators and projections directly.

This is staging authority only. It does not contact a provider, operate a source adapter, reconcile an opaque reference, infer inventory, value stock, calculate a material outcome, or change an estimate, price, job, material plan, movement, balance, purchase, vendor record, cost or business policy.

## Slice B acceptance boundary

Disposable PostgreSQL coverage must apply the full migration chain through `106`, exercise all four record types through the mounted API, and verify current consent pins, deterministic replay, higher-version correction, conflict rejection, detail-free tombstones, revocation, non-revival after re-grant, tenant isolation, source non-mutation, immutable history, least privilege and exact migration checksum registration.

Provider identities, credentials and calls; job/material/vendor/location reconciliation; quantity, consumption and waste outcomes; cost, availability and purchasing outcomes; calibration; lifecycle cleanup; and Learning Center work remain mandatory Slices C-H. No rendered, production or deployment evidence is claimed here.
