# Mission 25 Part 14A acceptance evidence

Canonical title: **Complete paid-tenant source-to-observation-to-calibration-to-adoption journey.**

Immutable base: `8db556abfeec3af9d8eb4244da5822e3eea0c3e2`

Migration `132_canonical_paid_learning_calibration_lineage.sql` closes the final causal link in the paid-company path. When selected job summaries contain imported labor evidence, proposal generation now requires one fresh current imported-labor calibration whose exact observation set equals the selected cohort. The proposal manifest pins its proposal, permission, sample and calculation identities and derives labor advice from that calibration. Native-labor proposals retain their accepted path. Missing, mixed, ambiguous, stale, corrected, removed, revoked or replacement-period calibration evidence fails closed.

The mounted journey checks five equal-weight current job samples, deterministic median and quartiles, exact current replay and another tenant's empty read. Proposal generation fails before calibration exists. After calibration, the proposal pins the exact calibration and reaches owner adoption and rollback. Correction, tombstone, calibration revocation and a later permission period make the proposal, registry and adopted source lineage unavailable for new use; regrant does not revive the earlier calibration.

The non-mutation oracle records the count and a stable SHA-256 digest for every tenant row in the authoritative customer and estimate-plan, schedule, job and execution, asset, imported-source, external-financial and provider-state tables before preview. It compares the exact snapshot after preview, registry save, adoption, later adoption and rollback. Native invoice, payment and collection tables remain explicitly unavailable until Mission 27.

Evidence completed on a fresh disposable PostgreSQL 17 cluster:

- Fresh migrations 001-132 and the complete paid-tenant mounted journey passed: one suite and two tests.
- Exact candidate journey plus Part 14A ratification passed: two suites and six tests.
- The exact Part 13A-H API and ratification file set passed: 16 suites and 53 tests. This scope includes all eight API files, including the two-test Part 13G lifecycle journey, and all eight ratification files.
- That exact 16-file Part 13 set plus the four-test Part 14A ratification passed: 17 suites and 57 tests.
- The five-job imported labor calibration produced the deterministic `1.2500` median, `1.2000` lower quartile, `1.3000` upper quartile and advisory `1.2500` multiplier. Exact replay returned the saved current result; another tenant received no current calibration.
- Source correction, tombstone, permission revocation, a later permission period, stale proposal and registry replay, explicit adoption, rollback, tenant and role controls passed in the same mounted production route journey.
- JavaScript syntax and `git diff --check` passed.

The compatibility command enumerated the sorted files matched by `tests/api/m25-part13*.test.js` and `tests/ratification/m25-part13*.test.js` and ran those exact 16 files with Jest `--runInBand --silent`. The 17-suite command used that same expanded file list and added only `tests/ratification/m25-part14a-paid-journey.test.js`. The focused candidate command ran only `tests/api/m25-part13g-lifecycle-propagation.test.js` and the Part 14A ratification file.

No rendered application path changes in Slice A. Existing API messages used by the journey remain plain business language. The resettable fictional demo, mission-wide recovery and migration proof, bounds and performance, full responsive and accessibility review, independent audit, merge, deployment, production health and founder visual verdict remain the separately serialized Slices B-G.

No provider, credential, private-production, push, pull-request, merge or deployment action was performed. Physical devices, physical Safari, manual assistive-technology review and the founder's visual verdict remain unavailable and separate.
