# Mission 26 Part 6A — guarded historical approved-price position

The adapter reads one immutable Mission 24 approved-price receipt and checks
it against the tenant-visible current decision history inside one serializable,
read-only transaction. The existing database functions enforce current paid
owner/admin, session and organization authority. A missing, mismatched or
stale receipt yields an unavailable position; no incomplete or mixed-currency
amount is promoted. The accepted result says only that the historical price
position was calculated from a guarded receipt that was current at its check
time. A later decision can make it stale immediately, so any future saved run
or displayed advice needs its own currentness invalidation.

This is an internal reader, not a route, scheduled run or issued forecast. It
does not authenticate a Mission 22 first booking or calculate booked work,
earned revenue, invoices, payments or cash. It does not close Part 6A or 6B.
The numeric position remains descriptive and has no calibrated conversion
probability. No provider or public Retell history is required for this source.
