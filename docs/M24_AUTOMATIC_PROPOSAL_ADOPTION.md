# Prepared estimate review and save

Package 3 adds an explicit final review to the existing source-bound Prepared Estimate. An owner or administrator can keep adopted components or replace selected material, labor, equipment and travel plans, review cost inclusion, and save one composed estimate. Pricing and optional policy are recalculated against that child. Human price approval and sending remain separate. Incomplete costs are not treated as zero.

The paid path uses one SERIALIZABLE transaction and one client. Existing validators save each selected replacement, then one v3 prepared child and one immutable aggregate receipt. The original estimate and historical records remain intact. Full normalized request digests protect exact replay. Current source, actor, expiry, decision and component pins are checked before and after waits; a conflict does not automatically retry. The demo uses the same calculations and an isolated candidate-state copy followed by one existing session write.

Migration 076 adds one ledger, two existing CHECK amendments, two protected entries and three private helpers. All 73 predecessor SQL files and package identities remain unchanged. The private recipe interpreter only accepts the existing bounded typed language and current published company evidence. No new external source, provider, tax, assignment or customer-send authority is introduced.

## Implementation decisions

- Retained components use the adopted manifest, not an unrelated later unadopted plan. Equipment costs match stable line IDs.
- Reviewed overhead references to new labor lines are resolved to the actual new receipt before validation; no guessed historical identity is stored.
- Retained travel preserves its old evidence. Its current resource eligibility is rechecked independently; adoption-created resource inventories do not rewrite historical evidence.
- Required outside-cost allocations remain incomplete until explicitly supplied. Structured overlaps conserve the amounts in both JavaScript and SQL.
- The review presents component costs, subtotal, additional overhead and total first. Nonzero included amounts and gross calculation details remain in a secondary disclosure.
- An uncertain save preserves its exact key, body and original demo revision across reload. Known rejections invalidate the review. A concurrent identical request can receive a serialization conflict; a later deliberate exact retry replays the single committed receipt.

## Verification and recovery

Focused disposable tests exercise paid/demo saves, retained and replaced components, nonzero overlap, policy and included overhead, original/child pins, separate human approval, full-body replay, lost responses, write-boundary and precommit rollback, expiry after waits, and actual scheduling, equipment-condition, travel and v1/v2/v3 revision interleavings. Browser checks cover Chrome and WebKit, light/dark, 390/1440 layouts, actual save, known conflict, delayed responses, Edit/Cancel, focus and final navigation.

Populated recovery runs execute the predecessor reader and manual pricing writer against new histories, current aggregate-only and combined pause builds, and forward resume. Combined pause covers pricing, policy, decisions and ordinary cost adoption preview/write/replay as well as aggregate adoption. Lock and statement timeout tests roll back DDL and then apply forward. Recovery source identities and retained earlier failures are recorded in the separate sealed evidence packet; do not substitute old runs for a changed candidate.

Production table sizes, external writers, locks and physical restore are unobserved. Migration 076 requires its own finite release disposition. Prefer a compatible current-source pause and forward recovery; no destructive down migration is authorized. Local node_modules is a dependency junction, not a clean install. Physical Safari/devices, authenticated production, provider canaries and founder visual approval remain separate evidence boundaries.
