# Mission 23 Part 3 — Writer correction and test change log

| Stage | Finding | Correction | Verification |
| --- | --- | --- | --- |
| Initial migration parse | Migration 039 contained one unmatched closing parenthesis. | Removed the syntax defect before behavior validation. | Normal runner applied 001–039 on disposable PostgreSQL 18.4. |
| PostgreSQL harness start | The local PG18 process restart omitted the suite's explicit UTC server override. | Restarted the disposable loopback cluster with UTC while preserving UTF8/C/checksum evidence. | Identity assertion reports PostgreSQL 18.4, UTC, UTF8, C, checksums on. |
| Historical Part 2 interruption fixture | The Part 2 fixture copied every migration except 038, incorrectly ledgering the new dependent 039 before simulating interrupted 038. | Constrained that historical pre-038 fixture to migration names before 038. Product runtime was unchanged. | Both 038 and 039 interruption/retry suites pass. |
| Database error specificity | Generic stale matching ran before labor category/time-source handling, hiding the precise source-stale result. | Moved labor category/time authority mapping ahead of the generic stale branch and gave category identity its own SQL constraint. | PostgreSQL rejects both as `M23_LABOR_SOURCE_STALE`. |
| Open-timer race | The unique partial index could win before the explicit timer check and originally mapped as generic persistence failure. | Mapped both the explicit and unique-index constraints to the same safe timer-already-open conflict. | Concurrent timers across two executions produce exactly one winner. |
| Cached replay authorization | A generic replay denial obscured dispatch/assignment authority loss. | Kept the response non-oracular but mapped current replay loss to the bounded authority denial used by the route. | Direct assignment revocation and current crew removal both deny replay without effects. |
| Long timer closure | A shared 31-day duration bound unintentionally prevented stopping very old server-owned timers. | Kept the manual/correction bound at 31 days while allowing server timers to close and flagging durations over 16 hours `needs_review`. | Focused rules and PostgreSQL timer tests pass. |
| Correction digest | Correction initially recomputed a manual interval using the action name instead of the retained entry mode. | Preserve the interval's original `manual`/`timer` entry mode through correction. | Corrected interval advances revision with a valid canonical digest. |
| Text boundary | An initial binary regular-expression check was not a robust PostgreSQL UTF-8 control-byte validator. | Reused the explicit bounded UTF-8 byte-loop pattern already accepted in Part 2 while retaining NFC/length limits. | Direct repository-to-SQL control-byte request rejects with zero effects. |
| Performer freshness | Exact assignment pins alone did not prove the performer's membership/account remained active at mutation time. | Reload active workforce-profile, membership, and user authority for the performer within the serializable transaction. | Forged/inactive/out-of-scope cases fail closed. |
| Atomic evidence completeness | Row guards alone did not prove all four immutable companion authorities existed at commit. | Added a deferred completeness trigger matching current state to event, revision, audit, and idempotency evidence. | Forced audit insertion failure rolls the entire evidence set back to zero. |

No correction changes protected migrations 001–038. Migration 039 remains
mutable until its committed Git-object identity is frozen and documented; after
that freeze no later candidate commit may alter its bytes.
