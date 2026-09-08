# Two P2 presentation corrections — writer handoff

## Validation assessment: share with caveats for exact-head re-review

This correction addresses only the two findings in the terminal independent review of `2f0fa29da1bd5f35670448054cf9e047b7f047ba`, tree `41b790c84c8233259ad8bc3f0122f88eee1ffafd`. Controlling review: `C:/Users/joshv/Documents/Codex/2026-09-07/founder-pay-review-evidence/2f0fa29/REVIEW.md`, SHA256 `31b64af6d1572c158c6c9fad3dc01828205d61a732d269eb1fc5a731130dccb8`. Its complete manifest and the founder clarification were read; original review and prior writer artifacts remain unchanged.

## P2-1: missing authority is not a zero investor projection

Monthly owner-money cards now derive presentation availability from the existing row flag. Forecast receipts are explicitly **Unavailable / unconfigured** when policy, tax or historical earnings authority is missing. The accompanying cash-scenario sentence states that unavailable forecast periods assume no additional withdrawals; this is not a configured investor-return projection.

Annual owner disclosures read the same monthly records and separately label recorded ACTUAL receipts and FORECAST receipts. A mixed year with recorded $100 and unavailable forecasts shows recorded $100, unavailable forecasts and an unavailable combined investor total. An actual-only year retains recorded $100 without inventing a forecast line. A genuinely configured permissible zero remains $0. Any displayed founder/non-investor withdrawal share is explicitly assumed.

The annual disclosure uses narrowly scoped wrapping and top-aligned annual cells so these labels are readable on mobile instead of being clipped by inherited table nowrap styling. No figures are suppressed; the existing optional annual table retains its horizontal table wrapper.

## P2-2: collapsed rows expose company-wide withdrawals

The existing company-cash cell now includes a separate **Additional withdrawals (company-wide)** line. It displays the existing total distribution pool when available, an unavailable/unconfigured status for missing forecast authority, and an unknown actual-total status for unsupplied historical splits. No founder share is attributed in the collapsed line. The overview's $9,900 share remains explicitly assumed.

The hypothetical payout fixture visibly separates founder compensation $3,500 from company-wide withdrawals $10,000. Operating result stays $233,972 after founder compensation; bank cash stays $1,208,972. The cash identity remains $985,000 opening + $298,000 collections − $64,028 operating costs − $10,000 distributions = $1,208,972. The same pool is not deducted again and is not moved into operating expenses.

## Verification and exact scope

- **7/7 focused tests:** unchanged source guards plus six monthly/annual presentation fixtures: default, configured-but-tax-unavailable, configured permissible zero, $10,000 payout, actual $100 receipts with unknown founder/payroll allocation, and actual-only annual $100 receipts. All fixtures still produce 120 rows and reconcile cash.
- **8/8 existing route/source tests:** current fingerprint manifest only; route boundaries, CSP, no external asset/network dependencies and seven-column120-month source contract remain intact.
- **146 browser assertions:** six fixtures at 1440×1000 and 390×844. Tests read visible owner/annual/row text, require collapsed rows to remain collapsed, operate save/reload, download CSVs, check seven columns/all 120 months, absence of page/main-table overflow, unbroken withdrawal currency and wrapping annual disclosures. Zero runtime errors and zero HTTP(S) requests.
- **Exact preservation:** the complete financial engine script, embedded worker, header/image markup and annual CSV function are byte-identical to the reviewed base. Therefore this patch does not modify compensation,400 all-in defaults, infrastructure overlap, cash/tax/distribution calculations, stored inputs or financial exports. Existing broad numerical/worker/binding campaigns are historical at2f0fa29, not claimed rerun here.
- Test-first execution reproduced the erroneous default/tax-unavailable0 display before correction: six presentation cases failed and the engine-preservation guard passed. Final focused cases pass.
- Writer personally inspected regenerated desktop/mobile payout and default rows, default/actual owner cards, and mixed annual disclosure screenshots. The first annual render exposed inherited nowrap clipping; the narrow disclosure wrap/top-alignment correction and rendered-width regression resolved it.

Final tested LF HTML SHA256: `85311027a281dd4c20612ad643f3e73dfc7c361b7f715ccbd9e1026e1e23d5e2`.

Reproduce from the isolated checkout with:

1. `node tests/ratification/founder-pay-p2-sync.cjs` — fingerprint refresh, requiring unchanged engine/worker.
2. `node tests/ratification/founder-pay-p2-verify.cjs` — focused and route checks only.
3. `node tests/browser/founder-pay-p2.cjs` — the two-viewport correction campaign.
4. `node tests/ratification/founder-pay-p2-seal.cjs` — verify and hash this new evidence package.

Receipts: `focused-results.json`, `verification-results.json`, `browser-results.json`, focused/route logs, four downloaded payout CSVs and26 screenshots. Prior screenshots in the independent review provide sealed before evidence; they were not overwritten. `evidence-manifest.json` records source/test/report and generated-artifact hashes. The final Git head/tree is supplied with the terminal handoff and external freeze seal.

## Limits and stopping point

No new numerical forecast validation, financial advice, invoice/tax/legal verification, physical Safari/device testing or production acceptance is claimed. The $400 budget and $100 overlap reference remain provisional; founder pay is before personal taxes; withdrawals are still unconfigured by default. These are writer checks, not an independent approval or founder visual verdict.

No push, PR, merge, deployment, provider, production, payment, legal-document or Mission23 action occurred. Same local branch, additive correction commit only. Root must return the exact frozen head to the same independent reviewer. Mission23 Part8 retains the first shared release slot; this correction grants no release authority.

The validation skill guided the known-versus-unknown distinction, same-record annual reconciliation and rendered-meaning checks. No broader policy was inferred.
