# M22-P5-013 / 014 / 015 closure

## M22-P5-013 — current broad-read authority

The prior directory trusted middleware-captured access role, onboarding, and
subscription mutation flags after querying only current membership/user status
and workforce role. A durable owner-to-member/technician demotion after
middleware therefore retained broad read and mutation flags.

The corrected `operatorDirectory` requires the exact authenticated session ID
and, inside the same repeatable-read transaction used for targets, re-reads:

- session ID, user, tenant, membership binding, active status, and access expiry;
- current membership role/status and user status;
- current workforce profile operational role;
- current onboarding/business-profile state; and
- current subscription status and trial dates at PostgreSQL server time.

Session divergence is a typed 401. Demotion, inactivity, dispatcher removal, or
middleware/current-role divergence makes broad read false before profile/crew
or count queries. Current owner/admin/active-dispatcher safe reads remain
available; subscription/onboarding only control `canMutate`. The same shared
gate feeds canonical graph, dashboard, analytics, surface and compatibility
aliases, customer/communication/opportunity/appointment aliases, Calendar,
Command Center, and `/operator-targets`. Part 4 apply authority is unchanged.

## M22-P5-014 — stable, truthful traversal

The former cursor ordered by mutable label, so renaming an unseen target behind
the boundary silently omitted it and renaming a returned target ahead duplicated
it. The corrected keyset orders only by immutable `(kind_rank,id)`. Each 25-row
page computes a constant-memory, query-specific dataset identity from exact
target count plus two independent PostgreSQL hashes of kind and UUID. Cursor v2
binds operation, tenant, canonical query, dataset digest, kind, and UUID.

Renames preserve complete unique traversal. Activation, deactivation, last crew
membership loss, or a rename that changes query membership changes the digest;
the next page returns typed 409 `M22_OPERATOR_TARGET_DIRECTORY_STALE` and
requires restart. Canonical cursor validation and the 25+1 resource bound remain
intact. The UI drops the stale page/options and exposes only a new search.

## M22-P5-015 — UUID query canonicalization

UUID-shaped query input is recognized case-insensitively and lowercased after
NFC/trim/control/character/UTF-8 bounds but before cursor parsing or SQL. Exact
lowercase, uppercase, and mixed-case UUID searches therefore share one canonical
query, response echo, cursor binding, and SQL comparison. Ordinary text search
keeps its safe bounded behavior.

## Mounted closure

Fresh PostgreSQL 18.4 UTC regressions cover stale middleware demotion, workforce
role removal, session revoke and cross-tenant binding, session expiry,
membership/user suspension, subscription read-only transition, all broad
aliases, 208-target unique traversal through rename, explicit stale restart for
target-set mutations, and lowercase/uppercase UUID search over repository and
HTTP paths. No broad bytes/counts or mutation side effects escape denied cases.
