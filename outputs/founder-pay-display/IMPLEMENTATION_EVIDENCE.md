# Founder pay separation and all-in overhead correction

## Validation report — share with caveats for independent review

Question: can a reader distinguish business cost, gross founder compensation, additional owner distributions and company cash without changing approved compensation math or rewriting saved/actual facts?

Source: self-contained `public/unlisted/investor-forecast.html`, compared with the exact Git blob at main `fc2251d5e5b1118fa7fa94f740158328f1bdf243`. Scope is USD, 120 monthly forecast/actual records and 10 annual aggregates; dates and calendar conventions are unchanged. The controlling new founder decisions are in `FOUNDER-CLARIFICATION.md`. This implementation is not real-world validation or an investor-ready claim. Fresh independent review remains a release gate.

## Methodology and before/after

The completed expense ledger and cash result remain the authority. Additive row fields extract founder pay from the existing founder-compensation ledger entry, subtract it from the existing combined fixed amount to display business fixed costs, and aggregate these same fields annually. Existing `fixedCommittedOperatingCosts`, operating result and founder compensation are not redefined. Additional withdrawals remain below operating result. Combined assumed founder receipts add compensation to the non-investor owner share only, with an explicit all-non-investor-equity assumption. They exclude investor receipts and company bank cash. If withdrawals or actual founder split are unknown, the combined receipts field is null, not an invented zero or payment.

The only authorized numerical change is the NEW $400 combined starting budget and anchored incremental infrastructure convention. The complete prior resolved configurations are rerun unchanged for the old scenarios. Every pre-existing result leaf, all prior monthly and annual CSV cells, and repeated save/reload outputs are compared by exact equality. New-default effects are separately recorded for all 120 months and 10 annual periods in `new-default-before-after.json`, rather than being hidden by an invariance claim.

Selected reset results:

| Measure | Before | After |
|---|---:|---:|
| Zero-activity Month1 burn | $300 | $400 |
| Zero-activity Month1 bank after $15k opening payment | $9,700 | $9,600 |
| Month12 business fixed / founder pay | $400 / $0 | $400 / $0 |
| Month13 business fixed / founder pay | $400 / $3,500 | $400 / $3,500 |
| Month13 revenue | $22,614.25132291385 | unchanged |
| Month13 operating result after founder pay | $14,279.288262336042 | unchanged |
| Month13 bank cash | $103,677.91530727218 | $103,077.91530727218 |
| Month120 bank cash | $44,360,574.14110483 | $44,359,974.14110483 |

The new default adds $100 cost in Months1–6; later gross fixed totals match the old default because the initial infrastructure tier is no longer charged separately. Year1 operating result and every subsequent year-end bank balance are $600 lower. Default revenue and founder pay across all 120 months are unchanged. The large long-range bank projection is conditional on the model's acquisition, retention, costs, capacity and no-additional-withdrawals assumptions; it is not evidence that these outcomes are achievable.

## Requirement-test matrix

| Requirement | Receipt / check |
|---|---|
| Preserve all prior resolved monetary behavior | `numerical-invariance.json`; eight scenarios, 120 rows each, 10 annual rows each, all prior result leaves and prior CSV columns, three reloads per scenario |
| Founder manual0 / manual3500 / milestone3500→6000 / persistence and escalation | `founder-pay-display.cjs`, actual browser inputs and loaded explicit scenarios |
| Founder3500 + other-owner9900; investor100; company pool10000 | Model test and actual owner-money browser render; combined assumed founder receipts13400, not13500 or company bank cash |
| Actual payroll5000 does not prove founder pay | Actual known5300 total remains visible; founder/business split unknown; locked investor100 retained; annual mixed classifications remain qualified |
| New overhead400 and old explicit300 / saved version preserved | `founder-overhead.cjs`; new zero bank9600, explicit same-opening300 bank9700; sparse old saved opening convention retained |
| Incremental tier entry/exit and inflation, no duplicate coverage | Per-row scheduled incremental formula, at most one active automatic tier, fixed100 reference through reloads; declining-customer Month50 incremental412, Month90/120 zero |
| Manual/dated infrastructure remains additional | Explicit75 + dated50 =125 additional infrastructure, total525 business fixed |
| Unknown budget version | Clear failure, original input unchanged |
| Seven columns, 120 rows, visible split and after-pay result | Four Chromium viewport/preference cases, rendered text checks and personally inspected screenshots |
| One engine for exports and worker | Downloaded monthly/annual CSV checks; base64 worker byte parity; actual browser Worker samples match canonical new-budget simulation |
| Hosting and route isolation | Existing eight route/source tests rerun with only current manifest path changed |

Reproduce with `node tests/ratification/founder-pay-display-sync.cjs`, then `node tests/ratification/founder-pay-verify.cjs`. No dependency installation is required. Existing installed Chromium and the established isolated Jest runtime are used. Exact source fingerprints and execution exit codes are in `source-manifest.json` and `verification-results.json`; generated logs provide counts. Earlier PR174 numerical/browser/binding evidence is retained as historical evidence, not claimed rerun here.

Final local execution: 16/16 numerical tests, 8/8 route/source tests, and 26 browser assertions in each of four viewport/preference cases (104 total), all exit0 with no browser errors. The 5,280,112 exact pre-existing result-leaf comparisons passed. Browser tests also check all360 main-row cost amounts stay on one rendered line. Final tested LF HTML SHA256: `3f32de0776c1b23e1216cc4843fc73c54d81c29f51da6d16ba55e1b097eb5725`.

Additional read-only source guards compared the exact base and revision: complete header markup/image bytes and the full `founderCompensation` function are unchanged. Git reports no changed path under either sealed `outputs/investor-revision` or `outputs/unlisted-investor-forecast-monthly-layout-writer`. The writer personally inspected regenerated desktop1440/mobile390 cost rows under light and dark OS preferences, plus overview, expanded and owner-money previews. Currency is no longer split mid-number. These are writer checks, not independent review.

## Test-first and issues found

The initial display regression reproduced missing derivative fields: eight failing cases and one passing original worker check before implementation. The overhead campaign reproduced the old300 default, the separate100 tier and incorrect new-budget total before correction. Two early test harness issues were corrected: sparse saved opening payment semantics were initially expected incorrectly, and the event-array path was corrected to the existing result path. An actual Worker comparison initially decoded UTF-8 base64 as a JavaScript string, corrupting punctuation; the test now passes raw bytes to Blob. Production worker math was not altered to accommodate that harness error.

Visual review found the first desktop split too tall, then caught currency wrapping in a compact combined-total cell. Currency must remain on one line, and the result cell stays scoped to the existing seven-column layout. Light and dark OS-preference previews retain the existing light calculator palette; this task does not introduce a new dark theme. Mobile uses an explicit full-width split cost cell. No header or logo change is made in this correction.

## Required caveats and remaining gates

- The400 budget is a conservative founder planning estimate, not invoice evidence. The100 coverage reference is provisional overlap treatment, not invoice allocation. Additional providers, AI/trial usage, insurance, engineering, later staffing and other missing costs remain unverified.
- Gross founder compensation is not after-tax personal spending money. Discretionary withdrawals are intentionally unconfigured, and company cash assumes none. Distribution rights, tax characterization and sufficiency remain unverified.
- Actual inputs are user-supplied locked facts, not independently verified here; no missing founder split is inferred from aggregate payroll.
- Local Chrome automation and writer screenshot inspection are not physical-device/Safari testing, founder inspection, independent approval or production acceptance.
- No production operations occurred. Root must obtain fresh read-only review of the exact frozen commit before considering release. Prior sealed artifacts and the previous implementation clone remain untouched.

The validation skill guided the separate saved-input reconciliation, explicit unknowns, new-default delta receipt and rendered-output inspection. No additional business policy was inferred from arithmetic.
