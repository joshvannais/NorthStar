# Mission 19 Part 3 canonical authority deployment inventory

This document is an inventory and deployment checklist only. PR #69 does not
run a production migration, backfill, customer merge, ownership assignment, or
deployment.

## Additive database authority

Migration `004_canonical_persistence_v2.sql` remains the immutable canonical
graph foundation. Migration `005_canonical_organization_authority.sql` adds:

- immutable, organization-scoped Business Profile versions;
- persisted Retell/voice integration ownership;
- organization-scoped normalized phone/email identity constraints; and
- nullable profile provenance foreign keys for pre-existing graph rows.

Migration 005 deliberately creates no Business Profile, integration ownership,
or customer identity rows for existing organizations. It does not inspect,
merge, delete, reassign, or infer ownership from legacy records.

Migration `006_canonical_voice_sessions.sql` adds organization-scoped,
PostgreSQL-authoritative voice sessions and their idempotent event timelines.
Every session pins the persisted integration ownership and exact Business
Profile id, version, and hash used when the session starts. Only the live
provider handle remains process-local. Handoff and cancellation therefore fail
with `VOICE_RUNTIME_UNAVAILABLE` after a restart or on another process instead
of pretending a durable database row is a live call handle.

Migration `007_canonical_tax_authority.sql` adds explicit canonical estimate
tax columns. It does not infer, default, or backfill a tax rate. A validated
Business Profile rate, including an explicit zero rate, produces exact tax and
total values. Missing or invalid tax configuration produces the exact
`tax_configuration_unavailable` disposition and no invented total.

Migrations 006 and 007 create no customer, estimate, or historical voice data
for existing organizations. They do not inspect, merge, or infer tenant data.

Before enabling canonical ingestion for an organization, an operator-controlled
deployment process must inventory and explicitly create:

1. one validated active `canonical_business_profiles` version; and
2. exactly one active Retell agent ownership record in
   `canonical_integration_ownership` for each enabled organization.

Unknown, missing, inactive, or ambiguous authority fails closed. Historical
file, Sheets, legacy PostgreSQL, and JSON records remain untouched. Any future
historical import must be separately authorized, idempotent, organization
scoped, and auditable.

## Reachable production graph surfaces

| Surface | Disposition after migrations 005-007 |
| --- | --- |
| `POST /api/retell/webhook` | Persisted agent ownership, then one canonical PostgreSQL graph transaction |
| `POST /api/v1/voice/webhook` | Signature/timestamp validation, persisted agent ownership, then the same canonical ingestion service |
| `GET /api/v1/voice/sessions*` | Organization-scoped PostgreSQL session and timeline projections with persisted RBAC |
| Voice handoff/cancel | Owner/admin RBAC plus a matching live process handle; otherwise retryable 503 |
| `POST /api/v1/simulations/leads` | Authenticated `leads:create`, canonical transaction |
| `POST /api/leads` | Authenticated `leads:create`, canonical transaction |
| `GET /api/leads` and export/detail equivalents | Organization-scoped canonical PostgreSQL projection |
| Canonical appointment update | Persisted `calendar:update`, organization/session-scoped identifier |
| Legacy lead/calendar/Polaris mutations | Intercepted with `LEGACY_AUTHORITY_READ_ONLY` |
| Legacy Polaris intelligence/estimate reads | Canonical persisted projection adapters; obsolete Polaris endpoints return exact 410 retirement responses |
| File-backed lead/customer/Polaris stores | Test/import fixtures only; no mounted canonical route uses them as tenant authority |
| Google Sheets lead append | Disabled for automatic graph ingestion; it cannot determine canonical success |
| Browser/AppStore | Reads compatibility projections derived from committed canonical snapshots |
| Canonical response cache | Disabled for authority reads; every canonical request queries PostgreSQL |
| Estimate tax | Derived only from validated canonical Business Profile configuration, or explicitly unavailable |

## Mounted legacy route disposition

The `/api/v1` and `/api` routers own exact methods rather than applying
router-wide authentication. An unmatched method falls through without a second
membership lookup or an attempt to redefine immutable tenant context.

The following compatibility reads are adapted to organization-scoped canonical
PostgreSQL projections:

- customers and customer detail;
- communications, calls, and communication detail;
- opportunities, pipeline, lead detail, and lead intelligence;
- financial estimates and financial metrics;
- analytics, dashboard, executive, and statistics projections;
- workflow agenda, appointments, and calendar projections; and
- Polaris intelligence, estimates, recommendations, learning, pipeline,
  Retell context, business context, and unified context.

The following legacy mutation groups are blocked with
`LEGACY_AUTHORITY_READ_ONLY` and HTTP 409 before any legacy repository can run:

- legacy lead simulation/import/status writes;
- calendar event, schedule, and ICS-import writes;
- call-record and mark-known writes;
- customer, communication, opportunity, and workflow writes;
- legacy financial estimate writes; and
- legacy Polaris estimate, completion, recommendation, pipeline, and
  configuration writes.

All other methods and paths beneath the legacy `polaris`, `customers`,
`communications`, `opportunities`, `workflows`, `financial`, `assets`, `crew`,
`jobs`, `analytics`, `engines`, `dashboard`, `leads`, `calls`, and `calendar`
prefixes are retired with `LEGACY_AUTHORITY_RETIRED` and HTTP 410. The contact
writer is also retired. The old `polaris-engines`, `publicApi`, and dashboard
routers are not mounted. Their source and file-backed stores remain historical
or import/test fixture material only; they are not production tenant authority.

## Deployment gates outside this PR

- Take and verify the normal database backup required by the deployment owner.
- Run migrations 001 through 007 in a non-production disposable PostgreSQL 17
  verifier, then run the approved production migration procedure separately.
- Inventory organizations requiring profile and integration configuration;
  obtain explicit ownership evidence rather than inferring it from webhook data.
- Configure one organization at a time and verify fail-closed behavior before
  enabling its webhook.
- Do not automatically backfill legacy files, Sheets, `leads`, `call_records`,
  or legacy Polaris JSON data.

## Canary and observability checks

These are future deployment-owner gates; this PR has not performed them.

1. Enable one explicitly configured organization only after its active Business
   Profile and integration ownership have been independently verified.
2. Confirm `/api/health` reports PostgreSQL persistence healthy and the
   authenticated canonical status reports `postgresAuthoritative: true`,
   `redisRequired: false`, and `canonicalResponseCaching: false`.
3. Observe canonical operation state, lease/replay outcomes, audit persistence,
   voice-session ownership/runtime-unavailable responses, and normalized 409,
   410, and 503 error codes. A warm read followed by database outage must never
   return a stale 200.
4. Compare canonical graph, Business Profile provenance, estimate tax
   disposition, and all seven browser projections for the canary organization.
5. Confirm repository data-file hashes remain unchanged and no legacy or
   automatic browser writer runs.

## Rollback and stop criteria

Stop the canary before broader enablement for any tenant crossover, stale 200
during PostgreSQL outage, duplicate graph, partial graph, missing audit record,
unexpected legacy file mutation, voice ownership mismatch, Business Profile
provenance mismatch, fabricated tax/total, or sustained unexpected error rate.
Disable new ingestion for the canary organization and preserve database and
audit evidence. Application-release rollback must use the deployment owner's
normal immutable release procedure; do not destructively reverse schema, delete
canonical rows, infer ownership, or run a compensating backfill from this PR.

GitHub CI is evidence only when checks exist and report a result. If PR #69 has
zero checks or workflow runs, CI is unavailable, not passing. This PR has not
been merged or deployed and has not changed Railway, production data, production
schema, or PR #66.
