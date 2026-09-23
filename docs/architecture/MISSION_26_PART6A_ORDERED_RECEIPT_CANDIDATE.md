# Mission 26 Part 6A: guarded price-decision order receipt candidate

Status: isolated, unreleased prerequisite. Mission 26 Part 6A and Part 12A remain open.

Migration 146 assigns a tenant-serialized source order to *new* Mission 24
price decisions. This follow-on candidate adds an immutable, owner/admin-only
receipt using that same tenant lock. The first receipt starts coverage at its
high-water order and deliberately excludes every earlier decision. A later
receipt pins the complete bounded sequence of decisions after that start and
through its high-water mark. A fresh read checks whether a later decision has
made the receipt stale. Rolled-back sequence gaps are allowed and never counted
as missing approvals.

The capture requires a fresh READ COMMITTED statement after acquiring the
tenant lock. A busy decision writer causes an explicit retryable failure rather
than a falsely complete receipt. The existing timestamp-based v1 receipt and
provisional period anchor are unchanged. No Mission 24 writer or estimate
identity is rewritten.

Each event retains both the Mission 24 decision `recordedAt` and the sidecar's
`sourceObservedAt`. A decision can have an earlier `recordedAt` while its
source order is later because it waited behind the capture fence. Calendar
period boundaries must therefore be based on independently reviewed ordered
fences, not the decision timestamp. This candidate does **not** claim a
verified calendar month, all-business coverage, sufficient history, booked
work, earned revenue, cash, or a forecast. Numeric output remains unavailable.

The receipt is bounded to 1,000 events, 256 estimates and 256 KiB; overflow
fails closed. Runtime may execute only the guarded capture/read functions and
cannot read or modify the tables or helpers directly. Current paid access,
role, session, CSRF and tenant authority are checked at capture; a fresh paid
owner/admin gate protects readback. Tests use disposable PostgreSQL and
synthetic decisions, including an in-flight writer, backdated decision time,
rollback gap, replay, tenant isolation and private-table denial.

Still required before Part 6A acceptance: a mounted paid/demo user journey,
calendar-period fence policy, full correction/withdrawal lineage and booked-work
linkage, bounded-source overflow and recovery tests, independent exact-head
audit, release gate and deployment verification. Later forecasting requires
multiple comparable covered periods and held-out evaluation. No provider or
private-production completeness is implied by the synthetic tests.
