# Part 7 current-evidence identity correction

Writer candidate only; fresh independent exact-head re-audit is required.
The independent audit of `5d6db61b70c92a2cafb87a6a6afe8389bffb72e5` found
P0=0, P1=0, P2=0, P3=1. Its sealed report SHA-256 is
`230ec609213cd6231a439e2a0f506c1575984f82298110f0a8e5f2271df2fe53`.
That report was read completely and its hash verified before this correction.

## Reproduction and bounded correction

The current requirement map still named the rejected migration byte count,
although the canonical Part 7 document linked it as current evidence. A new
ratification check reproduced the mismatch before documentation edits: expected
raw Git-blob byte count `55557` was absent from the current ledger.

The current map now explicitly carries the corrected path, 55,557 raw bytes,
Git blob `55b527c2dc8a31514e3398489ed1bcc0811e1b47`, and SHA-256
`c87210731112f7da7df2f955eadbe7fa6e66c16d80c732441c2ee1688dbc189a`.
The canonical document links directly to the current migration receipt and
labels the rejected receipt historical. The map likewise distinguishes current
runtime verification from the historical rejected-candidate test ledger. Its
release row now requires fresh audit without implying that earlier audits never
occurred. No runtime behavior or migration byte changed.

## Current reference inventory

- `docs/operations/PROGRESS_ISSUE_FACTS.md` links the current migration receipt
  and current requirement map; its old-identity link is explicitly historical.
- `REQUIREMENT_TO_EVIDENCE.md` carries the exact current identity and links
  `PROFILE_ROTATION_MIGRATION.md` as current migration/recovery evidence.
- `PROFILE_ROTATION_MIGRATION.md` and `PROFILE_ROTATION_VERIFICATION.md` already
  carry the same correct identity; both are unchanged.
- The inspector source-seal unit test and migration ratification seal already
  carry the correct identity; their existing seal assertions are unchanged.
- `MIGRATION_IDENTITY.md` retains its rejected-candidate banner and old seal.
  `FINAL_CLOSEOUT.md` retains its explicit historical frozen-head provenance
  and old seal. These genuinely historical receipts are unchanged.
- `TEST_RESULTS.md`, `WRITER_LEDGER.md`, unavailable evidence, exclusion lists,
  and all earlier raw reports remain unchanged. Searches found no remaining
  rejected identity in a current migration statement; historical receipts and
  the regression's rejection pattern intentionally retain it.

The new regression derives byte count/blob/SHA from raw `git cat-file` bytes,
checks all three current identity documents, resolves their current local links,
checks the historical banner, and verifies six existing receipts remain
byte-identical to the audited head. It does not contact a database or provider.

## Proportionate verification and non-overwritten reports

```text
node --check tests/ratification/m23-part7-progress-authority.test.js
node outputs/m23-part7-writer/run-tests.js evidence-identity-red --runTestsByPath tests/ratification/m23-part7-progress-authority.test.js --testNamePattern="current evidence references"
node outputs/m23-part7-writer/run-tests.js evidence-identity-green --runTestsByPath tests/ratification/m23-part7-progress-authority.test.js tests/unit/production-migration-history-inspector.test.js tests/unit/m23-part7-progress.test.js tests/ratification/m23-part1-operations-contract.test.js
git diff --check
```

Syntax and diff checks passed. Red: **1 failed / 6 untargeted**, 3.214 seconds.
Green: **68/68 passed**, four suites, no skips/failures, 16.315 seconds.

| Report | Bytes | SHA-256 |
| --- | --- | --- |
| `evidence-identity-red-results.json` | 25631 | `34b8a17221bd965295811f124729a3dfbf6cb1d8b60a23adade94808d7f6d147` |
| `evidence-identity-green-results.json` | 32253 | `d58ea06b48063a959ccc3544c1e01c2decf4360fafc439a921f2e201e542cd23` |

Red is committed with this single additive correction; green raw output is
retained locally. The final exact-head repeat and ref/PR readback are sealed in
the separate terminal handoff without a second repository commit.

## Scope, cleanup and unavailable evidence

Only the current map, canonical evidence links, one static regression, and this
new evidence package change. All application source, migrations (including 048
and all 45 released files), UI, dependencies, workflow/configuration, prior
receipts, exclusions and unavailable-evidence statements are unchanged.

No database, server or provider was started, and no production/private data,
Railway, credentials, external provider or storage was accessed. Runtime,
PostgreSQL and broad suites were not rerun for this documentation/static-test
patch; their prior exact-head receipts remain historical evidence, not new
runs. No cleanup deletion was necessary. Existing checkout/dependencies and
non-overwritten reports are retained.

Hosted CI, physical devices/Safari, assistive-technology sessions, founder visual
approval, providers/private production, legal/professional approvals and
backup/restore remain unavailable, not passing. Recovery remains separately
reviewed forward fix only. No merge, deploy, history rewrite, competing branch,
new PR or self-audit is authorized by this writer receipt.
