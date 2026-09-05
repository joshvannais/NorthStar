# Mission 23 Part 6 local test results

Candidate environment: Node.js 24.18.1 and disposable vanilla PostgreSQL 18.4
on loopback ports 55479 and 55481 with separately exercised owner/runtime roles.

| Gate | Result |
| --- | --- |
| Part 6 unit, mounted PostgreSQL, migration lifecycle and migration inspector | 4 suites, 33 tests passed; zero failures |
| Part 6 ratification | 1 suite, 8 tests passed; zero failures |
| Prior Parts 1–6 focused regression | 16 of 17 suites, 323 of 324 tests passed; sole failure is the released Part 5 lifecycle's intentional 046-is-final assertion after additive 047 |
| First broad available inventory | 194 suites and 6,623 tests passed; one stale migration-inspector expectation failed and was corrected; 2 suites/50 tests explicitly unavailable |
| Pre-hardening broad available inventory | 196 suites and 6,632 tests passed; zero failures; 2 suites/50 tests explicitly unavailable; 621.249 seconds |
| Final frozen-byte broad available inventory | 196 suites and 6,633 tests passed; zero failures; 2 suites/50 tests explicitly unavailable; 619.252 seconds |
| Audit-correction focused unit, PostgreSQL 18.4, migration lifecycle/upgrade, migration inspector and ratification | 5 suites, 45 tests passed; zero failures |
| Audit-correction broad available-only inventory | 196 suites and 6,637 tests passed; zero failures; 2 suites/50 tests explicitly unavailable; 619.658 seconds |
| Lost-COMMIT/orphan correction focused unit, PostgreSQL 18.4, migration lifecycle/upgrade, migration inspector and ratification | 5 suites, 49 tests passed; zero failures |
| Lost-COMMIT/orphan correction broad available-only inventory | 196 suites and 6,641 tests passed; zero failures; 2 suites/50 tests explicitly unavailable; 631.167 seconds |

The real migration-runner test interrupts 047 after DDL and before ledger commit,
proves the schema and ledger both roll back, retries exactly once, and proves a
later runner call and application restart are zero-op. Mounted tests also cover
current-authority replay, tenant/role/session/record isolation, stale pins,
concurrency, forced-audit rollback, hostile JSON, file gates, privacy consent,
bounded pagination, streaming, and immutable access events.

The correction-focused cases additionally prove pre-storage idempotency
reservation, accepted replay and conflicting/concurrent upload exclusion from
provider mutation, generation-scoped cleanup, declared upload-digest matching,
all three required accessibility states, hostile accessibility-text rejection,
append-only accessibility correction and generation/version/accessibility-bound
retrieval. The broad inventory was rerun after freezing the corrected 047 bytes.

The follow-up correction cases additionally prove a real PostgreSQL COMMIT that
succeeds before the client throws, fresh accepted reconciliation without any
provider deletion, fail-closed byte retention while reconciliation is
unavailable, append-only generation identity across expired takeover,
hard-crash orphan cleanup claims, retryable cleanup confirmation, stale-worker
rejection, and an accepted-record fence against cleanup. One initial broad
attempt was stopped after the task-owned cluster reported `America/New_York`
instead of required `UTC`; it is retained as invalid environment evidence and
not counted. The corrected UTC run produced the final inventory above.

Raw Jest JSON is local and ignored. Failures remain evidence and are not erased.
