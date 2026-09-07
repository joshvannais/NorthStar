# Actual-history review corrections

Review boundary: fresh independent review of `f14906687b2c45398073e5c195d90fd0569f4b22` returned NEEDS REVISION. Its original `2026-09-07/investor-review-evidence` artifacts are unchanged. This is writer implementation evidence, not the independent re-review verdict or an investor-ready claim.

## P1 — explicit cash basis, original facts preserved

Actual cash normalization v1 adds a declared basis to version 3.4.2. `total_bank` includes all restrictions. `legacy_usable_excluding_restricted` adds the configured constant `restrictedFunds` to both beginning and ending balances, never to revenue, financing or cash flows. The original `config.actuals` remain unchanged. Result rows and CSV expose original balances, normalized bank balances, basis, offset, version and provenance.

Known legacy saved versions through 3.4.1 carry the former usable-cash contract and receive a visible versioned migration notice. Save/reload retains the declared basis and raw facts, preventing double conversion. Unversioned histories with a nonzero restriction require an explicit selection. Invalid bases and nonreconciling cash bridges fail clearly. This converter does not support an unknown or changing historical restriction; reconcile those facts before using it. No numerical inference from a coincidentally matching balance grants cash-basis authority.

The review's total-bank example now reconciles $25,000 → $24,700 actual bank → $24,400 forecast bank; the $1,000 restriction gives $23,700 then $23,400 unearmarked cash. A legacy $24,000 → $23,700 input produces the same bank result, retaining both original values. Tax/legal protections remain inside bank cash and are not added by legacy conversion. Configured protections carried through history are explicitly labeled planning amounts, not verified liabilities; aggregate other outflows do not imply earmark release. Explicit future dated tax/legal payments release matching protections once.

## P2 — known actual costs and receipts are not missing facts

Actual rows carry a two-entry aggregate ledger (provider cost plus OPEX), with known total cost and an explicitly unknown variable/fixed split. Payroll remains an included memo component, not an extra ledger charge. Actual rows, overview, detail, annual mixed-period totals and CSV all distinguish locked user-entered history from forecast expected quantities. Unknown headcount/productivity are not represented as founder-only/no-payroll staffing. Other actual cash outflows stay a known aggregate; tax/capex/other-owner components are not invented. Locked investor receipts remain visible even when missing historical earnings authority blocks future distribution projection.

Mixed annual periods retain all operating costs, separate classified subtotals and unclassified actual amounts, and do not invent all-owner distributions from the investor receipt. All-actual/mixed status is exported.

## Bounded presentation polish

The default opening bridge now has three labeled lines: funding $25,000, forecast prelaunch attorney payment $15,000, opening Month1 bank $10,000. Proposed terms and the nearby forecast/not-quote caveat remain separate; secondary valuation/opening assumptions use a disclosure. Warning summaries retain acquisition, payout, tax, contingency and missing-cost/capacity warnings, with full limitations expandable. Existing header markup and styling remain unchanged by this correction.

## Verification and limitations

Final focused suite count is14: an edge-case regression also ensures an explicit change to total-bank basis replaces any stale legacy-conversion notice. All seven verification jobs were rerun afterward on the final source. The original51 numerical tests,57 receipts and904 checked forecast rows are unchanged in count.

Final serial verification:7/7 jobs exit0 on unchanged HTML SHA256 `ced7943c914c1f4c28f4c21d2bb27fd1d464047012866df7bf2ff74bbd96477b`. Browser assertions:2,544 original plus44 actual-history meaning checks; no recorded runtime errors/external requests in the original four cases. Bindings:276 controls,271 accepted and5 expected visible rejects. Route:8 tests. Maximum independent forecast differences: operating1.863e-9, cash5.961e-8, customers2.183e-11, owners0, ledger9.314e-10. Writer inspected regenerated desktop/mobile opening and actual detail/payroll previews. Header markup is byte-identical to f149066; the six added CSS rules are scoped only to dealSummary, assumptionWarnings and actualCashNotice. All35 artifacts listed in the original independent review manifest retain their original SHA256 hashes (0 mismatches).

Tests-first: nine focused assertions failed against the reviewed source; the startup bank/loss control passed. The initial control assertion was corrected to inspect the signed earnings balance rather than its zero-clamped distributable-earnings field before implementation. Fourteen focused numerical tests now cover bases, migration, raw history, protections/payments, actual costs/payroll/receipts and startup eligibility. `actual-before-after.json` recomputes three examples from the exact old Git blob and current production engine. `actual-browser-results.json` includes actual rendered text and 44 meaning assertions across 1440px desktop and 390px mobile. The main immutable-source runner also reruns all original numerical/worker/export, route, binding and four viewport/preference browser checks; its final counts and hashes are in `verification-results.json` and the associated logs.

Unresolved: actual staffing schedules and historical earnings/provision authority are still not provided. No tax rates, legal rights, employment facts, external price quotes or future sufficient-funding guarantee were invented. Recorded actual values are user-entered, not independently verified. Physical Safari/devices, provider/private-production evidence and founder visual inspection are not claimed. Root owns same-reviewer exact-head re-verification and any conditional serialized release; this writer does not push or deploy.
