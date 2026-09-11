# Mission 24 — Part 2 — Slice 5: Cost Sources And Freshness

This package adds human-recorded per-material cost evidence to the existing paid and isolated demo material-plan workflow. It does not connect a supplier, validate a supplier quote, fetch a reference, verify stock, or replace a customer price.

## Authority and compatibility

The accepted scope is rooted in the seven-slice Part 2 plan and Slice 4 multi-material contract. Existing Business Profile service/material cost mappings are aggregate job costs, not unit-price evidence. Knowledge record publication and integration catalogue entries do not establish supplier-price authority. No new entitlement or provider is assumed.

`materialSourceContract.js` and migration 062 implement plan-v3 evidence and immutable assessment; adoption-v3 retains the complete selected plan. Existing v1/v2 rows, hashes, replay, arithmetic and historical selections are retained. A stale older version cannot replace a current newer plan. New selected estimates require their own human scope/price decision. Slice 6 owns stock, availability and alternatives; Slice 7 owns broader consumer integration. Neither Part 2 nor the full estimating mission is complete.

## Evidence and dates

Each line records My Cost Estimate, Company Record, Supplier Quote or Published Reference; the reviewer supplies the reference and issuer where applicable. Optional effective/end dates, area and specification remain explicitly unknown when absent. Unit, currency and exact unit-price strings must agree with the line. Structural contradictions cannot be acknowledged away. Duplicate issuer/reference/specification/effective-date evidence with incompatible prices or units is rejected across the complete plan.

My Cost Estimate requires no invented reference or date. Missing dates or area require explicit job-applicability attestation and whole-plan consent, not an exception reason. A future-effective or past-end-date source requires an explicit reason; the caution remains visible. A recorded end date includes that whole UTC date. No arbitrary freshness interval or claim of market credibility is invented.

Server previews return the UTC assessment date and source digest. Paid writes use the database clock before and after inserting; demo source writes use that clock after the session lock and before commit. A changed date requires a fresh save preview. Adoption rechecks classifications: a new day with identical classifications remains usable, but newly expired evidence requires another explicit plan review. Current read cautions are computed separately from saved immutable assessments; reading never rewrites history. Exact historical replay remains historical after date changes, subject to current session/role checks.

## Shared presentation and privacy

Paid and demo use the same compact, initially collapsed Cost Source fields and result renderer. Source categories show relevant reference fields. Unknowns, expired dates, rejected saves and paused reads use plain business wording. Source entries are private estimating inputs, not customer-facing quote assertions. No reference URL is fetched and no external file is uploaded. The existing source note and saved review reason remain available.

## Release and recovery

Migration 062 widens CHECK constraints on the existing material-plan and estimate-revision ledgers and replaces only their version-aware helpers/mutators. Both existing ledgers require ACCESS EXCLUSIVE locks and CHECK revalidation. All 59 previously applied SQL files remain unchanged. Startup retains tighter-of-inherited 5-second lock and 20-second per-statement caps around the complete transaction. Production size/lock/writer state has not been inspected in this implementation.

A pre-v3 application is not a compatible rollback after v3 history exists. Candidate-derived material/adoption pause and combined decision pause preserve v1/v2/v3 reads; source-controlled policy changes disable mutations without dropping history. Populated upgrade, pause and forward-resume evidence must identify the actual tested commits. Physical restoration, production backup integrity and post-cutoff coverage are not established by local application recovery. Root must review concrete new 062 operational risks after independent audit; this package authorizes no production action.

## Verification scope

Focused tests cover exact arithmetic and source binding, SQL/JavaScript assessment agreement, roles/tenants, legacy replay/downgrade protection, inclusive expiry and controlled transaction-midnight rollback, paid/demo real browser forms and history, source-field consent invalidation, populated upgrade and actual paused readers, forward resume and bounded startup contention. Controlled error/clock fixtures are identified separately from ordinary interactions. Chrome and Playwright WebKit do not prove physical Safari or device coverage. No new external-provider evidence is claimed.
