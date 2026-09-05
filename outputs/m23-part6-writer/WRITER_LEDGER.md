# Mission 23 Part 6 writer ledger

Status: implementation candidate awaiting a different fresh independent
read-only audit of the exact draft-PR head. The writer does not approve it.

## Provenance and preflight

- Canonical executor readability was confirmed before action. The complete
  Mission 23 Operations roadmap, root contracts, Part 6, Parts 1–5 accepted
  authorities and receipts, and security/privacy/accessibility/migration/release
  gates were read before editing. No repository `AGENTS.md` exists.
- Exact released base and then-current remote main:
  `dfc769520ea56fdb7fde44dda6fe0bd65202fcdb`; full history contained 1,234
  commits and the worktree was clean before edits.
- Preflight found no Part 6 branch, open PR or active overlapping writer.
- Persistent full-history Git directory:
  `C:/Users/joshv/Documents/Codex/2026-08-05/read-and-follow-northstar-monitor-handoff/m23-part6-writer-dfc7695.git`.
- The first Windows worktree materialization failed because released history
  contains an NTFS-invalid tracked path. That failure is retained as unavailable
  Windows-worktree evidence; no source was changed there.
- Isolated full-history writer worktree:
  `/home/joshv/codex-writers/m23-part6-dfc7695`.
- Narrow branch: `review/m23-part6-field-evidence`.

## Delivered scope

The candidate adds one PostgreSQL-owned append-only field-evidence graph for
checklist instances, item responses, inspection/quality observations, inert
notes/captions, corrections, file metadata, events, audits, idempotency and
file-access events. It mounts only the minimum field-execution APIs needed to
exercise that authority.

The file pipeline remains unavailable by default. Its injectable provider
boundary is accepted only when durable encrypted quarantine, malware scanning,
metadata removal, immutable object creation, generation-scoped retention/orphan
cleanup and short-lived retrieval are all
independently declared and evidenced. Files are registered only after a clean
release with exact resulting bytes and digest. No real storage or scanner was
configured or called.

No rendered UI changed. Part 9 still owns worker/owner operational screens, so
browser visual scope is accurately not applicable for this candidate rather than
treated as a substitute for future interaction and accessibility acceptance.

No Part 7 progress/blocker/change authority, Part 8 completion/reopening, Part 9
UI, Part 10 Polaris intelligence, financial/estimate/invoice effect, provider
activation, secret/configuration change, production/private-data access,
customer contact, legal decision, merge, deployment or release is included.

## Correction history

- The independent audit of exact head
  `78906517ffae3de3f0dc4678640675988baab259` required two corrections. P2 now
  reserves and validates the complete idempotent upload request in PostgreSQL
  before provider mutation, issues a fresh opaque object/generation/claim, and
  permits cleanup only for that generation. Exact accepted replay and conflicting
  or concurrent requests do not enter storage. P3 now requires and persists
  bounded inert described/unavailable/needs-review accessibility state, binds it
  to reservation/content/record digests, audits and retrieval, and permits only
  append-only accessibility correction. See `CORRECTION_LOG.md`.

- A fresh re-audit of exact corrected head
  `050555b309dd0a801ca87b859282c8609e588a74` retained one P2: a successful
  PostgreSQL COMMIT followed by lost acknowledgement could still enter generic
  cleanup, and expired takeover erased the only prior-generation pointer. The
  follow-up correction adds an immutable generation ledger, serializable fresh
  reconciliation, `cleanup_pending` acceptance fencing, database-issued cleanup
  claims, append-only cleanup tombstones and bounded orphan claims on takeover.
  Unknown database outcomes retain bytes; accepted outcomes return canonical
  replay and never call deletion. The skill-required fresh read-only bypass
  reviewer found no actionable defect; a different exact-head release auditor
  is still required. See `CORRECTION_LOG.md`.

- Corrected an initial result-document rule that treated absent measurements as
  invalid instead of requiring values only for the `measurement` result type.
- Corrected SQL parameter ambiguity, a read-only locking attempt and validator
  alias ambiguity found by the first mounted PostgreSQL run.
- Corrected action-union parsing so `observationClass` is accepted only for the
  observation action and relevant correction document.
- Added a separate immutable access-event ledger and serializable disclosure
  authorization after final privacy review.
- Hardened all direct-SQL evidence graphs with exact cross-ledger, canonical
  digest, database-time and tenant-composite validation, and required an
  independently evidenced decompression-safe file result capped at 40 megapixels.
- Excluded only the released Part 5 migration-lifecycle test from the broad
  available runner because that historical test hard-codes 046 as the final
  migration. Its failure with additive 047 was reproduced and is not relabelled
  as a Part 6 pass.

## Local environment and evidence

- Node.js 24.18.1.
- Disposable vanilla PostgreSQL 18.4, UTF-8/UTC, separate owner/runtime roles,
  loopback ports 55479 and 55481. No production connection was used.
- Exact migration identity is recorded in `MIGRATION_IDENTITY.md`.
- Focused unit, mounted PostgreSQL, lifecycle, migration inspector and
  ratification results are recorded in `TEST_RESULTS.md`.
- A pre-hardening broad available-only inventory passed 196 suites and 6,632
  tests with zero failures; 2 suites/50 tests remained explicitly unavailable.
  The final frozen-byte rerun passed 196 suites and 6,633 tests with zero
  failures; the same 2 suites/50 tests remained explicitly unavailable. It
  completed in 619.252 seconds; both results are recorded in `TEST_RESULTS.md`.
- The audit-correction focused gate passed 5 suites/45 tests, and the corrected
  broad available-only inventory passed 196 suites/6,637 tests with zero
  failures; 2 suites/50 tests remained explicitly unavailable. It completed in
  619.658 seconds.
- The lost-COMMIT/orphan focused gate passed 5 suites/49 tests. The final
  UTC-corrected broad available-only inventory passed 196 suites/6,641 tests
  with zero failures; 2 suites/50 tests remained explicitly unavailable. It
  completed in 631.167 seconds. An earlier attempt stopped on the disposable
  cluster's wrong timezone and is retained as invalid environment evidence.

An independent auditor must evaluate the final immutable PR head. Local green
tests cannot grant approval or release authority.
