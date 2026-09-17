# Mission 25 Part 11 Slice A acceptance candidate

This candidate starts from independently accepted Part 10 head `8f6af4c2a3654d2e1b9a1e2246d35b6933838cad` and implements only native planned-versus-used material outcomes.

## Source-controlled acceptance

- Migration `105_canonical_native_material_outcomes.sql` stores separate immutable consent and observation history.
- One exact adopted multi-line material plan and one explicitly selected current completed execution form the comparison basis.
- Explicit owner-supplied line and item bindings require exact set equality and reject duplicate or ambiguous item coverage.
- Only accepted consumption and waste establish recorded use, and only when units already match. Other current movements remain pinned as provenance.
- Estimate, revision, plan, execution, completion, bindings and complete matching movement evidence are pinned by immutable identifiers, revisions and digests.
- Changes to plan adoption, completion or movement evidence stale and mask saved advice.
- Revocation hides records; re-granting starts a new consent period without reviving them.
- Guarded owner and administrator entry functions are mounted while storage and basis helpers remain unavailable to runtime.

## Executed evidence

- Fresh disposable PostgreSQL 17.10 applied migration chain `001` through `105` for every mounted API database.
- The Slice A mounted API passed six end-to-end controls covering explicit consent, owner-only mutation, exact set equality, unit mismatch, accepted consumption and waste, excluded adjustment quantities, deterministic replay/concurrency, source non-mutation, stale masking, renewed observation, revocation, non-revival, tenant isolation, immutability, least privilege and exact migration checksum registration.
- Seven focused contract and ratification suites passed 141 checks across Mission 23 material rules, Mission 24 material plans/adoption, accepted Part 10 native equipment authority and this Slice A.
- The mounted Mission 24 cost-composition PostgreSQL regression passed all eight paid/demo component cases against the `001`–`105` chain.
- The accepted Part 10 native equipment mounted regression passed all six cases against the `001`–`105` chain.

The historical Mission 23 Part 4 ratification remains stale at this accepted base: it still expects its original writer-candidate roadmap wording. Its focused old integration fixture also enters source functions that the later accepted runtime ACL intentionally withholds. Neither file changed in Slice A. Current material behavior is covered by the 141 passing focused checks and the mounted Slice A/Mission 24 paths above; these historical failures are disclosed rather than reclassified as passing.

## Boundaries

Slice A adds no external source, provider credential, fuzzy match, unit or currency conversion, stock inference, vendor or purchasing fact, cost or availability observation, calibration, cleanup operation or frontend. It cannot change estimates, prices, jobs, material movements, inventory balances, purchases, vendors or business policy.

Production migration/application, deployment, private production data, provider state, physical-device evidence, manual assistive-technology review and founder visual approval are unavailable and are not treated as passing. Independent exact-head acceptance remains required before release.
