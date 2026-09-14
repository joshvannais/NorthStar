# Automatic estimate proposals: Package 1

Package 1 adds protected, ephemeral component calculations and targeted questions. It does not save a plan, combine costs, adopt a revision, approve a price, assign a resource or contact a provider. The grouped editing interface belongs to Package 2; atomic adoption/history belongs to Package 3 under a separate schema decision. Existing manual tools are unchanged.

## Endpoints and authority

POST `/api/v1/canonical/estimates/:estimateId/proposal-preview` uses existing authenticated owner write authority and CSRF checks, both before and after the protected read. All selected-review, recipe, equipment and scheduling loaders share the existing repeatable-read client. POST `/api/demo/command-center/estimates/:estimateId/proposal-preview` uses the isolated demo session and requires same-origin plus `X-NorthStar-Demo-Intent: proposal-preview`. Neither endpoint persists proposals.

The request has exactly `version`, `selectedRevision`, `expectedBasisDigest`, `overrides`, and `candidateIds`. Version is `estimate-proposal-preview-v1`. Initial requests use null revision/basis and empty lists. Subsequent owner assumptions must carry the returned basis digest. Each assumption has `fieldId`, string `value`, explicit `unit`, `sourceKind: owner_assumption`, and a reason. Source, selected component, decision, scheduling or time-window changes invalidate the previous basis. Response expiry is bounded by five-minute windows, session and relevant source deadlines. Refresh means requesting a new current preview, never silently saving or adopting it.

Limits: 128 KiB request, 24 assumptions, 24 selected IDs; recipe 64 KiB, 24 fields, 12 ordered steps, five unique component kinds, 64 component lines total (existing component-specific limits still apply), 12 equipment cost lines and 12 applicability conditions. Resource discovery exposes at most 12 summaries and identifies truncation. A partial knowledge search cannot establish a complete recipe set.

## Recipe and arithmetic

Only a current authorized published company-knowledge projection containing `estimateProposalRecipe` is admitted. `estimate-proposal-recipe-v1` has exact keys: version, id, serviceKey, currency, geography, effectiveOn, reviewBy, fields, steps, components, equipmentCostLines, applicability. Source publication ID/digest and recipe digest are pinned. Units and exact declared area must match; this is not inferred geographic coverage.

Steps are ordered input, constant, sum, product, ratio or ceil operations. Earlier references only; no executable expressions, prose extraction or fuzzy matching. Rational BigInt calculations preserve units and require explicit rounding where a finite decimal cannot represent the result. Existing material, labor, equipment suitability/cost, travel and pricing modules perform the component calculations. Pricing does not reuse original direct cost as the new draft's cost. `completeCost` remains null until explicit cross-component coverage/adoption exists. Saved plans are retained and identified for owner review rather than silently replaced.

## Supported demonstration and missingness

New demo sessions receive one visibly simulated published fence recipe, with explicit cedar applicability, takeoff, productivity and internal rates. It is not a supplier price, learned outcome or universal fence specification. Old sessions are not retrofitted. An owner may explicitly propose cedar when the original recorded material differs; the original stays unchanged. Missing recipes remain provisional.

Tree removal is a source-level missing-information case, not a new demo service seed. Questions cover measured output, usable volume/payload and existing load, destination/legs/unloading/driver absence, tasks/equipment/qualified crew and declared costs. No yield, route, trips, qualifications, availability or rate is invented. Inferred or unresolved original facts require confirmation. Current shared scheduling evaluators assess known times; absent times remain unknown. No candidate summary is an assignment or reservation.

## Verification and release boundaries

Focused unit tests cover exact arithmetic, dimensions, source/decision staleness, expiry, saved-plan retention, source applicability, owner assumptions and conservative resource/missingness states. Mounted disposable paid/demo tests cover current scheduling changes, publication retirement, role/tenant/origin/CSRF/body boundaries and unchanged financial history. A real PostgreSQL lock wait proves post-wait expiry rejection and traces one protected client/transaction.

There is no new UI or rendered visual acceptance in this package. No migration, package dependency, provider setting or production mutation is required by the patch. Existing knowledge publishers gain no new permission. Future release readiness must independently assess deployment and new-session demo effects; this document is not release authorization.
