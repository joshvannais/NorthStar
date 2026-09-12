# Mission 24 Part 4 Slice 2 — Equipment Costs

Part 4 has three approved slices. Slice 1 records equipment identity, configuration and job requirements. This slice adds declared equipment costs and explicit estimate adoption. Slice 3 still owns availability, condition, maintenance, alternatives and scheduling integration. No provider, purchase, payment or customer quote is introduced.

## Authority and scope

This implements the accepted `m24-equipment-cost-contract-ea235f1/IMPLEMENTATION_CONTRACT.md` (SHA256 `f756e22cef915c7fcf85502102bd33d9b5ba53f3c9136abaf2003738f2a85097`) and its source map, reconciled against released `ea235f17e614b8a32815fce0ebd30eef49af9109`. The root implementation disposition clarifies the rental minimum sentence: **billed quantity below a known minimum rejects; a minimum below billed quantity is valid**. This does not revise historical source documents.

Related contracts: [Equipment Plans](EQUIPMENT_PLANS.md), [cost composition](../operations/MISSION_24_COST_COMPOSITION.md), [estimate consumers](../architecture/MISSION_24_ESTIMATE_CONSUMERS.md), [canonical architecture](../architecture/MISSION_24_ESTIMATE_ARCHITECTURE.md).

## Saved plan and exact arithmetic

`estimate-equipment-cost-plan-v1` is a separate immutable plan, with one cost line per saved Equipment Plan item, up to 12 items. It binds the exact Equipment Plan ID, revision, digest and original estimate source pins, plus current estimate and global human-decision pins. Twenty cost-history events are allowed per estimate. Saving/revising/withdrawing costs never rewrites the original estimate, equipment review, appointment or job.

Each item declares its access basis and one method:

* Rental: explicit Hour, Day, Week, Month or Job quantity and rate. Job quantity is one. A stated minimum is compared in exactly the same unit. A missing minimum remains a source caution; no automatic billing-unit conversion occurs.
* Economic recovery: declared period cost pool divided by usable equipment hours in the same Month or Year, multiplied by planned job equipment hours.
* Financing cash allocation: the same allocation arithmetic, explicitly classified as financing cash, not depreciation or a tax deduction. Capital recovery and debt service cannot both be charged.
* Not applicable: an explicit reason and zero cost, with incompatible values rejected.

The period pool declares included cost categories; separate period costs, operating rates and job fees cannot charge the same category again. Operating costs are either one all-in rate or separate fuel/energy, consumables and maintenance rates. Each rate is known, not applicable/already included, or unknown. Up to four nonrefundable equipment-only job fees are supported. Operator labor, travel/delivery, tax, overhead and refundable deposits do not become equipment fees.

A mixed quoted charge records equipment/operator/travel/overhead shares whose exact sum must equal the quoted total. Only its equipment share enters equipment arithmetic. Nonzero operator/travel shares require an explanation and explicit declaration against the selected labor/original travel basis, or remain unaccounted/unknown. This is a human declaration, not proof of equivalent costs or market pricing. Overhead remains outside direct costs.

USD/CAD/EUR money is bounded to 12 whole digits and two decimals; nonnegative quantities/hours have at most nine whole digits and six decimals. Missing, zero and not applicable are distinct. Calculations use integer rational cents within each line, round half-up once per line, then sum rounded lines. SQL validates the same rational bounds. An incomplete line has an unavailable total and a separately labelled known subtotal; an incomplete plan cannot be adopted. Examples: 12,000 / 600 hours × 8 hours = 160.00; 6,000 / 600 × 8 = 80.00; rental 3 days × 10.00 = 30.00; 1 billed day with a 2-day minimum rejects. An unknown pool, rate or hours is never silently zero.

## Sources and review

Sources are human-recorded My Estimate, Company Reference or Quoted/Published Reference. They carry the declared issuer/reference, assumptions, effective/end dates and applicable area. My Estimate is usable with no invented date/reference. Missing dates/end dates/area, future dates, expired end dates and missing rental minimums are explicit review cautions, requiring acknowledgment and a useful assumption explanation. They do not imply supplier verification, ownership, safe use, certification, stock or availability.

The preview/save uses one server UTC day. Source assessment is checked again before commit, including the transaction-midnight boundary. Saved assessment/history remains immutable; current-date cautions are a separate projection. Historical exact replay preserves its original assessment after current actor/session authorization and does not reprice it.

An earlier same-job Equipment Plan may support a new cost review only while its identity, line/configuration association and currently authorized sources remain unchanged. The user deliberately reviews it again in a new cost plan pinned to the current estimate. Current source checks use the existing protected source fence before the repeatable-read/serializable snapshot. Private publication withdrawal/filtering and current membership remain authoritative; no source content is made public by this feature.

## Three-component estimate composition

`estimate-cost-adoption-v2` records material, labor and equipment references as original or exact saved plan references, including the Equipment Plan basis for equipment costs. Applying a whole cost plan replaces that component; it does not add to original costs. Changing material or labor retains the exact earlier equipment cost plan, not whichever plan was most recently edited. All original material versions and `estimate-cost-adoption-v1` history/calculation remain supported. New v1 writes cannot replace a current v2 revision; authenticated historical replay remains supported.

A retained equipment bundle may reference an earlier labor plan for operator coverage. Replacing labor does not rewrite that immutable declaration or force a circular adoption workflow: equipment arithmetic/history is retained, its coverage becomes unresolved, and the combined direct-cost total is unavailable until a new equipment cost review explicitly pins the current labor basis. Newly applying equipment always checks current outside-cost coverage. Original travel remains original; no new travel cost is invented.

Complete applicable totals contain material, labor, equipment and original travel exactly once. Unknown applicable costs keep the total unavailable. Original price and tax remain historical, and machine gross/net profit is never relabelled as a human-price result. Each child requires renewed selected-revision human scope/price review; CAPELLA compares only that approved matching-currency price with a complete recorded direct-cost total.

## Actual consumers and presentation

The shared paid/demo customer drawer adds a compact Equipment Costs disclosure inside Equipment Plan. Current and historical cost methods, rates, coverage, sources and dates are readable. The selected estimate has its own Included Equipment Cost Basis disclosure, preserved after later plan edits or withdrawal. Forms preserve useful entries, require a fresh preview/confirmation after known rejection, keep an exact request for genuinely uncertain saves, and use outcome-neutral pause wording.

Paid and isolated demo preview/save/adoption use the same calculators, projections and UI. Demo history is separate and cannot confer paid authority. Current owner/admin, tenant, session expiry, CSRF, source pins and replay rules remain required. New demo entry still creates no cost history or fictional paid evidence.

The saved-material review/local Polaris query projection now includes selected equipment costs and latest saved cost information with their distinct roles; CAPELLA accepts v2 selected revisions. General provider protocols/prompts are unchanged. Command Center, Calendar, standalone lead and other original-summary consumers remain explicitly original-source views under the prior consumer inventory; this slice does not imply global latest-revision economics there.

## Migration, startup and recovery

Additive `068_canonical_equipment_costs.sql` creates the cost ledger, protected helpers/read/write functions and grants; extends the demo operation CHECK with `equipment_cost`; adds the equipment FK/reference to the existing estimate revision ledger; and extends version/component checks, uniqueness and reader/mutator wrappers. All 65 applied SQL files are byte-preserved. Legacy helpers remain protected and runtime roles have no direct ledger or helper access.

Existing ledger ALTER/CHECK/FK/index work can block on readers/writers. Startup applies the tighter of inherited settings and 5-second lock/20-second statement limits, starting before advisory acquisition and restoring transaction settings on commit/rollback. A timeout must roll back the complete migration. Exact apply-once and zero-op startup are required. No new production migration, maintenance, backup or deployment authority is implied by local validation.

Compatible recovery changes only `equipmentCostPlanPolicy.mutationsEnabled` and `materialAdoptionPolicy.mutationsEnabled` to false; combined recovery also disables `decisionPolicy`. These builds retain all cost/revision/decision reads and reject new mutations/replays with outcome-neutral messages. Forward resume appends new revisions without deleting history. The previous released reader is incompatible after v2 equipment histories; do not roll back to it or drop ledger/history. Physical restoration, external production writer/lock inventory and post-backup cutoff coverage are separate release evidence, not established by disposable rehearsals.

## Acceptance and limits

Focused tests cover rational arithmetic/rounding/minimum/zero/missing/overflow, six component orders, paid/demo continuation and original v1 replay, retained history and renewed human decisions, current sources/roles/CSRF/expiry, concurrent saves, real rendered methods/keyboard/mobile/themes, fresh demo navigation and private-endpoint isolation. Populated upgrade, ordinary revision/demo table contention, advisory/statement timeouts, full rollback, apply-once/zero-op and actual compatible paused reads/forward resume are separately recorded against exact source commits in the writer handoff.

Development failures are retained and identified; a corrected assertion does not relabel the original run as passing. Local Chromium/WebKit is not physical-device Safari, production data, supplier/provider evidence or founder visual approval. Part 4 and full estimating intelligence remain open after this slice.
