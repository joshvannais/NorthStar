# Mission 26 Part 6A: paid ordered-price receipt route candidate

Status: isolated, unreleased prerequisite. Part 6A and Part 12A remain open.

The existing paid `/api/v1/forecast/price-history` router now exposes a
guarded capture and readback for the [source-ordered receipt](MISSION_26_PART6A_ORDERED_RECEIPT_CANDIDATE.md).
Only a currently authorized owner or administrator can capture or read it. The
capture requires CSRF and an idempotency key, and uses a READ COMMITTED
transaction so the source-order fence can use a fresh database snapshot.
Both endpoints use the existing rate limit and no-store response policy.

The API returns only the receipt identity, digest, observed count, dates and
currentness state. It never returns the private global decision sequence,
digest nonce, raw events, customer data or price details. A busy same-tenant
writer is a retryable conflict. A stale receipt remains explicitly stale.
Every response says calendar coverage and forecast eligibility are unverified;
no revenue or price forecast is issued.

Mounted disposable-PostgreSQL tests exercise paid owner access, member/CSRF
denial, replay, cross-tenant hiding and stale readback. Unit tests exercise
minimal output and fail-closed handling of inconsistent source data. The paid
API mount does not complete the demo journey, calendar-period policy,
correction/withdrawal lineage, overflow recovery, booked-work linkage,
independent release gate or Part 6A acceptance.
