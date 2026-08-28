## Mission 22 Part 6 — mobile crew Today

Base: `8d5f18ed02b2edd201664a75c5cd726edcce1bd9`

This draft adds a signed-in, employee-minimized, mobile-first, read-only Today
surface. It returns only current direct assignments and current-active-crew
assignments from the existing canonical assignment/schedule/dispatch/approval
authorities, with tenant-IANA day bounds, exact revision/digest pins, minimum
job/customer/location/instructions/current-crew context, and truthful bounded
provider-neutral route uncertainty. Authorization and returned bytes are
rechecked in one read-only repeatable-read PostgreSQL snapshot.

There is no worker mutation, live provider call/configuration, financial/
settings/broad-history projection, other-worker schedule access, Mission 23
field execution capability, new durable authority, or migration 036. Protected
migrations 001–035 are byte-preserved.

Writer evidence at the exact implementation source:

- focused Part 6: 2/2 suites, 12/12 tests;
- explicit Parts 1–6 compatibility: 13/13 suites, 169/169 tests;
- locally available Jest: 153/153 suites, 2,130/2,130 tests;
- PostgreSQL 18.4 UTC fresh/restart, migration 035 exactly once, two health 200s;
- installed Chrome 151 and actual Playwright WebKit 26.5: 8 matrices and 96
  committed employee-only/Command Center-reference screenshots, zero provider
  calls, zero worker-mutation traffic, zero browser errors.

The screenshot package is under
`outputs/m22-part6-writer/employee-only-screenshots/` with exact hashes and a
machine/human manifest. After terminal release, the Mission 22 lead must copy
it to the already verified canonical OneDrive evidence/screenshots path and
surface key views; user visual approval remains separate and unclaimed.

Unavailable/unclaimed: the 24 account-migration-010 cases requiring four absent
disposable URLs, optional security scanner configuration, hosted checks if
none, physical Safari/devices, provider/live-route/production data, production
migration/deployment/acceptance, and user visual approval.

This PR is intentionally draft and awaits a different fresh exact-head
read-only independent audit. Do not mark ready, merge, deploy, or begin Part 7
from writer evidence alone.
