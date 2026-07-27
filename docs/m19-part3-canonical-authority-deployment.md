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

| Surface | Disposition after migration 005 |
| --- | --- |
| `POST /api/retell/webhook` | Persisted agent ownership, then one canonical PostgreSQL graph transaction |
| `POST /api/v1/voice/webhook` | Signature/timestamp validation, persisted agent ownership, then the same canonical ingestion service |
| `POST /api/v1/simulations/leads` | Authenticated `leads:create`, canonical transaction |
| `POST /api/leads` | Authenticated `leads:create`, canonical transaction |
| `GET /api/leads` and export/detail equivalents | Organization-scoped canonical PostgreSQL projection |
| Canonical appointment update | Persisted `calendar:update`, organization/session-scoped identifier |
| Legacy lead/calendar/Polaris mutations | Intercepted with `LEGACY_AUTHORITY_READ_ONLY` |
| Legacy Polaris intelligence/estimate reads | Canonical persisted projection adapters |
| File-backed lead/customer/Polaris stores | Test/import fixtures only; no mounted canonical route uses them as tenant authority |
| Google Sheets lead append | Disabled for automatic graph ingestion; it cannot determine canonical success |
| Browser/AppStore | Reads compatibility projections derived from committed canonical snapshots |

## Deployment gates outside this PR

- Take and verify the normal database backup required by the deployment owner.
- Run migrations 001 through 005 in a non-production disposable PostgreSQL 17
  verifier, then run the approved production migration procedure separately.
- Inventory organizations requiring profile and integration configuration;
  obtain explicit ownership evidence rather than inferring it from webhook data.
- Configure one organization at a time and verify fail-closed behavior before
  enabling its webhook.
- Do not automatically backfill legacy files, Sheets, `leads`, `call_records`,
  or legacy Polaris JSON data.
