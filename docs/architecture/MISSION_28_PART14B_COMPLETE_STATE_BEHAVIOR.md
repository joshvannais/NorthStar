# Mission 28 Part 14B — complete state behavior

Status: **Implementation candidate only. Not independently accepted or
released.** Part 14B extends the released paid Automation Center with a closed,
owner-readable projection for every frozen run state and exhaustive fail-closed
clearing. It adds no route, demo authority, migration, worker, scheduler,
provider adapter, recipient, message, upstream mutation, external effect,
financial effect, or money effect.

## Closed rendered states

The paid page renders exactly: validation, approval, queued, in flight,
uncertain, suppressed, failed, paused, stopped, expired, completed internal
work, corrected evidence, recovery evidence, stale, and unavailable. The API
returns a count for every state, the counts must total the exact run count, and
the browser accepts only the fixed owner-readable label for that state. Unknown
or missing states fail the whole response closed.

Queued and in-flight are never inferred from schedule or action-unit existence.
Queued requires an exact retry or action-control queue phase; in-flight requires
an exact unexpired lease or compatible exact control evidence. A retained retry
head and a live lease are ordered by their trusted timestamps; unresolved or
expired-schedule conflicts render uncertain. An expired lease renders recovery,
not in flight.

One selected action schedule is not a whole-run aggregate. If a run has more
than one committed action unit or more than one schedule, Part 14B renders the
whole-run execution state unavailable instead of letting the newest selected
schedule hide another unit's queued, leased, uncertain, or stopped evidence.
Unknown retry states, incomplete schedule bindings, and incomplete lease or
retry timestamps also remain unavailable.

A terminal record is only a terminal evidence class. Its exact payload decides
whether the projection is completed internal, suppressed, stopped, failed,
uncertain, or unavailable. It never implies customer delivery, receipt,
payment, collection, business success, or a safe resend. Likewise, a
cancellation record is stopped only when its exact payload says accepted;
requested remains pending validation, too-late is uncertain, and missing or
unavailable stays unavailable. Suppression requires an exact
`blocksEffect=true`; record type alone never proves suppression.
Reply/opt-out suppression additionally requires its exact authenticated flag;
an unauthenticated or incomplete record remains uncertain.

Approval-required and unavailable approval evidence renders only a recorded
approval category whose current pending status is explicitly unavailable. A
historical approved record renders validation/later-state-unavailable; it does
not create a new pending owner request or strengthen the unavailable approval
inbox into a known count.

Latest-event, timeline, and owner-work copy remains a secondary evidence
projection, not another state resolver. Its fixed labels identify only the
record class. Cancellation does not mean cancelled, suppression does not prove
an effect stopped, reconciliation does not prove correction or success, and a
schedule record does not prove queued or scheduled execution. A coexisting
record class cannot make historical owner work terminal, pending, or resolved;
that current status remains unavailable.

## Conjunctive authority and precedence

Captured run evidence remains recorded history, not live runtime validation.
Missing currentness is unavailable and stale currentness is stale. Nonterminal
run projection also requires the exact same-version policy lifecycle to be
active and unexpired. Draft/validated/previewed remains validation, paused is
paused, expired is expired, and retired/superseded/emergency-stopped is stopped.

Tenant, policy-version, and action-schedule delivery controls remain independent
conjunctive authorities. For nonterminal execution projection, any restrictive
current control wins over retained execution evidence. Closed recovery states
then preserve stale, unavailable, uncertain, or bounded-recovery dispositions
before generic lease fallback;
unknown recovery states fail closed. Exact provider/delivery evidence remains
uncertain unless a separately accepted fact proves more. Reconciliation may
render corrected only from its exact corrected payload.

Recovery assessments are immutable historical snapshots. A nonblocking
`bounded_history_verified_no_effect` or `wait_for_active_lease_no_effect`
assessment can yield only to processing, retry, or action-control evidence with
a strictly later trusted time and the same exact policy version, transaction,
run, and selected schedule binding. Older or equal evidence leaves the recovery
snapshot controlling. Missing time, missing binding, a transaction mismatch,
or conflicting execution evidence fails closed. Stale-source, disaster-restore,
and reconciliation-required recovery results remain restrictive regardless of
newer positive-looking execution evidence.

## Browser clearing and races

Every load begins by clearing all tenant-derived fixed fields, counts,
containers, preview text, and hidden content. A failed load clears again before
fixed owner-readable failure copy is shown. HTTP 401 or 403 from any current or
stale GET/preview invalidates both request generations and clears the complete
surface. HTTP 409 proves the mounted record authority is obsolete and performs
the same complete snapshot-and-preview invalidation, even if a newer request is
still pending. Older pending GET or preview successes can never remount data
after that invalidation.

A 400 or 422 preview validation failure is narrower: it clears every prior
preview field and shows fixed validation copy, while preserving an otherwise
valid loaded tenant snapshot. Raw server errors, result codes, internal
underscore identifiers, provider payloads, recipient data, and secrets never
enter primary owner-facing output.

## Evidence boundaries

The exact base is released Part 14A: accepted source
`4217ea78e200d1016bd54e3ce4bb72cee2d82d30`, tree
`e5c7c17b0df08ba5e43d801a8c57c1e8dcff872f`, PR #608, merged main
`e72c04bc6990c03b8d0b8719f0bd05779cdba505`, sole production deployment
`7f735b47-3d69-4bd4-861a-a9a55e951404`, and image
`sha256:25a19362c4237971d541bd031a62f5992fd829e2bc4cf73961e92fb231ab4f5e`.
Migration 287 remains latest and migration 288 remains absent.

Writer tests are not independent acceptance. Part 14B audit, PR, merge,
deployment, production behavior, provider/live/private-production evidence,
physical Safari/device evidence, manual assistive-technology review,
professional review, and founder visual approval remain unavailable and
unclaimed.
