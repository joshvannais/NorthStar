# Part 9A completed-history PostgreSQL red

- Runtime: disposable loopback PostgreSQL 18.4, port `55629`, UTF-8, `C`/`C`, UTC, checksums on.
- Command: focused mounted `m22-part6-mobile-today-postgres` Jest suite with the exact disposable-server identity variables.
- Exit: `1`.
- Result: `9` tests passed and the new completed-history control failed.
- Failure: after the canonical appointment became `completed`, the previously reachable Today record disappeared (`completed` was `undefined`) instead of retaining its current execution pointer as read-only history.
- External/provider calls: zero.

The accepted Today contract previously excluded only cancelled assignment state. Part 9A must not silently remove completed work from that mounted personal list, and must return no mutation capability for a terminal appointment.
