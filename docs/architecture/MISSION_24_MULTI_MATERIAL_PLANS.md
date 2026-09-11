# Mission24 Part2 Slice4: whole material plans

This package extends the existing immutable material-plan and estimate-revision ledgers with explicit v2 contracts. It preserves all v1 saved inputs, history, calculation and replay semantics. Part2 remains seven planned slices; Slice3 is closed. Owner Operations demo delivery is separately assigned after Part2 acceptance and before Part3, outside this package.

A v2 plan holds1–20 ordered lines with stable internal line IDs, material description, quantity, unit, waste allowance, price per unit, human source note/type and optional date. Currency is shared. Existing12 unambiguous units remain; there is no automatic coverage or currency conversion. The server computes each waste-inclusive quantity using existing v1 rules, rounds each line's cost to cents, then sums those cents once. Zero price is supported; missing/invalid values and aggregate overflow are rejected. Size limits still apply even below20lines.

The entire saved plan replaces the material-cost component of one new estimate revision. It is not added to the old material allowance. The existing unique plan-to-estimate-revision association prevents duplicate adoption. Original job, appointment, pricing, tax and snapshots remain unchanged; each new selected estimate needs fresh human scope/price review. CAPELLA uses the selected direct cost, including v2, and still does not claim complete profit. Later source edits or withdrawal do not rewrite adopted history.

Current owner/admin, subscription/session/CSRF, source/plan/globaldecision pins and SERIALIZABLE/idempotency semantics remain. New v1 writes cannot replace or withdraw an existing v2 whole plan; exact already-recorded v1 replay remains a historical receipt and never changes current state. Explicit legacy edit creates a new v2 draft for calculation and consent. Paid/demo share calculator/projector/form and isolated demo persistence; no new demo operation or private endpoint access.

## Recovery and release

Additive061 widens version CHECKs on canonical_material_plans and canonical_estimate_revisions and replaces protected version-aware mutation functions. All58 previously applied SQL identities remain unchanged. CHECK revalidation takes ACCESS EXCLUSIVE on both existing ledgers. Startup has tighter-of-inherited5s lock/20s statement bounds over the complete migration transaction. No new table, backfill, demo CHECK, provider or authority expansion.

A pre061 application cannot truthfully read v2 histories after use. Recovery must retain candidate v1/v2 readers while material/adoption mutations are disabled, optionally human decisions disabled too. Exact prepared builds must be exercised on populated histories, including replay rejection and forward resume. Physical restore remains a separate unavailable evidence boundary, not proved by application pause. New061 production disposition requires concrete post-audit source/topology/lock/backup-cutoff assessment; no prior one-shot migration authorization is inherited.

## Acceptance and ownership

The sealed writer/auditor packet supplies exact source hashes and actual unit/API/browser/populated upgrade, bounded timeout and pause/forward evidence. Source notes/date here are human declarations, not verified supplier prices or stock. Slice5 owns sources/freshness, Slice6 availability/alternatives, Slice7 downstream integration/Part2 exit; official customer quote remains Part8. No complete Part2 claim.
