# Mission 22 exact record-trace ledger

Evidence source: `raw/exact-record-trace.json`. The IDs and digests are from an
isolated disposable PostgreSQL tenant; no production data was read or written.

| Step | Durable authority | Revision result | Security/trace assertion |
| --- | --- | --- | --- |
| 1. Appointment creation | Compatible schedule ingress | 1, unassigned / scheduled / not_dispatched | `needs_review`; no approval rows |
| 2. Part 2 evaluation | Conflict digest only | unchanged | Evaluation grants no mutation |
| 3. Part 3 recommendation | Evidence-pinned candidates only | unchanged | Recommendation grants no mutation; no provider call |
| 4. Assign person | Current owner preview + approval | 2 | Cookie session, CSRF, tenant, role, subscription, revision and digest checked |
| 5. Cross-surface read | Calendar / Command Center / Today | unchanged | Same appointment, target, revision, digest, schedule and dispatch |
| 6. Dispatch person | New current preview + approval | 3, dispatched | Durable approval/audit/idempotency/history |
| 7. Reassign crew | New current preview + approval | 4, dispatch revoked | Reassignment cannot retain dispatch |
| 8. Redispatch crew | New current preview + approval | 5, dispatched | Previous approval is not a capability |
| 9. Reschedule crew | New current preview + approval | 6, dispatch revoked | Reschedule cannot retain dispatch |
| 10. Concurrent redispatch | Two approvals against one current authority | 7, one winner | One succeeds; stale loser fails; no write skew |
| 11. Crew-membership removal | Durable membership delete | unchanged owner authority | Employee can no longer read/enumerate prior job |
| 12. Paid/demo terminal read | Separate tenant/session contexts | unchanged | Paid record absent from demo; zero external/provider calls |

Terminal record:

- assignment revision: 7
- target: current active crew
- schedule: scheduled, explicit UTC instants
- dispatch: dispatched after the final new approval
- immutable evidence: 7 revisions, 6 human approvals, 6 human audit events,
  6 human idempotency rows, 7 previews
- current record digest:
  `a18899eb98cb9a4f4c52da7fa18a8bb26ba16dca7e109554fe7c34e5de0b1644`
- provider calls: 0

The supported-upgrade trace applies 001–031 first, then 032–035, and verifies a
legacy appointment backfills as revision 1 `legacy_import`, unassigned,
scheduled, not dispatched, and `needs_review`. The fresh trace reports 33
applied migration files, PostgreSQL 18.4 UTC, an indexed tenant/schedule lookup,
31 trusted schedule routines, and exact migration checksums.

Every checkpoint records counts for all public tables and a delta from the
preceding checkpoint. Expected adjacent-domain writes such as bounded audit logs
are visible; rejected/replayed operations are checked for no unintended
authority delta.
