# Part 7 profile-rotation correction — writer verification

Outcome: fixed in the local writer candidate; **not independently accepted or
released**. Existing draft PR #171 and branch
`review/m23-part7-progress-issues` only. No competing writer, branch, or PR.

## Immutable provenance and ordered verification

Rejected audited candidate: `252b3606c67ea7434c9c8dcc67d369f6a313b252`.
Released main/base: `6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9`.
Audit verdict SHA-256:
`35f7c41010e20051d2558d3f2ec628bce963eeca6d810e1a703756a3631da5dc`;
audit reproduction log SHA-256:
`d14181b4bca162af1744876d6b0794154cbd5864e91583e824ffc6a795f22c47`.
Both supplied files were read and their exact hashes verified.

Tests-first correction commit:
`f3d6961769ecc0b19452e0e83ba2cd2cb6b5a454`.
Frozen runtime/test correction head:
`ec9c5a99c6b269b2ff413b373e8ab6849255c7f9`;
tree `390918191113d77d0ef0b0eab971194c1d95a320`.
All final focused, retained, broad, and isolated checks ran on this clean,
full-history WSL checkout without further runtime/test edits. The subsequent
closeout commit adds only this Markdown evidence receipt.

The fix-finding workflow used one fresh read-only root-cause investigator and
one fresh read-only candidate checker. The writer independently traced the same
boundary. The checker identified no concrete surviving bypass or introduced
regression; it did not execute mutation tests or issue a release-audit verdict.
Its WSL Node syntax check was unavailable, while the writer's Windows Node
syntax checks passed. These helpers do not replace the fresh independent
exact-head release audit required after writer terminal.

1. Syntax and diff checks passed before focused verification.
2. Original trigger: six new cases first failed HTTP 201 vs 403 using ordinary
   production Business Profile version rotation and mounted signed-cookie HTTP.
   Three legitimate/contract controls passed. The red report is committed and
   not overwritten.
3. Trigger green: all nine selected tests passed, with 86 untargeted cases.
   Historical-zone-inconsistent resolution instants, future/before-original
   times, forged/missing evidence, stale source pins, wrong performers, tenant
   mismatch, replacement authority fields, and revoked sessions remain denied.
4. Complete frozen focused run: **115/115**, six suites, zero skips/failures,
   95.576 seconds. Complete retained Parts 2–6: **333/333**, seventeen suites,
   zero skips/failures, 59.887 seconds.
5. Broad four-worker inventory: **6,744 passed / 1 timeout / 50 excluded**,
   200 passed suites / 1 failed / 2 skipped, 498.765 seconds. This is not an
   all-green broad run. The sole timeout is the unchanged account fresh
   production-construction matrix at its existing 300,000 ms per-test bound.
   The same timeout occurred in the prior writer and independent audit.
6. The unchanged sole failing account suite then passed **11/11 alone** on the
   same frozen head, zero skips/failures, 291.188 seconds overall. No account
   code, timeout, or exclusion was changed. The isolated pass supports a
   load-sensitive timeout explanation; it does not erase the broad failure.

The initial five-suite correction run passed 106 tests but used an incorrect
root-ratification filename. It is retained as partial evidence only; the later
explicit `--runTestsByPath` six-suite frozen run includes the correct Part 1 root
contract. No excluded case or intermediate failure is relabelled as passing.

## Requirement-to-evidence mapping

| Correction requirement | Source and evidence |
| --- | --- |
| Normal profile rotation must not strand existing facts | Production `putBusinessProfile` creates/retire versions with unchanged UTC and changed America/New_York zones; owner and own-worker reviews cover all four fact kinds |
| Blocker/exception lifecycle without artificial correction | Both kinds transition investigating → awaiting follow-up → resolved → owner-reviewed → open → resolved; exact seven-row action history contains no `correct` revision |
| Historical provenance stays immutable | Exact predecessor profile ID/version/hash/tenant/timezone and original document/digest remain unchanged; resolution retains historical-zone semantics, including subsequent review |
| Current authority remains fail closed | Existing actor/session/subscription/onboarding/assignment/crew/dispatch/execution/transcript regression matrix passes; rotation tests additionally deny revoked replay, wrong performer/tenant/source pins and stale predecessor |
| New/full facts still require current profile | Retired-pin roots, progress updates, and corrections are denied; a valid new fact using current profile and matching offset succeeds |
| Mode cannot be forged | JS and SQL exact document keys reject replacement provenance; runtime cannot execute helper with false/null modes; historical mode is selected only after server predecessor checks |
| Exact replay and append-only effects | Original and lifecycle receipts replay exactly after supersession; seven lifecycle events, audits, and receipts remain complete; retained concurrency/audit-failure/2,000-revision/pagination checks pass |
| Fresh/upgrade/runner/least privilege | Corrected 048 installs fresh; supported 45-file upgrade interrupts after DDL, rolls back schema and ledger, applies once, reruns zero-op; inspector reconciles 46/46 with zero mismatch/pending; separate nonprivileged roles and withheld helpers pass |
| Scope and source protection | Ratification preserves all 45 released migration bytes, no UI/provider/dependency/workflow/configuration changes, and no Part 8+ or commercial/execution/scheduling authority |

The root cause was one shared helper applying active-profile status to both new
observations and server-inherited historical documents. The narrow correction
adds an internal fail-closed boolean (default true), selected false only for
`review` and `issue_state` after exact predecessor validation. All other tuple,
timestamp, evidence, current actor/work, immutable history, and replay checks
remain in place. No client contract or existing source-authority implementation
was changed.

## Exact migration and diff seals

Path: `migrations/048_canonical_progress_issue_change_facts.sql`.
Git blob `55b527c2dc8a31514e3398489ed1bcc0811e1b47`;
55,557 raw Git-blob bytes; LF only.
SHA-256 `c87210731112f7da7df2f955eadbe7fa6e66c16d80c732441c2ee1688dbc189a`.
Verified using binary `git cat-file blob HEAD:path`, not a text pipeline.
The historical rejected-candidate seal remains preserved separately.
048 is unreleased: no released migration was modified. A database with the
rejected 048 checksum is not an authorized upgrade target; never rewrite its
ledger or bypass the runner's checksum reconciliation.

At frozen runtime head, binary correction diff from rejected 252b3606:
95,228 bytes, SHA-256
`d1c4cb6715406955b1a8dd371be31268d2d639ad16040c9a9f86435e9352f0ef`.
Full Part 7 diff from released main:
354,323 bytes, SHA-256
`b2210dcbda9dabdb2ac11eef51cf7c2e50fbcc578bc6f4d10a2ddcfc52a54b1e`.
These are runtime-head seals, not the later Markdown-only closeout diff.
Only ordinary additive commits were used; no amend, rebase, reset, force push,
merge, squash, deployment, or branch deletion.

## Reproduction commands

Use an unused report tag; the checked-in runner refuses overwrite and supplies
only the explicit synthetic environment. Windows Node 24.18.1; PostgreSQL 18.4,
loopback 127.0.0.1:55483, UTF-8, UTC, checksums on; separate non-superuser
owner/runtime roles. No provider credentials are inherited.

```text
node --check tests/integration/m23-part7-progress-postgres.test.js
node --check tests/unit/m23-part7-progress.test.js
node --check tests/ratification/m23-part7-progress-authority.test.js
node --check tests/unit/production-migration-history-inspector.test.js
git diff --check
node outputs/m23-part7-writer/run-tests.js rotation-frozen-focused --runTestsByPath tests/unit/m23-part7-progress.test.js tests/integration/m23-part7-progress-postgres.test.js tests/integration/m23-part7-progress-migration.test.js tests/ratification/m23-part7-progress-authority.test.js tests/unit/production-migration-history-inspector.test.js tests/ratification/m23-part1-operations-contract.test.js
node outputs/m23-part7-writer/run-tests.js rotation-frozen-retained "m23-part[2-6]-"
node outputs/m23-part7-writer/run-tests.js rotation-frozen-broad --available-4
node outputs/m23-part7-writer/run-tests.js rotation-isolated-account --runTestsByPath tests/api/account-authority-gates-postgres.test.js
```

Exactly the existing 50-name exclusion list remains unchanged:
`outputs/m23-part5-writer/availability-exclusions.json`, SHA-256
`9c54b500ae26393df526296892c30263702c4e341d4fb296cc09ab7bbc6bb2a3`.
No new suite/path exclusion or timeout increase was added. Original and
supplemental pre-implementation Part 7 red artifacts also remain unchanged.

## Non-overwritten correction report ledger

Counts are passed / failed / untargeted-or-excluded. Raw red is tracked; later
raw JSON remains retained locally and ignored, with exact seals below.

| Report | Counts | Bytes | SHA-256 |
| --- | --- | --- | --- |
| `rotation-red-results.json` | 3 / 6 / 86 | 64548 | `d23794053d7befbb694aff35f8d74f51f54ecf00209fd7720b2ec715b4da03b9` |
| `rotation-trigger-green-results.json` | 9 / 0 / 86 | 46960 | `10e9903d0f877addc8d32f1f61f20889592c290cc34a560e7727cc5b6d57106c` |
| `rotation-focused-results.json` | 106 / 0 / 0 | 52894 | `c9aecefa3e091296f5cb42bdd1e68a09eeb710d54868642a711d3eb43d129583` |
| `rotation-frozen-focused-results.json` | 115 / 0 / 0 | 57378 | `cbcfae3c565470cad6dabc96ea53590f3260b979d3d18fcc966f604bdce13443` |
| `rotation-frozen-retained-results.json` | 333 / 0 / 0 | 170316 | `3096b8cb3d5ad6d08786235b691eb8c380deb9758f12668e7dde7b8c74dc06c1` |
| `rotation-frozen-broad-results.json` | 6744 / 1 / 50 | 3544644 | `13458c61bdf7fa0bd294ba5f296440fec65fe1c6220f6171387adf19c1e38244` |
| `rotation-isolated-account-results.json` | 11 / 0 / 0 | 6594 | `e2bb1ee1c0b92499842b722425257699a00ab816e6ce8b88955cbd28f3e97843` |

## Cleanup, unavailable evidence, and no-change ledger

After all tests, the identity-verified disposable cluster contained only the
non-template `postgres` database, zero custom roles, and zero other client
sessions. Fixture-created databases and owner/runtime roles were removed by
fixture teardown. The server was stopped normally; `pg_isready` reports no
response at loopback 55483. A delayed read-only startup observer, unblocked by
shutdown, likewise reported expected connection refusal; it was not a test.
Inert synthetic cluster files and logs are retained at
`C:\Users\joshv\AppData\Local\Temp\northstar-m23-part7-pg18-20260906` and its
adjacent log. No repository, branch, or evidence file was deleted. The canonical
WSL Git checkout was clean before the Markdown-only evidence addition.

Hosted CI, physical Safari/devices, assistive-technology sessions, founder
visual approval, credentialed/private production, providers, legal/professional
approval, and backup/PITR/restore remain unavailable, not passing. The Part 7
correction changes no rendered UI; Part 9 retains visual work. No Railway,
production database/log/private row, secret/credential inspection, external
provider, live research, file storage, customer data, email/SMS/call, legal
system, pricing, dependency, workflow, or application configuration was changed
or enabled.

Recovery remains **separately reviewed forward fix only**, never destructive
down-migration. Local transactional interruption rollback is not production
restore or application-rollback proof. Existing Part 6 release receipt was
reverified by supplied SHA-256 only; no production access was used.

Writer terminal hands the exact corrected head back for a different fresh
independent read-only audit. No independent acceptance, merge, deployment, or
release is claimed.
