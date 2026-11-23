# Mission 28 Part 14A — paid Automation Center

Status: **Released.** Accepted source `4217ea78e200d1016bd54e3ce4bb72cee2d82d30`,
tree `e5c7c17b0df08ba5e43d801a8c57c1e8dcff872f`, PR #608, merged main
`e72c04bc6990c03b8d0b8719f0bd05779cdba505`.

Part 14A mounts one paid, tenant-private Automation Center for active owner and
administrator sessions. It projects the already accepted Mission 28 policy,
lifecycle, run, schedule, retry, control, channel, document, and immutable
evidence records through a bounded read-only transaction. It adds no demo
authority, migration, scheduler, worker, provider adapter, recipient, message,
financial effect, money effect, or upstream mutation.

## Product surface

- `/dashboard/automation` is a paid-only destination. Part 14A deliberately
  adds no `/demo/automation` route; the isolated demo remains Part 14C.
- `GET /api/v1/automation-center` requires a current durable tenant session,
  `automation:read`, and an owner or administrator role. It returns only the
  exact current tenant projection and uses `private, no-store`.
- `POST /api/v1/automation-center/preview` requires the same tenant boundary,
  current internal-product access, CSRF validation, `automation:update`, and
  an owner or administrator role. It is a pure bounded preview: it stores and
  activates nothing and cannot queue, contact a recipient, call a provider,
  create an external or financial effect, or move money.
- Members and viewers receive neither navigation visibility nor API access.

The paid page gives a concise status, four owner-readable templates, a custom
bounded setup, no-effect preview, approval inbox boundary, private owner work,
active/paused/failed run groupings, policy drilldown, customer/document
timeline, limits, channel availability, company-stop evidence, and a
progressive explanation. Primary copy does not expose internal implementation
terms or promote scheduled/provider-accepted work to delivery, reply, payment,
collection, or business success.

## Read and privacy boundary

The repository begins one `REPEATABLE READ READ ONLY` transaction, applies
statement/lock/idle-in-transaction timeouts, binds
`northstar.automation_tenant_id` from the server-owned session, and limits each
source collection to one hundred rows. A collection above the bound fails the
whole response closed. PostgreSQL is the clock authority. No request field can
select a tenant, actor, session, role, table, query, or row limit.

The response contains only opaque internal identifiers, fixed labels, fixed
states, bounded counts, currentness labels, and trusted timestamps. It excludes
policy documents, canonical text, message bodies, recipient addresses, customer
contact values, document contents, provider payloads, credentials, tokens,
free text, and cross-tenant material. Failed or stale loads clear every prior
tenant-derived region before an error is shown.

Policy lifecycle and delivery-control heads remain separate authorities. A
resumed delivery control cannot mask a paused, expired, retired, superseded, or
emergency-stopped policy lifecycle. Recorded-active policy projection requires
the exact latest lifecycle for that same policy version, the exact lifecycle
currentness marker, and an expiry later than the read transaction clock. Run
projection uses that same policy-version lifecycle and expiry gate before any
tenant, policy, or action-schedule delivery-control evidence. A captured run
record remains historical evidence rather than proof of live runtime
revalidation; owner-facing active labels therefore say recorded active. The
summary separately reports recorded-active, paused, and status-unavailable
policy counts. Any unavailable policy makes the aggregate status unavailable
or review-needed instead of disappearing behind zero known-state counts. When
all shown states are resolved, the positive aggregate label is recorded
automation evidence, never a claim that automation is live-revalidated or
globally current.

Immutable approval evidence is not a pending-approval resolver. Part 14A
therefore reports the pending approval count and combined attention count as
unavailable, never zero, and shows no actionable approval merely because an
approval record exists. Immutable internal-task records remain historical
evidence: even exact captured evidence, including a task followed by terminal
evidence, does not establish that the task is currently pending or resolved.
The owner-work pending count stays unavailable and historical entries are
labelled accordingly. Current limit consumption, a pending approval resolver,
provider/live channel availability, and tenant-stop release authority are not
jointly mounted and stay explicitly unavailable. A recorded stop remains
authoritative; a missing release control is never treated as permission to
resume.

Latest-event and timeline labels name only the immutable evidence class. A
cancellation record does not say cancelled, a suppression record does not say
an effect stopped, a reconciliation record does not say an outcome was
corrected, and a schedule record does not say work is queued. Exact payload and
current authority decide those run states separately. Historical owner-work
copy likewise never infers a terminal, pending, or resolved task state from a
coexisting record class.

Recovery assessments are immutable historical snapshots, not durable current
run heads. A nonblocking assessment yields to later exact processing, retry, or
work-control evidence only when the policy version, transaction, trusted times,
and selected schedule binding all agree. An older or equal processing record
does not supersede the assessment. Missing or conflicting bindings stay
unavailable, while stale source, uncertain-effect, unavailable restore,
currentness, policy, and stop evidence continue to fail closed.

## Setup and templates

The four templates are owner work review, estimate follow-up review,
appointment update review, and invoice reminder review. Every preview request
has an exact eight-field shape, a 3–80 plain-character name, closed source,
action, recipient, channel, and timing values, and a daily maximum from 1
through 25. Template authority fields cannot be widened. An external-channel
preview remains `preview_only_external_channel_unavailable`; an internal
preview remains `preview_only_no_activation`.

Every successful preview states all of the following as false: saved,
activated, queued, recipient contacted, provider attempt created, external
effect created, financial effect created, and money effect created. Templates
and custom setup do not silently create a policy or approval request.

## Evidence boundaries

Migration 287 remains latest and migration 288 is absent. The Part 13E release
baseline is source `51d3fcc0ea4702e06d55cbd512608d98ec1f519e`, tree
`a7c6f60761f063c02a394d4c97b456764d6ac7b7`, PR #607, main
`ee77b1be373ededb5099bcc14cfa191082ecd127`, deployment
`64ee7bdd-aaed-4df9-ac20-e3a64d0410ad`, and image
`sha256:01fd4714b02b0c20f798ffc40a5586e33296f34c6e0721e889f67ca136c61dd2`.
Production reconciliation verified 283/283 migrations through 287/no288,
startup readiness, `/api/health`, `/`, `/dashboard`, and `/demo/` HTTP 200,
and exact dashboard/demo byte/hash parity.

The complete independent audit accepted P0=P1=P2=P3=0 under Node 22.23.3 with
60 Mission 28 suites and 894 tests, 167 supporting passes and 3 intentional
skips, syntax 71, JSON 59, and references 518. The legacy full parity suite's
six failures reproduced on the prior production base and are not claimed
passed. The named pre-release backup is
`pre-m28-part14a-90ebb323-20261123` (`32307774-0077-478b-8c18-d99405af7b96`).

The sole automatic deployment `7f735b47-3d69-4bd4-861a-a9a55e951404` is
`SUCCESS/RUNNING`, instance `78967638-f02a-4e48-a893-1c5a8158fe74`, image
`sha256:25a19362c4237971d541bd031a62f5992fd829e2bc4cf73961e92fb231ab4f5e`.
Production PostgreSQL 18.6 is UTF8 at Etc/UTC offset 0; read-only migration
reconciliation passed 283/283 through 287/no288 with zero extra, duplicate,
mismatched, or pending migrations. Startup, `/api/health`, `/`, `/dashboard`,
`/demo/`, and `/dashboard/automation` returned HTTP 200; dashboard/demo exact
91,681-byte SHA-256
`b42145ddc95e9bc2a383f9dac6ad1f5a884a90d5a3e999a0c126b2b6e3bae369`
parity passed. Provider/live/private-production evidence, physical
Safari/devices, manual assistive-technology review, professional review, and
founder visual approval remain unavailable and unclaimed.
