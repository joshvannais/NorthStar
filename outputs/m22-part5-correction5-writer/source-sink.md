# Source-to-sink and authority inventory

## Current authority source

Production account middleware supplies a tenant/user/access-role envelope plus
the exact durable `authSession.id`. `actorInput` forwards the session identity;
it no longer treats middleware onboarding/subscription booleans as authority.
`loadSchedulingOperatorDirectory` and `loadSchedulingOperatorTargetPage` open a
read-only repeatable-read transaction, join the tenant membership and user to
the exact auth session, workforce profile, onboarding/business profile, and
subscription rows, then derive read and mutate dispositions from those current
rows.

No target, directory, completed-graph count, or broad tenant record query runs
until this current authority resolves. Canonical `/graphs`, `/dashboard`,
`/analytics`, `/status`, `/surfaces/*`, `/compat/*`, customer,
communications, opportunities, appointments, Calendar, Command Center, and
operator-target aliases share this gate. Typed 401/403/409 responses are
preserved rather than collapsed into a generic availability response.

## Target traversal source and sink

Untrusted query/cursor input is normalized and strictly bounded before the
target transaction. UUID-shaped queries become lowercase. PostgreSQL derives
only active tenant profiles and crews with active members, filters the exact
query, computes total and dataset identity, and returns at most 26 ordered rows
to expose a 25-row page. Immutable kind/UUID is the only keyset boundary.

Cursor v2 is canonical unpadded base64url JSON and is bound to operation,
tenant, canonical query, dataset digest, kind, and UUID. A dataset mismatch
returns 409 before any page is represented as complete. The UI validates the
digest and bounded result, uses same-origin credentials/no-store, and on 409
clears the stale options/cursor and announces a required restart through the
existing aria-live status. It never invokes preview/apply from stale state.

Worker, crew, customer, reason, and hostile labels continue through DOM node
creation and `textContent`; this correction adds no `innerHTML`, unbounded
client cache, direct appointment PATCH, provider call, or alternate mutation
path. Manual review covered every call to the directory loaders and every broad
canonical/compatibility consumer. The optional scanner was unavailable and was
not invoked.
