# Part 7 writer provenance and scope ledger

Status: implementation writer candidate only; stop for a different fresh
independent read-only audit after exact draft-PR handoff.

## Preflight and authority

The canonical executor was confirmed readable. The entire canonical monitor
handoff, exact-base Mission 23 roadmap/root/Part 7/gates/downstream boundaries,
deployed Parts 2–6 source/tests/evidence, and applicable instructions were read
before editing. No repository or WSL ancestor AGENTS.md was present.

Preflight established a clean full-history base at
`6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9`, the normal merge of approved Part 6
PR #170; remote main matched. There was no Part 7 branch/PR or competing active
writer. Existing unrelated frozen branches/PRs were not changed.

One isolated checkout outside OneDrive:
`/home/joshv/codex-writers/m23-part7-6bf5b66` (Windows UNC
`\\wsl.localhost\Ubuntu\home\joshv\codex-writers\m23-part7-6bf5b66`).
One branch: `review/m23-part7-progress-issues`. No amend, rebase, reset,
force-push, squash, merge, deployment, branch deletion or history rewrite.

Supplied receipts were read and SHA-256 verified locally, without production
access. The parent initially transcribed Part 6's SHA with its last `e` omitted;
work paused before implementation until the exact unchanged file hash was
confirmed. This was a metadata transcription correction, not a changed receipt.

| Supplied receipt | SHA-256 |
| --- | --- |
| `M23_PART5_RELEASE_ACCEPTANCE_2026-09-05.md` | `761aac78b817c19212af9869071473a94dae25a9942a64c4edf85354f423cb7a` |
| `M23_PART6_RELEASE_ACCEPTANCE_2026-09-06.md` | `a48253d7d4191680ac06e045d08a95ce70f16149d4eec7bfad80eabc8150422e` |

These receipts live under the lead workspace's `answer-artifacts`, not in this
repository. Part 6's supplied independent audit verdict was also read at
`audit-evidence-pr170-516a8b7-20260905T202251ET/TERMINAL_VERDICT.md`, SHA-256
`6a624c9d1f5991f0e25490c8acba71b0c038d873cb7ff1c2758addde29918868`.
Roadmap Parts 5/6 status is reconciled only to these already released facts;
Part 7 is still a writer candidate and Parts 8–12 remain unimplemented.

## Tests-first and implementation sequence

Original failing tests and reproducible red evidence were committed before
source implementation in `b43cae0` on the exact released base. The first red
environment could not resolve the installed Windows optional native resolver
binding; the already-installed binding was copied from the prior audit's
dependency inventory. No package or lockfile changed and nothing was downloaded.
The first attempted JSON output had no directory; the same unchanged tests were
rerun to the tracked red report before implementation.

Early green attempts found the missing generic runtime table-DML exclusion for
the new withheld authority, then a test-fixture session revocation reason-column
error. Both failed reports remain local evidence. Further additive focused
coverage validates SQL/JS Unicode parity, composite links, stale snapshots,
exact replay revocation, real production HTTP, and full capacity traversal.

There is no rendered UI change. The exact scope and semantic design are in
`docs/operations/PROGRESS_ISSUE_FACTS.md`; requirements map is in
`REQUIREMENT_TO_EVIDENCE.md`; migration bytes and recovery disposition are in
`MIGRATION_IDENTITY.md`; exclusions and no-change boundaries are in
`UNAVAILABLE_EVIDENCE.md`.

## Reproduction environment

Node.js 24.18.1 on Windows; source remains in the one WSL full-history checkout.
Dependencies are the prior installed inventory, with no manifest changes.
Disposable PostgreSQL 18.4, UTF-8, UTC, checksums on, loopback port 55483;
separate non-superuser owner/runtime roles created and cleaned by fixtures.
Cluster path: `C:/Users/joshv/AppData/Local/Temp/northstar-m23-part7-pg18-20260906`.

`run-tests.js` launches Jest with a small explicit synthetic environment, no
inherited provider credentials, and a loopback-only database/admin identity
guard. Its evidence tag must be unused; it refuses to overwrite result JSON.
Use `node outputs/m23-part7-writer/run-tests.js <unused-tag> <Jest arguments>`.
Use `--available` for the broad inventory with the exact inherited 50-name
unavailability list and no suite/path exclusion. Raw later JSON is ignored,
retained locally, and hashed in TEST_RESULTS.md. The original red JSON remains
tracked. All tests are local writer evidence, not release or provider evidence.
