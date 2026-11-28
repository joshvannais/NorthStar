# Mission 29 Part 1C — authenticated enterprise context

Status: **Writer candidate; independent exact-head audit and release pending.** The [complete approved source](../roadmap/MISSION_29_APPROVED_SOURCE.md), [roadmap](../roadmap/MISSION_29_ENTERPRISE_PLATFORM.md), [44-slice ledger](../roadmap/MISSION_29_ACCEPTANCE_LEDGER.md) and [machine-readable contract](MISSION_29_PART1C_AUTHENTICATED_ENTERPRISE_CONTEXT.json) govern together. Scope is fresh server-owned account/location reference context. Location lifecycle, persisted selection and UI remain later slices.

## Inherited authority and implementation

The exact inherited main is [bf4ba06f2b5700be715d2366aa43c7a2bf5ca794](https://github.com/joshvannais/NorthStar/commit/bf4ba06f2b5700be715d2366aa43c7a2bf5ca794), tree 01e5b1ae7a84b5b5d9be22b1447fc179169d29d8. [PR616](https://github.com/joshvannais/NorthStar/pull/616) records earned terminal 1B acceptance. Its root release checkpoint SHA256 is 10748338FD6F6F6AE45CF51896C997D8AC56EF7863A1B7E5649D8103FD7F8C8D; final ledger SHA256 is 83BBB77A180D18975690AA43A51DFC11F4584B7CEF82121D3DB732741F93FD70. Those are historical release facts, not a new 1C production campaign. The immutable [1A inventory](MISSION_29_PART1A_AUTHORITY_INVENTORY.md) and [1B identity snapshot](MISSION_29_PART1B_ORGANIZATION_LOCATION_IDENTITY.md) retain their pre-release provenance.

Actual 1C implementation is [context.js](../../src/enterprise/context.js), [contextRepository.js](../../src/enterprise/contextRepository.js) and [enterpriseContext.js](../../src/routes/enterpriseContext.js), mounted by [server.js](../../src/server.js). They use the unchanged [cookie-session middleware](../../src/auth/middleware.js), [fixed permissions](../../src/auth/permissions.js) and [1B identity contract](../../src/enterprise/identityContract.js). The inherited [account schema](../../migrations/010_account_session_authority.sql), [organization/profile schema](../../migrations/005_canonical_organization_authority.sql), [account repository](../../src/accounts/repository.js) and [workforce profile references](../../src/workforce/repository.js) remain intact.

## Browser-session interface

| Method and path | Accepted request | Result |
| --- | --- | --- |
| GET /api/enterprise/context | Existing verified browser cookie session; no query string | Current actor, company, membership, source profile pin and explicit selectable legacy office references; selectedLocation is null |
| POST /api/enterprise/context/resolve | Same current cookie session and existing CSRF validation; exact parsed object containing contract, binding and location; no query string | Freshly validated explicit selection in the current response only |

The contract marker is northstar.enterprise.context.v1. The selection binding is an exact lower-case 64-hex comparison value. The location is a complete 1B legacy_location_reference, including exact company, key, profile pin and declaration metadata. Missing/null/undefined/extra fields, unsupported contracts, foreign or unknown references, canonical-location substitutions, stale pins and stale bindings deny. Even a single-headquarters account must select explicitly on the resolve path. Discovery is an inventory read, never an implicit selection or wildcard scope.

Both paths retain existing cookie authentication and verified-account requirements. User Bearer credentials remain unsupported. Request bodies, headers, 1B association graphs and caller declaration metadata cannot supply the trusted actor, session, membership or company. Context metadata is not a premium feature; the existing fixed role's settings-read permission is checked without changing plan entitlements or operation permissions.

Responses from the router, including authentication and selection denials, use Cache-Control: no-store and add Cookie to existing Vary fields. Existing canonical CORS policy is preserved; an allowed-Origin canonical-server response retains both Origin and Cookie. Errors contain bounded codes and a fixed recovery message without reflecting requested foreign identities or database diagnostics.

## Fresh server resolution and currentness

Every accepted discovery or selection executes a new read-only REPEATABLE READ transaction. One SQL statement joins exact auth_sessions, users, organization_memberships and organizations, then the active canonical_business_profiles row. Session ID, actor ID and company ID come only from the established middleware context and are matched again in SQL and projection. Session/membership/user status, revocation flags, fixed role, user/company agreement and database-clock access/refresh expiry must be current in that snapshot.

The comparison binding includes the exact actor/session/company/membership identities, current role, actor and membership revisions, session creation and expiry revisions, credential hash, profile ID/version/hash and actual location keys/labels. PostgreSQL revision text retains microseconds. Observation time does not become a false expiry or authorization grant. No raw session ID or credential hash is returned.

The response is a coherent MVCC observation, not a lock or reservation. A revocation committed before the SQL snapshot denies; a concurrent change committed afterward can follow that observation and must be seen on the next request. observedAt is the database-clock observation during the read, not a guarantee that authority stays unchanged through response delivery. A binding or returned context cannot authorize a later operation, cancel an in-flight effect, or bypass that operation's fresh authorization. No cancellation or reversal is claimed.

## Locations and provenance

Current location choices preserve the existing workforce source convention: headquarters plus exact headquarters.additionalOffices keys in the active Business Profile. They remain legacy_location_reference values, never allocated canonical location identities. The module rejects malformed, duplicate and case-ambiguous source keys rather than mapping an old office record into a new identity. The 1B batch bound is an internal input resource bound, not a commercial location allowance.

Each server-projected reference carries an observation declaration: the source profile ID, current actor ID and database observation time. This describes the reference observation, not original profile authorship, ownership or a durable declaration write. Caller-supplied declaration metadata is syntactically validated but never trusted; a successful resolve returns the fresh server projection. Exact active source company and all profile-pin fields are rechecked through the 1B matcher. A supplied snapshot or association never substitutes for the database source.

There is no shared or session-persisted active-location preference. Two sessions may resolve different explicit choices independently, and the next discovery still has selectedLocation null. No existing job, customer, workforce, asset, financial, learning or automation consumer accepts broader access from this response. Historical office/homeLocation IDs and record scope are untouched.

## Persistence, compatibility and rollout

No table, migration, backfill, dependency, deployment configuration or old SQL byte changes. Source retains 285 migrations through 289/no 290. Existing UNIQUE(user_id) membership and durable session joins, company/Business Profile authorities, fixed roles, subscription behavior and individual accounts remain in force. The new server mount is additive; existing account routes are unchanged.

This slice writes no persistent selection or context and requires no data conversion. There is no schema upgrade/rollback step. A normal source rollback would remove the additive context surface without needing a data reversal; no rollback operation or disaster restore is exercised here. Slice 1D owns governed lifecycle persistence/transitions and 1E owns UI/context navigation. Part 2 owns later scoped assignments/custom roles/SSO; regions, franchise disclosure, enterprise reports, branding and machine API remain later parts. Missions 21–28/30/31/33 retain their established boundaries.

## Validation and acceptance boundary

The [unit suite](../../tests/unit/m29-part1c-authenticated-enterprise-context.test.js) executes actual context/selection modules with positive and adversarial fixtures. The [PostgreSQL/HTTP suite](../../tests/integration/m29-part1c-authenticated-enterprise-context-postgres.test.js) creates a fresh identity-checked loopback database, separate non-owner runtime and migration-owner roles, applies and reconciles all 285 migration checksums, and exercises the actual repository, cookie middleware, router and canonical server mount. It uses no SQL/repository mocks. Fixtures are independent per test, support randomized order, and are removed with their generated roles; the local cluster is stopped after each campaign.

Coverage includes foreign actors and actor/session pairing, unknown/foreign/omitted scope, source profile transitions, microsecond revision differences, revoked membership, a revocation committed between cookie authentication and context reload, expiry, independent concurrent sessions, real disconnected-pool failure/recovery, new-connection reload, preserved old constraints and single-location auth compatibility. Controlled local transport guards establish absence of attempted fetch effects in the canonical-server context test, not provider readiness. Retained unit suites have their own controlled adapters and are not additional SQL or provider proof.

Writer checks remain separate from root's required new complete fresh full-history exact-head audit with zero P0–P3. Every changed SHA requires that entire independent audit again. Normal exact-head GitHub review, required backup/standing rotation, guarded normal merge, one automatic deployment and bounded read-only source/image/migration/startup/health/render/key-cleanup verification remain unearned 1C release gates.

No fresh 1C private-production, provider, hosted-CI, browser-render, physical-device, manual-AT or founder visual campaign is claimed. Empty hosted checks are not green CI. Six older baseline-reproduced full-parity failures remain unclaimed passing. Real recipients/messages/money, automatic financial effects, legal/professional conclusions, production SLA and disaster restore remain separate.

After terminal 1C acceptance and root instruction, the next slice is **1D — Location lifecycle and historical scope**. It has not started.
