# Validated finding closure evidence

## Frozen input finding identity

- Audited head: `25ca82837e0368425a7ed645d80addd18888e802`.
- Audit verdict: CHANGES_REQUIRED, P0 0 / P1 1 / P2 1 / P3 0.
- Audit report SHA-256:
  `3905f8cac54f53b04ba8e3b94086e50144b3854b2125823c32483b3ef8d15236`.
- Findings SHA-256:
  `3e96c597ae73c00403692b6abb3c9899ae980752a2e0d3d68bd8560ed6c0562c`.
- Original mounted reproduction SHA-256:
  `8d4f20d040c24b2d85b83b5b902eaaaa889f690b8928c00a0f64187f26904dc6`.
- Original passing exploit log SHA-256:
  `7fe827c48219c65a06cf4f8bba4d946c69193fbbf1fb37f085e07313c93fb1b0`.

Those immutable auditor artifacts independently preserve the red-before-fix
ordinary-runtime overlap bypass and transaction-held expiry bypass. They were
not relabelled as writer-generated evidence.

## M22-P4-001

The runtime role still executes only the authenticated preview/apply entry
routines. It cannot execute the new trusted hard-authority helper. The helper
recomputes all current hard classes under the same transaction and tenant lock.
It returns a deterministic, bounded canonical hard array. Preview creation
rejects if caller JSON differs. Approval independently recomputes and rejects a
non-empty current result regardless of caller digests.

The mounted regression constructs an accepted owner schedule, confirms a real
`approved_schedule_overlap` on a second appointment, and directly calls the
runtime-executable preview routine with the original forged zero digests and
empty hard array. PostgreSQL returns SQLSTATE 23514 with
`canonical_schedule_part4_evidence_stale`; assignment revision/digest and all
preview/approval/audit/idempotency counts remain unchanged.

Additional mounted comparisons prove the trusted SQL array equals the mounted
Part 2 evaluator for `declared_unavailable`, `location_scope_mismatch`,
`required_skill_mismatch`, and `inactive_crew_member`. Inactive and unavailable
direct profile targets reject before entering the lane. Existing mounted Part 2
coverage retains `inactive_target`, person/crew overlap, bounds, soft warnings,
and missing/stale review behavior.

## M22-P4-002

The exact held-transaction regression creates a preview whose database-owned
expiry is one second ahead, opens a serializable runtime transaction before
expiry, waits until `clock_timestamp()` is after expiry, and directly calls the
approval entry. It returns SQLSTATE 23514 with
`canonical_schedule_part4_preview_expired`; assignment revision and all applied
evidence counts remain unchanged.

The lock-wait variant holds the tenant organization row update lock, begins the
runtime approval call before expiry, waits two seconds across expiry, releases
the lock, and receives the same inclusive rejection with zero applied evidence.
The durable approval time, if an approval succeeds before expiry, is exactly
the live post-lock authority evaluation instant rather than transaction start.
