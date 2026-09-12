# Mission24 Part3 Slice2 — Composed Estimate Costs

Implementation package for the second of the two planned Labor Intelligence slices. Independent acceptance and release remain separate gates.

## Authority and behavior
The released Slice1 labor-plan ledger is a human declaration of on-site tasks and costs. This slice adds deliberate adoption, not payroll, supplier verification, scheduling or quote output. See [Labor Plans](MISSION_24_LABOR_PLANS.md), [Material Adoption](MISSION_24_MATERIAL_ADOPTION.md) and the [consumer inventory](../architecture/MISSION_24_ESTIMATE_CONSUMERS.md).

`estimate-cost-adoption-v1` uses the existing estimate revision chain. An owner/admin selects one currently saved material or labor plan, previews its replacement and retained costs, then explicitly confirms. The new child carries the parent's other included component by immutable ID/revision/digest/source pins. It never substitutes a newer unadopted plan. Both orders work; later plan editing/withdrawal leaves included history intact. Same-plan reapplication is rejected; a deliberately resaved plan can be reviewed against the new current estimate.

R1 and material-adoption-v1–v4 projections and receipt digests are preserved. Legacy exact-key replay remains valid after current authorization. A legacy new append after composition is rejected, preventing an old client from silently discarding labor. New children have no inherited human scope/price approval; selected-review approval and global write basis remain separate.

## Exact cost contract
Materials use the existing versioned whole-plan calculation. Labor uses all three released time bases and two rate modes. The selected replacement replaces original costs, never adds to them. A labor plan with missing hourly cost or burden remains saved/readable but cannot be adopted. A complete zero cost is valid.

Untouched original components retain the original snapshot's applicability and bounded cent-representable amounts. Unknown applicability or missing applicable equipment/travel cost keeps the direct total unavailable. Inactive components are not summed. No string coercion, fractional-cent rounding of original amounts, fabricated missing values, new duration or second original calculation is introduced. Existing task/line rounding occurs in the existing shared calculators before exact cent summation; combined overflow is rejected.

Worked example: original M500 + L800 + E100 + T6 = 1406. Apply M600 → 1506; apply L960 → 1666; apply M700 → 1766; apply L1000 → 1806. Applying L960 first yields 1566, then M600 yields the same 1666. With price1500, a new matching human decision yields a 166 shortfall against1666, not a profit forecast. Unknown applicable equipment keeps that comparison unavailable.

Original price, tax and overhead remain historical; no automatic repricing or tax computation. CAPELLA compares only the selected complete direct costs with matching renewed human price. Equipment/travel intelligence and market/productivity evidence remain later authorized work.

## Read/write and source contracts
- Owner/admin preview: `POST /api/v1/canonical/estimates/:estimateId/cost-adoption-preview` within the protected read snapshot, current plan/parent/global decision basis and database UTC source assessment.
- Owner/admin save: `POST .../cost-adoptions`, same serializable protected estimate revision entry as legacy adoption. Current actor/session/tenant/subscription and CSRF are checked before replay, including after waits. Current parent/component/replacement/global decision pins are checked before append. Source-date assessment is rechecked before the transaction completes.
- Current selected review exposes both included immutable plans, component references and composed costs. Current unadopted plans/history remain distinct. Current date cautions do not rewrite saved assessments.
- Demo routes mirror these contracts through the existing isolated `estimate_adopt` family, same calculators/projector/UI. Current session/expiry/replay and workspace revision remain mandatory. No reset, historical retrofit, provider call, paid impersonation or second job/appointment graph.
- Unknown save outcomes retain the identical key/body/demo revision for retry. Known paused responses say to refresh saved history without claiming the earlier attempt was not saved. Known stale/current-state failures invalidate confirmation. Ordinary errors suppress internal diagnostics.

## Rendered surfaces
The shared customer drawer offers Material/Labor plan application, preview before/after and retained cost facts, source cautions, unchecked confirmation, Cancel/focus, selected history and renewed scope/price review. Included labor sources stay discoverable after later plan changes. Original material basis remains truthful when labor is adopted first. Existing separate CAPELLA and the compact Labor/Material disclosures remain.

Polaris Saved Cost Review and local saved-labor/material questions use the authorized selected review, with included labor cost/worker-hours and separate later saved plans. No provider intent enum, context payload, entitlement or generation protocol changes. Plain-language labels, mobile/theme interaction, freshness/missing states and final navigation are acceptance gates; no raw component IDs or backend version labels in ordinary UI.

## Migration and recovery
066 is additive; all63 prior SQL blobs remain unchanged. It adds nullable labor/component columns to the existing revision ledger, a labor FK and version-conditional constraints, replaces the legacy global material uniqueness with partial legacy uniqueness and component/parent uniqueness, and replaces version-dispatch readers/writers. Existing legacy column values/projections remain exact; whole `to_jsonb(new_row)` naturally gains nullable columns and must not be called byte-identical.

Existing-ledger ALTER/CHECK/FK/index operations require locks/revalidation. Startup applies tighter-of-inherited5s lock/20s per-statement limits before migration advisory acquisition through commit/rollback. Unknown production sizes, external writers, lock contention, online backup cutoff, automatic coverage and physical restoration remain release-readiness evidence requirements, not local test claims.

A candidate-compatible source-controlled adoption pause preserves new composed reads and blocks writes. Combined pause also disables material/labor/decision writes. Old pre-composition readers are incompatible after new children; do not roll back to them or delete history. Actual populated upgrade, apply-once/zero-op, lock/statement rollback, final pause reads and forward resume must be sealed with exact source provenance before release review. Application pause is not physical restoration or complete writer quiescence.

## Acceptance ownership
The package exercises both adoption orders, multi-material plans, all labor bases/rate modes, zero/missing/overflow, legacy projections/replay, retained lineage, source/date and current-authority conflicts, renewed comparison and shared demo entry. Actual Chrome/WebKit desktop/mobile/theme/error/keyboard checks and populated recovery accompany the immutable handoff. Physical Safari/devices, private production and provider evidence remain unavailable. No Part3 acceptance is preclaimed by this document.
