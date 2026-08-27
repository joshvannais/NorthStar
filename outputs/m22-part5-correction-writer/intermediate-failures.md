# Preserved intermediate failures

1. Initial mounted suite invocations failed before product execution when the
   disposable PostgreSQL identity variables or exact listen address were
   absent; corrected invocations used the verified PG18.4 UTC cluster.
2. The first expanded Part 4 suite retained an obsolete expectation that a
   read-only operator had no targets; updated to the ratified read/mutate split.
3. Focused alias and subscription fixtures initially expected a different
   compatibility denial code or incomplete record set; product codes and
   authoritative fixtures were preserved.
4. The first 101-row fixture updated the wrong source join and one concurrent
   batch exhausted the bounded pool. The fixture now joins through appointment
   identity and populates bounded batches/sequentially.
5. A simulation fixture reused a session/call identity and correctly received
   `RETRYABLE_GRAPH_FAILURE`; correction uses unique test-owned identities.
6. Real drag initially displayed a derived end but omitted it from the preview
   because the time contract returned `rfc3339`, not `raw`; fixed at the active
   shared UI boundary.
7. A normal Command Center Refresh click passed its DOM event into the expected
   revision parameter and cleared the view; fixed with an explicit wrapper.
8. WebKit mobile raced warning checkbox rendering; the matrix now waits for the
   real preview evidence. A hidden mobile Refresh control was not used as a
   bypass; full visible reload proves recovery.
9. Combined mounted run was 60/61 because the fixture assumed concurrent insert
   ordinal equalled keyset order. It now selects the actual row excluded from
   page one; focused rerun passed.
10. The next full combined rerun was 60/61 and exposed a product defect:
    PostgreSQL microseconds rounded to JavaScript milliseconds in a cursor,
    yielding total 100 while `hasNext=true`. Exact UTC microsecond cursors fixed
    it; focused 1/1 and combined 61/61 passed.
11. First full Jest after the operator gate was 146/151 suites and
    1,993/2,113 tests. Besides the known unavailable 24, four historical suites
    used a fake operator, the later-disabled seeded demo user, employee/viewer
    broad access, or a nonexistent empty tenant. Narrow test authority repairs
    and pre-query input validation closed all 96 additional failures. Terminal
    corpus is 150/151 and 2,089/2,113 with only the known 24 unavailable.

No intermediate failure was reclassified as passing.
