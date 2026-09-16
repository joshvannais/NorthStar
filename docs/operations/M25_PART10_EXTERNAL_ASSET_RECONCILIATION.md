# Mission 25 Part 10 — reviewed external vehicle and equipment reconciliation

## Slice C authority

Migration `098_canonical_external_asset_reconciliation.sql` and the guarded `matches` routes add explicit owner-reviewed job, vehicle and equipment reference reconciliation for one currently consented external source. The system lists opaque typed references and eligible same-tenant targets. It never selects or guesses a target from names, manufacturers, models or similar text.

Every link pins the current source consent, a complete manifest of the current active imported record versions carrying that typed reference, and the current target basis. Job targets are canonical estimates. Vehicle and equipment targets must be active, have the matching category, and match a current reviewed canonical asset version. Their target basis also pins the current equipment-operation ledger revision and digest when one exists.

Links and unlinks append immutable revisions. Source corrections and tombstones, consent changes, target removal, asset category/version/review changes and equipment-ledger changes make prior links stale. Revocation hides references and eligible targets and blocks writes. Exact idempotent replay returns its original receipt; changing a request under the same key conflicts.

## Non-mutation and wording boundary

Reconciliation is lineage only. It does not create a Mission 23 event, calculate a utilization or cost outcome, assign imported costs, or change a job, estimate, schedule, vehicle, equipment record, allocation or policy. Slice D observations remain unimplemented.

This package adds API routes and no HTML, CSS or browser renderer. API errors use plain business language for invalid review details, permission restrictions, changed evidence or targets, request-key conflict and temporary unavailability. The future Learning Center experience still requires the standing wording, focus, keyboard, mobile, theme and founder visual-review gates.

Disposable PostgreSQL evidence must apply the complete migration chain through `098`; link and unlink all three reference kinds; verify exact consent, source-manifest and target pins; exercise source correction, tombstone, consent revocation, asset-version or ledger staleness, wrong-category and cross-tenant rejection, replay and key conflict; prove immutable storage and entry-only runtime privileges; and verify the exact migration checksum. Hosted CI, production migration/application, live provider state, provider credentials, private production data, physical devices and founder visual approval remain unavailable.
