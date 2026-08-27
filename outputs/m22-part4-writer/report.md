# Mission 22 Part 4 writer evidence

Status: implemented; exact-head independent audit pending.

This is writer evidence, not an audit verdict. The writer did not mark the pull
request ready, merge, deploy, restart Railway, access production, call a live
provider, or begin Part 5.

## Immutable starting point

- Repository: `https://github.com/joshvannais/NorthStar.git`
- Base/live main at preflight: `76943b124d4978af5cb7eeaecf9fdfc46307ec6e`
- Base tree: `3d890101fdb855bd2e54165656b9741315bf152e`
- Branch: `mission22/part4-human-approval`
- Checkout: fresh, isolated, full-history, clean before edits
- Protected migrations 001-034: byte-for-byte unchanged
- New migration: `035_schedule_human_preview_approval.sql`
- Migration 035 SHA-256: `64898a637bc1ba3959edbdfdf32f06fb04d2ca4a4a8e0399792c8508a2de86d7`

## Implemented boundary

The mounted canonical API now exposes separate mutation preview and mutation
approval routes for exactly assign, reassign, unassign, schedule, reschedule,
and dispatch. Preview is durable, expires after exactly 15 minutes, returns
`grantsMutation: false`, and carries exact assignment, proposal, conflict,
recommendation, warning, review, actor, session, and tenant evidence.

Approval performs the current-authority checks again and commits the exact
mutation, immutable human approval, assignment revision, audit event, and
idempotency response in one serializable database transaction. The runtime role
cannot write authority evidence directly; canonical assignment and appointment
guards require same-transaction matching approval evidence. Internal functions
are withheld and the two entry functions authenticate the current durable
session and raw CSRF token with schema-qualified fixed-search-path routines.

The legacy appointment PATCH is uniformly `M22_PREVIEW_REQUIRED`. It cannot
mutate directly. The former Part 1 repository remains for historical tests, but
the role-separated runtime cannot write its legacy evidence tables or bypass the
Part 4 guards. Appointment creation remains compatible through a narrowly
trusted initial-assignment trigger.

Part 2 conflicts and Part 3 recommendations remain read-only inputs. A
recommendation is re-evaluated and authority-digested at approval time, grants
no mutation, is not persisted, and causes zero provider calls. Hard conflicts
cannot be overridden. Exact warnings and review reasons must be acknowledged.
Reassign, unassign, and reschedule revoke a dispatched state; dispatch requires
a new preview and approval.

## Result

Writer gates are green for the current implementation. See `test-evidence.md`
for exact counts and preserved intermediate failures, `source-sink-inventory.md`
for the mutation boundary, and `unavailable-evidence.md` for evidence that is
not claimed. A different fresh exact-head independent auditor must inspect the
complete pull request and rerun mounted adversarial validation before approval.
