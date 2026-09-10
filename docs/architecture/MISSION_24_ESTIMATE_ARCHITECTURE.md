# Mission24 Phase1 estimate architecture and compatibility contract

Status: documentation contract proposal, reconciled against released `29c4ce9f9438141a0113f73f457693c6a105d2b0`. No executable contract, migration, endpoint, UI or calculation changes are included. The [roadmap](../roadmap/MISSION_24_ESTIMATING.md) and [consumer inventory](MISSION_24_ESTIMATE_CONSUMERS.md) distinguish existing behavior from required future work.

## Existing guarantees and limits

The persistent graph writer in [canonicalGraphService](../../src/services/canonicalGraphService.js) calculates once and stores the estimate and Polaris snapshot in its graph operation. [Migration004](../../migrations/004_canonical_persistence_v2.sql) defines immutable estimate/snapshot rows and tenant/operation/graph relationships. Migrations005 and007 add profile authority and tax constraints. [canonicalPolarisCalculation](../../src/services/canonicalPolarisCalculation.js) currently identifies its calculation as `m19-part3-canonical-v2`. [canonicalPolaris](../../src/routes/canonicalPolaris.js) reads persisted values and checks snapshot agreement; browser adapters select/render those values rather than authoring a second price.

These are source-reviewed properties, not new mounted test results. Existing `customer_price` / `customerFacingPrice` are computed output fields. Their names do not prove an estimator inspected a site, approved scope, approved price or authorized customer disclosure. Existing scheduling approvals are not commercial quote approvals. Current risk flags/confidence likewise do not establish the complete Capella Risk Lens. No complete human quote-revision lifecycle is claimed by this package.

## Proposed logical contract

Names below describe responsibilities, not final tables, fields or endpoint names. Implementers must reconcile actual storage/API design in a later bounded package instead of treating this document as permission for a parallel store.

| Responsibility | Required invariant | Existing foundation / remaining work |
| --- | --- | --- |
| Estimate identity | One tenant-scoped estimate lineage, linked to its existing graph/opportunity, with immutable calculation revisions. All derived outputs identify the exact revision they used. | Existing estimate/graph/snapshot identity; future commercial revisions and version transitions require explicit design. |
| Input provenance | Preserve normalized input fingerprint, profile version/hash, calculation version, source identities/effective dates, units, scope, applicability and evidence status. | Existing graph/profile/fact pins; richer inventory/equipment/travel/cost evidence remains future work. |
| Private Polaris advice | Explain calculated advice, alternatives, missing inputs and assumptions to currently authorized business users. Never silently approve or send a price. | Existing persisted projections and constrained assistant context; complete estimate workflow not yet delivered. |
| Private Capella Risk Lens | Use the same estimate revision/input pins as Polaris; show scenario deltas, sensitivity, break-even/margin-floor conflicts, downside, missing/stale evidence and mitigations. Private costs/margins are legitimate internal content for authorized users. | Recovered requirement, not currently implemented as a complete Risk Lens. A scenario is a labeled variation of the base with recorded assumptions, not a competing authoritative estimate. |
| Human scope/price decision | Explicit current authorization, exact reviewed revision, editable scope/price, attribution and consequences. Changed inputs cannot silently inherit prior approval. | Future contract; do not reinterpret an existing calculated price or scheduling approval as this decision. |
| Customer quote projection | Explicit allowed commercial content from the approved human decision, company-approved identity/logo/terms and selected disclosure preferences; preview before release. | Future composition. No automatic access to private costs, margin, Risk Lens analysis, internal evidence, identifiers or diagnostics. |
| Downstream lineage | Preserve approved quote reference and later actual/change links without claiming invoice/payment/learning delivery. | Existing operational reference handoffs expressly do not authorize consumption; obtain the required current authority and consent in the actual future consumer. |

Permissions must follow current tenant and individual role policy, not broad UI labels. Owner/administrator/estimator wording does not invent a new role or grant; an employee, dispatcher or customer must not gain financial access through a graph reference, chat card, export or cached projection. Shared public equipment knowledge must remain distinct from tenant asset condition, costs and maintenance. Re-check access and source freshness at consequential actions. A stale preview cannot approve a changed revision. Idempotency, conflict semantics and revision transitions require explicit implementation tests later; they are not guarantees created by this document.

## Compatibility requirements

1. Preserve existing raw migration identities, stored estimates, snapshot digests and historical calculation versions. No backfill or rewrite is authorized here. New revisions must not mutate old facts to make projections agree.
2. Inventory every caller before changing a shape. Existing graph, compatibility, command-center, assistant, demo and legacy adapters must keep their documented meanings or receive an explicit versioned migration plan. A browser cache cannot become price authority.
3. Preserve absent/null/zero distinctions, money currency/rounding, physical units, tax-not-calculated reasons and incomplete evidence. Do not equate a materials cost map with inventory quantity or an equipment pricing reference with an asset identity.
4. Existing configured material lookup is service key + colon + lower-case material, including an empty material suffix. Legacy nonblank saved map references remain preservable even when not used by a calculation. UI editing must not silently drop them or turn absent cost into zero.
5. Preserve profile cost/pricing siblings and existing supported pricing shapes. Multi-industry policies must become versioned inputs to one engine, not invented defaults for unsupported industries.
6. Actual origin/destination, routing mode/source/date and known distance/time must remain distinguishable from illustrative travel. No live map/provider integration or exact accuracy guarantee follows from planning authority.
7. Existing [operational intelligence](../operations/POLARIS_OPERATIONAL_INTELLIGENCE.md) and [handoff consent](../operations/DOWNSTREAM_HANDOFFS.md) remain controlling. A reviewed reference is not copied evidence, current access or downstream consumption consent.
8. Demo-shaped estimates and the public homepage calculation remain explicitly synthetic. Shared presentation or calculator code does not prove every demo value uses the production persistent graph.

## Worked acceptance examples for later implementation

These are contract examples, not executed runtime fixtures or product forecasts.

| Example | Required result |
| --- | --- |
| Base estimate revision R1 has $1,000 internal cost and authorized human price $1,400. Scenario adds $200 labor. | Same R1/input provenance; base gross margin is $400 (28.57% of price), adverse margin $200 (14.29%); downside $200. Explicitly state which other costs/tax are excluded. No claimed probability and no automatic change to approved price. |
| Owner changes quoted price to $1,500 after reviewing R1; later material evidence creates R2. | Human price decision stays attributable to R1. R2 requires renewed review under the eventual conflict contract; old quote is not silently overwritten. |
| Authorized owner requests Risk Lens through chat. | Internal card can show applicable private cost/margin analysis, with the same revision as Polaris. This does not authorize customer disclosure, sending or charging. |
| Owner previews a customer quote from an approved decision. | Show approved scope/price and permitted commercial details/branding. Exclude private margin/downside/input diagnostics by default. Any deliberate optional cost disclosure requires explicit preview and appropriate authorization. |
| Material map contains `mowing:` = 0, `legacy-reference` = 17, while another cost is absent. | Preserve valid zero and the saved legacy reference; an absent relevant cost remains unknown. No whole-map replacement merely because a reference is not recognized by the current calculator. |
| Travel provider unavailable or equipment maintenance evidence stale. | Explain missing/stale evidence and required human confirmation. No fabricated distance, readiness, cost or confidence. |
| Existing completion handoff is selected for Mission24. | Its internal reference consent alone remains insufficient for consumption; current source access and the separately applicable consent must be established. |

## Wording and evidence gates

This package changes documentation only, so it introduces no rendered UI state. This is a delta-specific disposition, not a claim that every existing screen is free of technical language. The consumer inventory maps actual downstream display sinks; later implementation must cover each changed page/card/form/dialog and loading, empty, denied, validation, error, help, tooltip and accessible-label state, including role, mobile and light/dark variants. Detailed diagnostics belong internally; user text must remain actionable and preserve legitimate permission/action consequences.

Architecture acceptance requires source-linked ownership, compatibility and authority review plus exact diff/source provenance. Runtime adoption requires meaningful mounted acceptance and independently reviewed evidence appropriate to the actual changes. Arithmetic consistency alone does not prove market credibility, routing correctness, equipment productivity or quote approval. Release, provider readiness, production evidence and founder visual verdict remain separate gates.

