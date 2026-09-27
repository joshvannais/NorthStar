# Mission 26 Part 6A — approved-price period coverage gate

Status: provisional source prerequisite. Part 6A and Part 12A acceptance remain open.

The mounted price-history route can count Mission 24 first approvals present in
an immutable source receipt. It cannot yet certify that an arbitrary historical
period was observed in full. In particular, an empty window before the company
began using NorthStar cannot be interpreted as zero approved business.

The eligible source scope is **NorthStar Mission 24 human-approved price
decisions**, not all contractor revenue, booked work, earned revenue or cash.
An additive source-owned observation anchor begins no earlier than a guarded,
current-tenancy capture made after this mechanism is released. Do not backdate
it to the first observed approval, infer it from an empty event list, or
retroactively mark old snapshots observed. Later corrections and withdrawals
still require the currentness and lineage checks already established; a stale
snapshot remains unavailable.

The anchor is **provisional**, not proof that a period is complete. A
concurrent Mission 24 decision can receive a wall-clock `created_at` before the
capture cutoff while remaining invisible to the capture's serializable MVCC
snapshot. A same-snapshot currentness check can also miss it until a later
read. No numeric baseline or zero may be issued as source-complete until a
source commit-order fence and adversarial concurrency test close this gap.

This anchor records only when NorthStar started this observation boundary. It
does not prove that the contractor put every off-platform approval into
NorthStar or that the volume is sufficient for a useful forecast. Those are
separate coverage and evaluation gates. Zero observed approvals remain an
unverified observation, not a whole-business zero or future baseline.

Acceptance requires a mounted paid owner/admin source path and independent
PostgreSQL tests for first capture, replay, concurrent actors, tenant/role/session
denial, no retrospective coverage, a provisional post-anchor empty period, a
pre-anchor period, source correction or withdrawal, source-size overflow, and
an unchanged historical receipt. A future complete-period method must first
establish commit-order coverage, enough comparable periods and held-out
evaluation before issuing a number.
No customer-facing estimate, schedule, booking or financial record changes.
