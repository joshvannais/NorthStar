# Mission 28 Part 10B — Dispatch communication boundary

Status: **Implementation candidate only.** Part 10A is released. This contract adds no runtime route, queue, worker, provider, recipient, message, task, notification, scheduling mutation, dispatch mutation, route mutation, appointment mutation, external effect, or money authority.

## Exact source boundary

Part 10B consumes two separately trusted, exact-current Mission 22 facts already frozen by Part 4A and snapshotted by Part 4B:

- `m22.appointment_state`: exact tenant and appointment identity; revision and digest; status; scheduled interval; canonical tenant time zone; explicit event kind and source-owned event time; snapshot, source-set, and currentness identities and digests.
- `m22.assignment_dispatch_state`: exact tenant, appointment, and assignment identity; assignment revision and digest; appointment status; assigned target; schedule and dispatch state; scheduled interval; explicit event kind and source-owned event time; snapshot, source-set, and currentness identities and digests.

The assignment digest covers target, schedule, dispatch, interval, appointment status, and review state. Part 10B additionally pins every consumed value in its currentness material so a valid-looking state change cannot be grafted onto an unchanged snapshot or currentness resolution.

Mission 22 currently has exact `not_dispatched`, `dispatched`, and `revoked` states. It does **not** have an accepted on-the-way, delay, arrival-window, travel, route, location, coordinate, vehicle-telemetry, or ETA fact. A scheduled interval, dispatch state, assignment, distance, or elapsed clock cannot stand in for one.

## Closed request results

| Request | Required exact fact | Current result |
|---|---|---|
| Dispatch notice | current scheduled, assigned, `dispatched` Mission 22 assignment for the same scheduled appointment | unavailable; customer-communication authority is not launched |
| On-the-way notice | exact accepted Mission 22 on-the-way fact | unavailable; source fact is not supported |
| Delay notice | exact accepted Mission 22 delay fact | unavailable; source fact is not supported |
| Arrival-window notice | exact accepted Mission 22 arrival fact | unavailable; source fact is not supported |
| Cancellation notice | exact current cancelled Mission 22 appointment/assignment state-change fact | unavailable; customer-communication authority is not launched |

The fixed result labels are owner-readable and nonreflective. Exact dispatch or cancellation facts do not grant permission, approval, recipient, channel, provider, send, delivery, urgency, or effect authority.

## Privacy and mutation boundary

Only the generic fixed label `Assigned worker recorded — private details withheld` may be projected. Names, email addresses, telephone numbers, addresses, coordinates, access instructions, routes, vehicle telemetry, ETA, or other private worker/location material are rejected rather than redacted after use. Part 10B cannot schedule, reschedule, cancel, assign, dispatch, reroute, update an appointment, or mutate any Mission 22 fact.

Part 1D still has no accepted `customer_communication` source, role, capability, channel, recipient, or external-effect cell. Part 7B still resolves external communication authority as unavailable or suppressed. Therefore every structurally valid Part 10B request produces a no-effect projection only.

## Currentness, replay, and failure

Every candidate is ordinary plain data with an exact key set. Tenant, appointment, assignment, snapshots, source set, event kind/time, revision, digest, status, interval, time zone, currentness, actor/session/membership, launch matrix, and communication basis must resolve independently and agree exactly. Missing, stale, mixed, unavailable, corrected, substituted, cross-tenant, cross-record, or ambiguous material fails closed.

The semantic idempotency digest excludes only the projection identity, evaluation instant, and digest fields. It includes the request kind and all exact source, operational-signal, privacy, launch, and communication-basis material. The same semantic request under a new ID or evaluation time is clone/replay reuse and is denied; a changed exact source fact produces new material.

## Evidence boundary

No migration 288 is added; migration 287 remains latest. No external/provider/private-production/legal/physical-device/manual-assistive-technology/hosted-load/founder-visual evidence is claimed. The direct current-deployment applied-migration history was not re-queried because the Railway account has no registered SSH key and local Railway execution exposes only a private database hostname. Source migrations remain 283 through 287 with no 288.

Part 10C and all later slices remain planned and unimplemented.
