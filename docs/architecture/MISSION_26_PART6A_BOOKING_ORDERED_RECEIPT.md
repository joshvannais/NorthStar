# Mission 26 Part 6A — guarded booking-approval history receipt

Status: bounded Parts 1-4 source prerequisite. Broader Part 6A remains open.

Migration 155 turns the post-installation Mission 22 approval order from
[migration 153](MISSION_26_PART6A_BOOKING_APPROVAL_ORDER.md) into an immutable,
tenant-private receipt. A paid owner or administrator captures it with a live
session, CSRF token and idempotency key. The first capture establishes a
source-order fence and includes no earlier approvals. Later captures retain
every observed approval since that fence, up to a bounded limit. The read
rechecks authorization and whether new approvals have made the saved receipt
stale. Capture and read take the same tenant lock as the approval writer, so a
writer in progress cannot be mistaken for an empty period. Rolled-back
sequence gaps are not interpreted as missing approvals.

Each retained event identifies the appointment, assignment, approval, action,
resulting schedule/appointment state and recorded times. It takes the
opportunity ID from the approved Mission 22 assignment, whose identity is
immutable, rather than from the appointment's current mutable linkage.
The receipt preserves repeated assign, dispatch and later correction events;
it does **not** collapse them into a first booking or infer a price. Its
private tables, digest nonce, internal source orders and helper functions are
withheld from direct runtime access. Guarded capture/read entries return the
receipt digest only to an authorized owner or administrator.

The normal Mission 22 approval writer and sealed Mission 24 estimating
contracts are unchanged. This is source evidence, not proof that a scheduled
appointment was commercially booked. A later candidate must interpret first
booking and cancellation/amendment history; establish a reviewed same-tenant
link to the specific Mission 24 price decision effective and visible at that
time; handle currency, pre-anchor appointments and completeness; and preserve
currentness. No booked-work value, earned revenue, cash or forecast is issued.

The three mounted fictional-tenant tests exercise first fence, post-fence
events, appointment-opportunity relinking after approval, replay, stale read,
held source fence, tenant/role isolation, runtime privilege withholding and
immutability. The focused existing Mission 22
approval-order test also passes
with migration 155 installed. These tests do not prove a live historical
calendar, off-platform bookings, positive price linkage, complete month, CI,
private production or full Part 6A acceptance.
