# Part 7 test results and red/green ledger

Writer evidence only. Final runtime/test verification head:
`de86290426a8d30af7e7b05d4a0943f69a0c5c63`,
tree `9877b8e2e46e80bcf216d7b5817195b7d1eb041a`.
The later closeout commit adds only Markdown evidence, not runtime, migrations,
test code, dependencies, or configuration.

## Final results

- Focused Part 7, inspector and root ratification: **106/106 passed**, six suites.
- Complete retained Mission 23 Parts 2–6 inventory on the frozen head:
  **333/333 passed**, seventeen suites, zero skips or failures.
- Final four-worker broad available run: **200 suites / 6,735 tests passed**,
  **one suite / one test timed out**, and **two suites / 50 tests remained
  explicitly excluded/unavailable**. This run took 512.085 seconds and is not
  relabelled as an all-green run.
- The exact sole failing suite, `tests/api/account-authority-gates-postgres.test.js`,
  then passed **11/11** alone on the same frozen head, with unchanged application
  code and unchanged test timeout, in 304.866 seconds overall.
- The broad timeout was the existing fresh-production-construction matrix at
  its explicit 300,000 ms per-test limit. It also passed in the earlier serial
  inventory. The isolated result supports an execution-load explanation; it
  does not erase the parallel timeout or establish hosted CI readiness.
- Frozen migration 048 fresh/upgrade/interruption/retry/zero-op, separate-role
  authority and mounted inspector checks passed. Inspector reconciliation was
  **46 source / 46 applied, zero mismatches, duplicates, missing or pending** on
  disposable loopback PostgreSQL only.

## Red and correction chronology

Original tests-first commit `b43cae09f65bce3887673965daacdf11e20de052`
retains absent-module/route/table red evidence before implementation:
two failed suites and ten failed mounted assertions. See RED_EVIDENCE.md and
the tracked red-results.json; nothing has overwritten them.

The first two implementation runs retained the new runtime table-DML exclusion
failure (42 passed / 10 failed), then the session fixture's incorrect revocation
column/required reason (51 passed / 1 failed). The following focused runs passed
76, 77, 81, then 84 checks as coverage grew.

Three supplemental inherited-vocabulary cases first failed with an untyped
exception. The own-key allowlist correction returns typed 400 errors. Its
tracked contract-edge-red report remains reproducible evidence, and all three
cases pass in the final unit and broad runs.

The exploratory serial broad inventory passed 6,731 tests but failed five
historical roadmap-status assertions still expecting Part 5 candidate and
Parts 6–12 unimplemented. These were updated to the verified supplied Parts
5/6 release facts, Part 7 writer candidate, and Parts 8–12 unimplemented.
The six-suite retained ratification rerun passed 60/60. No historical release
receipt content or released migration seal was rewritten. The exploratory run
spanned the final supplemental test/error-classification work and is not
claimed as the immutable-head gate; the later frozen broad run is.

## Reproduction

Environment: Node.js 24.18.1, PostgreSQL 18.4, UTF-8, UTC, checksums on,
loopback `127.0.0.1:55483`, separate non-superuser owner/runtime roles.
No providers or private production were contacted.

Use the checked-in `run-tests.js` with a fresh result tag; existing report names
are refused. It supplies only an explicit synthetic environment and a guarded
loopback database identity. The test-process Git LF override affects no user or
repository configuration file.

- Focused: `node outputs/m23-part7-writer/run-tests.js <tag> --runTestsByPath tests/unit/m23-part7-progress.test.js tests/integration/m23-part7-progress-postgres.test.js tests/integration/m23-part7-progress-migration.test.js tests/ratification/m23-part7-progress-authority.test.js tests/unit/production-migration-history-inspector.test.js tests/ratification/m23-part1-operations-contract.test.js`
- Broad serial: `node outputs/m23-part7-writer/run-tests.js <tag> --available`
- Broad four isolated workers: `node outputs/m23-part7-writer/run-tests.js <tag> --available-4`
- Isolated account retry: `node outputs/m23-part7-writer/run-tests.js <tag> --runTestsByPath tests/api/account-authority-gates-postgres.test.js`

The broad runner uses exactly the unchanged 50-name list at
`outputs/m23-part5-writer/availability-exclusions.json`, SHA-256
`9c54b500ae26393df526296892c30263702c4e341d4fb296cc09ab7bbc6bb2a3`.
There is no path/suite exclusion. The historical 046 and 047 lifecycle tests
now bound their upgrade directories to their own target migration, so both
are exercised rather than omitted.

## Non-overwriting raw report ledger

Suite counts are passed/failed. Test counts are passed/failed/not-run in that
particular invocation; the 43 not-run cases in the targeted supplemental red
are selection scope, not added unavailability. Later raw JSON stays ignored
and local; the original and supplemental red reports are tracked. All raw
reports are retained, including failed runs.

| Report | Suites P/F | Tests P/F/not-run |
| --- | --- | --- |
| `broad-1-results.json` | 196/5 | 6731/5/50 |
| `contract-edge-red-results.json` | 0/1 | 0/3/43 |
| `focused-4-results.json` | 3/0 | 77/0/0 |
| `focused-5-results.json` | 3/0 | 81/0/0 |
| `focused-6-results.json` | 3/0 | 84/0/0 |
| `focused-final-results.json` | 6/0 | 106/0/0 |
| `frozen-broad-results.json` | 200/1 | 6735/1/50 |
| `green-attempt-1.json` | 1/1 | 42/10/0 |
| `green-attempt-2.json` | 1/1 | 51/1/0 |
| `green-attempt-3.json` | 3/0 | 76/0/0 |
| `isolated-account-results.json` | 1/0 | 11/0/0 |
| `ratification-final-results.json` | 6/0 | 60/0/0 |
| `red-results.json` | 0/2 | 0/10/0 |
| `retained-1-results.json` | 1/0 | 67/0/0 |

| Report | Bytes | SHA-256 |
| --- | --- | --- |
| `broad-1-results.json` | 4499638 | `af9f23869fbc52693bd84518361d91859a371800a18134cf5cb399704f3bf936` |
| `contract-edge-red-results.json` | 35308 | `38cd815c130d6f62b509453454185471425fbc6c9e1157904691a3ff27945ec0` |
| `focused-4-results.json` | 37498 | `b7860d4624bec3d521a1e0bc19fc13aa0d82f7ec4d0654ed677837f0ba404337` |
| `focused-5-results.json` | 39562 | `d7ca90eded475aa2f844c4eb60a4bc1701adcef955bc79d262ad8c3483892656` |
| `focused-6-results.json` | 41236 | `347a6b3dfe68bf7cc0877c96484b5ca083aede58e0af05a2c2c49a3bcb58eabd` |
| `focused-final-results.json` | 52609 | `5095aef1eabc55f64fa03711d047b59c95d343649243da210b9be81e768b8f4c` |
| `frozen-broad-results.json` | 3539853 | `75c3eab128b3ec11b8c85f9f5a9b2385f1ee3c26797901e7f1052f65787f3a48` |
| `green-attempt-1.json` | 50259 | `4d957e262b8b2ce023678e5bed764978c6c4e3a1213d60a4f244ed93f10deca7` |
| `green-attempt-2.json` | 26583 | `bf2305d3e8b628aee05e5dd7719ead890c98f60249897b299a0dda3948ca91b3` |
| `green-attempt-3.json` | 37003 | `961df76aeeed9fb8f2d98be3aa321818a8c96a99f4987dea333787cc46bb586a` |
| `isolated-account-results.json` | 6594 | `b75f536c5c2fe5090be41520a8b64e8386a67a4911d25d4ccba83d7e67ae29ae` |
| `ratification-final-results.json` | 32300 | `67c9761a9eff4b6078b97d131871cbef9966543dcdc96882152a1200ee0f64b8` |
| `red-results.json` | 39307 | `a23c62e56303c3fcfa584c045d953f4a26d032057a95121c84c8ff238147c49c` |
| `retained-1-results.json` | 37193 | `9b4d052d4932eb4ecd02395e3b039e4f0dfb22c7e50fc65267f4fbf3b58f6657` |

Syntax checks and `git diff --check` passed. No rendered UI changed; browser,
physical-device, assistive-technology, founder visual, provider and production
evidence are not inferred from these results. See UNAVAILABLE_EVIDENCE.md.
