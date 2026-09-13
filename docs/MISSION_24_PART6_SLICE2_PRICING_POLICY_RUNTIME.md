# Mission24 Part6 Slice2 — Pricing Policies

This change implements the second of the three approved Part6 slices. It adds an optional immutable pricing policy to the selected estimate and a specific saved pricing proposal. It neither changes the charge nor approves a price. Slice3 retains full commercial approval, taxes, fees, discounts, overrides and the approved onboarding-tax preparation architecture.

## Calculation and interpretation

`estimate-pricing-policy-v1` uses exact cents. The cost basis is complete selected direct costs plus incremental overhead from the saved pricing receipt. Gross and already-included overhead remain visible. Unknown applicable costs or unresolved overlap stay unknown. Additional contingency is an owner-declared fixed amount or percentage of that basis; it requires explicit additional-only coverage review. The declaration is not proof of expense separation or risk probability.

Percentage allowance rounds half-up to cents once. The markup threshold is `ceil(cost × (1 + markup))`; the target-margin threshold is `ceil(cost / (1 − margin))`, both in cents. A fixed minimum is the maximum of the calculated threshold and floor, never another surcharge. Markup supports 0–1000.00%; target margin supports 0–99.99%, rejecting100% even at zero cost. No compound markup-plus-margin method or currency conversion exists. Overflow rejects.

Achieved percentages are signed exact-rational comparisons displayed to four decimal places. Signed ties round away from zero in both JS and SQL; negative zero is displayed as zero. Rounded values carry an approximate indicator. Markup at zero costs and margin at zero price are undefined, not0%. Partial known minimum comparisons do not establish complete cost coverage. No result is described as net profit.

## Current applicability and privacy

The policy binds the selected estimate/component pins, exact saved pricing receipt and current human-decision write basis. A pricing revision, withdrawal, selected-cost change or decision change makes the saved policy stale. Its history remains immutable, but the current policy comparison is suppressed until explicit policy review. Existing same-revision CAPELLA direct-cost comparison continues independently; numerical agreement is never policy-bound human approval.

Published company sources are filtered through existing current authority and sensitivity projection. Revoked or inaccessible source-dependent history is redacted on reads; immutable private storage is preserved. Historical source assessments retain their saved date; current cautions use server UTC. Unknown dates are allowed and stated. Exact replay requires current actor/session authority and returns only receipt identity, not private historical input. New policy saves use a full normalized-body demo digest and the established paid travel fence. No ordinary GET introduces a fence write.

## Interfaces and persistence

Paid `/api/v1/canonical/estimates/:estimateId/pricing-policy-preview` and `/pricing-policies` use the same contract as isolated demo counterparts. Existing review supplies `pricingPolicies` and a separate `pricingPolicyCheck`. The customer drawer has a native Pricing Policy disclosure; supporting cost/rate rows expand separately. CAPELLA and the local saved-cost query consume that same authorized projection. No provider generation, tax lookup, invoice, payment, reservation or automatic send occurs.

Additive072 creates `canonical_pricing_policy_plans`, protected source/read/mutate entries, immutable history/FKs and `pricing_policy` demo admission. All69 existing SQL files remain unchanged. Existing071 helper semantics are reused without replacing old routines. The new runtime grant pass withholds direct ledger/helper access and follows the existing pricing authority pass.

## Recovery and verification boundary

`pricingPolicyWritePolicy.js` is the source-controlled policy-only pause. The combined candidate additionally pauses pricing, human decisions and all material/cost adoption preview/write/replay paths. Authorized histories stay readable. Replay rejection is outcome-neutral: refresh saved history; it does not claim an earlier uncertain write failed. Forward resume preserves exact historical keys and new deliberate revisions. Prepared and actually executed builds must be distinguished in the sealed evidence.

New072 existing demo CHECK revalidation, referenced-table locks, startup caps and unknown production writers/sizes require separate release readiness and disposition. Online backup precedes any justified maintenance; previous release actions and recovery acceptance are not reusable authorization. Local populated migration/rollback/forward checks do not establish physical restoration, external-provider or private-production evidence.

Focused test sources accompany this implementation for exact JS/SQL arithmetic, current authority/privacy, existing and absent-fence all-version adoption interleavings, actual pricing-versus-policy contention, paid/demo forms and failures, and populated pause/forward recovery. Final handoff records execution identities and retained exploratory failures; this document alone is not a claim that every check has run or that deployment is approved.

## Historical demo retry compatibility

Released pricing-plan, travel-plan and equipment-readiness outer digests and storage remain unchanged. Their historical shortcut now requires an exact normalized-body digest in the matching immutable receipt. Different or missing/malformed evidence returns actionable conflict guidance instead of an unsupported replay success. Exact historical retries still work after later revisions; current pause and expiry checks remain in force. The focused compatibility fixture explicitly labels injected pause dependencies separately from actual source-controlled recovery builds.

