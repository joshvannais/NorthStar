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

Historical writer evidence for the production correction at `e72792d`:

- focused Part 6: 2/2 suites, 15/15 tests;
- explicit Parts 1–6 compatibility: 13/13 suites, 172/172 tests;
- locally available Jest: 153/153 suites, 2,133/2,133 tests;
- PostgreSQL 18.4 UTC fresh/restart, migration 035 exactly once, two health 200s;
- installed Chrome 151 and actual Playwright WebKit 26.5: 8 matrices and 96
  committed employee-only/Command Center-reference screenshots.

The evidence-only correction at `b51f467` / tree `89de0e9` then reran focused
Part 6 at 16/16 and all eight Chrome/WebKit matrices. It froze 96 authoritative
screenshots with realistic technician/crew/customer/job/instruction fixtures,
32 realistic ready rows, 56 non-ready/empty rows, 32 exact-provenance synthetic
rows, zero hostile markers, zero provider/external calls, zero worker-mutation
traffic, and zero browser errors. Eight separate, explicitly
non-customer-facing security screenshots retain hostile stored-byte/text-sink
proof with zero injected image elements and no compromise flag. Production
authority, UI, and migrations are unchanged by this evidence-only correction.

The compatibility/full/startup results above remain historical; they are not
relabeled as fresh results for `b51f467`. The independent final audit's
unrelated 2,132/2,133 full-corpus red remains preserved.

The correction closes the independent audit's four validated findings: Today
uses a dedicated minimum shell and never requests `/api/auth/me`; the committed
evidence ledger is generated and verified from immutable Git blobs; every
screenshot row is state-truthful with explicit synthetic provenance; and the
browser fixture selects a real IANA tenant zone that remains deterministic at
every wall-clock hour while retaining New York DST coverage. The browser proof
also inventories exact logout JSON and every observed public-login redirect
request/response before confirming durable session revocation.

The screenshot package is under
`outputs/m22-part6-writer/employee-only-screenshots/` with exact hashes and a
machine/human manifest. After terminal release, the Mission 22 lead must copy
it to the already verified canonical OneDrive evidence/screenshots path and
surface key views; user visual approval remains separate and unclaimed.

The prior final audit at `3ddd332` returned `CHANGES_REQUIRED` solely because
all 32 ready screenshots visibly contained hostile fixture probes. This draft
now awaits a new different fresh exact-head independent audit of the realistic
package and the separately preserved adversarial proof.

Unavailable/unclaimed: the 24 account-migration-010 cases requiring four absent
disposable URLs, optional security scanner configuration, hosted checks if
none, physical Safari/devices, provider/live-route/production data, production
migration/deployment/acceptance, and user visual approval.

This PR is intentionally draft and awaits a different fresh exact-head
read-only independent audit. Do not mark ready, merge, deploy, or begin Part 7
from writer evidence alone.
