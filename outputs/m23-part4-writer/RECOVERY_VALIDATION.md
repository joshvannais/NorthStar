# Mission 23 Part 4 recovered correction validation

Writer validation completed 2026-09-05 UTC against the recovered existing branch
`mission23/part4-materials-inventory`, based on exact live base
`961245ebd12a28d2c7aa1c0b3e003530e4428f09`.

The remote audited head was `50ca2f25b30e44ca56c90cf90a8c6719c4727f92`.
Recovery retained local commits `f8bbf55080af2a3e617124f12ee658fd544a46f0`,
`1b27c46`, and `e3912055f48d263acd2f43c572f05431fefdf80e`, including all
previous implementation and tests. No reset, replacement worktree, duplicate
writer, or migration rewrite occurred. No applicable `AGENTS.md` was found.

## Narrow recovery changes

- Complete the previously unfinished 045 identity, roadmap, evidence, and
  ratification updates.
- Bound only frozen migration 045 in the production runner to a 5,000 ms lock
  ceiling and 20,000 ms statement ceiling, preserving tighter configured
  values. Restore settings on success; failure rolls back the entire run.
- Add real PostgreSQL proof of bounded advisory contention, all eleven table
  locks released on rollback, unchanged fence and ledger, tighter timeout
  preservation, one successful fence increment, exact retry, and restart zero-op.
- Supplement the all-eleven statement-trigger matrix with actual canonical
  appointment/assignment inserts and supported field-execution entry mutations.
  The original last-three zero-row matrix entries are statement-trigger tests,
  not proof of those relations' real mutation compatibility by themselves.
- Explicitly test an otherwise-valid old-runtime `READ ONLY` caller's intended
  fail-closed result and subsequent corrected-runtime recovery without any
  intervening authority revocation.
- Correct two stale Mission 22 assertions that required 037 to remain last.
  They still check the exact historical prefix and complete current ledger.

## Verification

Native Linux Node 24.18.1 and a fresh, disposable loopback PostgreSQL 18.4
cluster were used. Database identity was checked by the shared suite helper:
UTC, UTF8, C locale, data checksums on, explicit non-default port, exact data
directory, and per-suite databases. Part 2–4 tests use separate non-superuser
migration/runtime roles. Historical predecessor fixtures retain their own
declared role setup, including the test-only M20 administrative upgrade fixture.

| Gate | Result |
| --- | --- |
| Changed JavaScript `node --check` | 19 files passed |
| Focused Part 4 unit + ratification | 2 suites, 80/80 passed |
| Migration-history inspector unit | 1 suite, 4/4 passed |
| Complete `tests/ratification` | 22 suites, 365/365 passed |
| Complete `tests/unit` | 92 suites, 5,361/5,361 passed |
| M21–M23 root/receipt + pre-M21 reliability cross-contract | 12 suites, 197/197 passed |
| Part 2–4 PostgreSQL, including migration/privilege/atomicity/security | 1 suite, 67/67 passed |
| All six M22 PostgreSQL predecessor suites + M20 security/role API suites | 8 suites, 81/81 passed |
| M20 real historical 001–014 prefix upgrade | 1 suite, 1/1 passed |
| Isolated account-authority API | 1 suite, 11/11 passed |
| Frozen migrations 001–045 identity checks and whitespace check | Passed |

The combined final PostgreSQL invocation ran 9 suites / 148 tests with no
failures or skips. Local commands used `node node_modules/jest/bin/jest.js`
with `--runInBand` except the full unit run (`--maxWorkers=4`), and explicit
test paths represented by the table. `DATABASE_URL` and
`MIGRATION_DATABASE_URL` were cleared outside suite-owned role provisioning.
The PostgreSQL helper received only the disposable loopback identity.

Non-repository JSON/text logs are under
`/home/joshv/.local/tmp/m23-p4-recovery-evidence-hkh7Qn/`:
`final-postgres`, `ratification`, `unit`, `cross-contract-final`, `m20-prefix`,
and `account-authority`. Earlier diagnostic runs are retained there too.

The first Linux launch required the bundled PostgreSQL library path and Linux
optional dependency resolution; neither changed tracked dependency manifests.
The first expanded predecessor run was 79/81 because of the two stale 037
assertions above. Both were corrected without changing production behavior;
the complete rerun passed 81/81. No omitted failure is represented as passing.

## Review and remaining gates

A fresh read-only static boundary investigator and one fresh static candidate
reviewer ran under the security-fix workflow. The investigator identified the
bounded-upgrade-wait issue; the candidate reviewer found no concrete surviving
authorization bypass or unintended regression, and identified the ordinary
legacy-reader control gap now covered above. These are writer-lane reviews,
not the separate release-acceptance audit.

Existing two-connection regression tests pass for all supporting-authority
triggers, stale read/replay/mutation zero-effects, same-backend exclusive/shared
reentrancy denial, concurrent legitimate reads, contention/timeout/cleanup,
runtime fence/helper/table denial, old-reader fail-closed behavior, and an old
043 writer held across the 044/045 upgrade sequence. Migrations 042–045 keep
their separately recorded exact blobs, byte counts, and SHA-256 values.

PR #168 remains a draft writer candidate. Fresh independent exact-head audit,
exact-final-source SELECT-only production-history preflight, hosted CI, normal
merge, automatic deployment, production application/ledger, health, later-start
zero-op, and backup/restore evidence are not established here. No production,
private rows, secrets, providers, Part 5, merge, or deployment were accessed or
authorized by this recovery. No UI changed and no visual approval is claimed.
