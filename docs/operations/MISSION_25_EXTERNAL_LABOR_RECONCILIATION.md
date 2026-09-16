# Mission 25 external labor reference reconciliation

The guarded `matches` routes let a current owner or administrator review an opaque worker or job reference from one consented external labor source and link it to one current NorthStar workforce profile or estimate. The write pins the complete current imported-record manifest, the current target basis, the actor, session, request identity, confirmation contract and reason.

A source correction or tombstone changes the current source digest. A workforce profile or membership change changes the worker target digest. Those changes mark the saved link stale; they never silently retarget it. Revoking source consent hides the matching projection and blocks matching writes. Re-granting creates a new consent revision and does not revive links reviewed under the earlier consent. Unlinking creates another immutable revision.

The match does not create or alter a worker, job, labor interval, estimate, payroll record, schedule or policy. It is reviewed provenance for a later outcome package. Runtime access is limited to guarded read and mutation functions; the matching table and source/target helper functions remain unavailable to the runtime role.

## Operator sequence

1. Read `GET /api/v1/learning/external-labor-sources/:sourceKey/matches` with current owner or administrator authority.
2. Select a current source reference and a current same-tenant workforce profile or estimate.
3. Submit the displayed source digest and target digest, current match revision/digest, explicit confirmation, reason and a new idempotency key to the same path with `POST`.
4. Refresh after any `409`. The imported reference, selected target or prior match changed.

This package exposes API authority only. No rendered owner interface is included. A later owner matching interface must use plain language, preserve keyboard focus, and receive mobile, theme and wording review before release.
