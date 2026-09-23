# Mission 26 Part 6A: pre-anchor decision lineage context

Status: isolated, unreleased bounded prerequisite. The frozen Part 6A scope remains open.

An estimate may have an approved Mission 24 decision before the first Mission 26 ordered-source fence, followed by an amendment after that fence. The ordered receipt deliberately omits the old decision. A source-owned guarded read now retrieves only the immediate predecessor needed to check the first observed amendment's revision, previous decision ID, currency and decision time. It checks the predecessor belongs to the same tenant and estimate, and that its source order is at or before the first fence (or predates source-order capture). It limits the context to 256 estimates and 64 KiB.

The read binds this private context to its immutable receipt with a nonce-salted digest. The month evaluator fails closed on missing, extra or inconsistent predecessor context. The paid month diagnostic exposes the digest, never the predecessor row, price or private source order. The pre-anchor decision is not added to observed events, period counts or first-approval amount. It establishes no pre-anchor calendar coverage and no booked-work, whole-business or forecast authority. A later source decision still stales an older receipt.

Mounted disposable-PostgreSQL coverage proves a pre-anchor approval followed by a post-anchor amendment, same-tenant guarded context, denied member/other-tenant access and no global order exposure. Unit coverage tests accepted immediate lineage and tampering. A positive closed post-anchor month remains unavailable in the current mounted timeframe. Rolling receipt overflow, complete calendar/business coverage, booked-work linkage, future baseline and independent full-slice acceptance remain open.
