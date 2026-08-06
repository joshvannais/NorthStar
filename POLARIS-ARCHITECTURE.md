# Polaris Architecture Authority

**Document version:** 3.0

**Implementation baseline:** `main` at `36d6dd2b30e3674aed03e82f61334b81e46bb4e7`

**Status:** Current architecture inventory; provider and production-readiness claims are explicitly excluded

This document describes the authority that is mounted by `src/server.js`. It is
not a roadmap, a provider-readiness declaration, or evidence that every tracked
historical Polaris module participates in production startup.

## 1. Authority summary

Polaris is the canonical calculation and intelligence projection layer for a
tenant's persisted NorthStar graph. PostgreSQL is the business authority.
Browser state, tracked JSON files, compatibility names, and historical engine
modules do not become authoritative merely because they still exist in the
repository.

| Concern | Mounted authority |
| --- | --- |
| User, organization, membership, and session | PostgreSQL account/session authority and authentication middleware |
| Business Profile inputs | Versioned `canonical_business_profiles` rows resolved by `src/services/organizationAuthority.js` |
| Polaris calculation | `src/services/canonicalPolarisCalculation.js` |
| Atomic graph creation | `src/services/canonicalGraphService.js` through `src/persistence/v2/repository.js` |
| Durable intelligence record | PostgreSQL canonical graph tables and immutable `canonical_polaris_snapshots` |
| Tenant-scoped reads | `src/routes/canonicalPolaris.js` |
| Browser consumption | `public/js/canonical-intelligence.js` plus read-only presentation adapters |
| Provider calls and webhooks | Narrow voice/Retell adapters around persisted ownership and voice-session authority; live-provider readiness is not established here |

The normal flow is:

```text
authenticated tenant input
        |
        v
persisted organization and Business Profile authority
        |
        v
canonicalPolarisCalculation (deterministic calculation)
        |
        v
one PostgreSQL transaction for graph records and immutable snapshot
        |
        v
tenant/session-scoped canonical or compatibility projection
        |
        v
presentation-only browser modules and mounted pages
```

## 2. PostgreSQL canonical graph

Migration `004_canonical_persistence_v2.sql` establishes the graph foundation:

- `canonical_operations`
- `canonical_customers`
- `canonical_transcripts`
- `canonical_facts`
- `canonical_communications`
- `canonical_opportunities`
- `canonical_estimates`
- `canonical_appointments`
- `canonical_polaris_snapshots`

Later additive migrations establish versioned Business Profiles, integration
ownership, voice sessions and their events, explicit tax disposition, demo
authority, and provider-session identity. These schemas do not provision a
tenant, infer provider ownership, import legacy files, or prove a live provider
configuration.

`canonicalGraphService` resolves the tenant's persisted Business Profile,
calculates one `CanonicalPolarisOutput`, and persists the related graph records
inside one transaction. The snapshot retains calculation version, normalized
input fingerprint, Business Profile id/version/hash, supporting fact ids, and a
digest. Reads verify that the persisted estimate and snapshot agree before
projecting them.

PostgreSQL is required for normal startup. Canonical reads do not fall back to
JSON, browser storage, Redis, or a process-local calculation when PostgreSQL is
unavailable.

## 3. Current calculation behavior

`src/services/canonicalPolarisCalculation.js` is the mounted quote-calculation
authority. It consumes normalized facts and the exact persisted Business
Profile version selected by the graph service. Depending on available and
configured inputs, its persisted output can include:

- service and supported scope;
- customer price and pricing line items;
- tax disposition and total including tax;
- labor, material, equipment, travel, overhead, and known cost values;
- production duration, revenue, gross/net profit, and margin values;
- explicit `notCalculated` reasons;
- deterministic confidence factors, risk, and recommended actions; and
- provenance fields and content digests.

Missing, explicit-zero, malformed, and configured-positive values remain
distinct. A value that cannot be calculated stays unavailable with a reason; a
legacy default is not silently substituted.

Current recommendations are deterministic actions stored in each canonical
snapshot and later projected from that snapshot. Current analytics aggregate
persisted canonical values. Neither behavior is evidence of a trained model or
an autonomous learning loop.

## 4. Mounted write boundaries

The production graph writers are narrow and server-owned:

- `POST /api/leads` is the mounted canonical lead writer. It requires
  onboarded authentication, `leads:create` RBAC, and an idempotency key, then
  calls `ingestLead` with canonical `source: 'lead'` and commits through the
  same shared transactional graph authority.
- `POST /api/v1/simulations/leads` generates the mounted synthetic scenario,
  passes it to `ingestSimulation`, and commits one canonical graph after
  authentication, RBAC, idempotency, and service validation.
- Canonical voice/Retell ingestion resolves persisted organization,
  integration, voice-session, and pinned Business Profile authority before
  committing a graph.
- Voice-call creation persists canonical session provenance before crossing
  the provider adapter boundary.

`PATCH /api/v1/canonical/appointments/:id` and
`PUT /api/v1/canonical/integrations/:provider` are separately authenticated,
permission-scoped canonical mutations. They do not authorize a browser or a
legacy Polaris store to calculate or write a competing graph.

Provider interception in tests establishes application behavior at the
adapter boundary only. It does not establish live Retell onboarding, agent or
phone-number configuration, credentials, real call delivery, or production
readiness.

## 5. Mounted read boundaries

The canonical router is mounted at `/api/v1/canonical` and provides:

- status, graph, snapshot, aggregate dashboard, and aggregate analytics reads;
- surface projections for `customer-detail`, `leads`, `communications`,
  `calendar`, `command-center`, `polaris`, `executive`, and `estimates`; and
- compatibility projections with the same PostgreSQL source.

`src/routes/canonicalPolaris.js` reads completed organization-owned graphs and
projects persisted values. Its output includes authority context, graph and
snapshot identities, calculation and Business Profile provenance, timestamps,
and digests. A genuinely empty tenant has an explicit `no_canonical_data`
state. Missing PostgreSQL authority returns a bounded unavailable response
instead of stale or fabricated success.

The compatibility router keeps established read shapes available under paths
such as `/api/v1/customers`, `/api/v1/analytics/*`, and selected
`/api/v1/polaris/*` GET endpoints. These are adapters over canonical
PostgreSQL projections, not a second datastore or calculator. Unsupported
legacy mutations return `LEGACY_AUTHORITY_READ_ONLY`; retired legacy authority
returns `LEGACY_AUTHORITY_RETIRED`.

In particular:

- `GET /api/v1/polaris/recommendations` projects persisted snapshot actions;
- `GET /api/v1/polaris/learning` is a compatibility read of persisted
  snapshots, not an automatic training pipeline;
- `GET /api/v1/polaris/retell-context` is a tenant-scoped calendar projection,
  not proof of a live Retell integration; and
- there is no mounted canonical ChatGPT query or Polaris chat service. A UI,
  placeholder, historical path, or future design does not create that
  authority.

## 6. Browser and mounted-page behavior

`public/js/canonical-intelligence.js` requests canonical surface projections,
validates their tenant/user/session authority and provenance, rejects stale or
contradictory responses, and clears alternate consumers after rejection.
Browser storage is limited to session identity coordination and presentation
theme state; it is not a business projection authority.

The seven Mission 19 Part 3 ratified pages are Customer Detail, Leads,
Communications, Calendar, Command Center, Polaris, and the legacy dashboard
mount. They consume the same canonical graph through server projections.

Despite its historical name, `public/js/polaris-engine.js` is now a
presentation selector for persisted canonical snapshots. It does not calculate
a new quote. `public/js/polaris-api.js` and
`public/js/polaris-m13-bridge.js` are likewise compatibility/presentation
adapters over `CanonicalIntelligence`.

## 7. Legacy and non-authoritative artifacts

Historical files under `src/polaris/`, including the JSON-backed
`src/polaris/store.js`, learning code, recommendation code, and several
`*-engine.js` modules, are not loaded by the normal `src/server.js` dependency
graph. Tracked `data/polaris-*.json` files are not canonical production
storage. Their presence is historical/compatibility residue and grants no
runtime authority.

The former mounted `src/routes/polaris.js` and central
`src/polaris/engine.js` authorities have been retired. Broad legacy paths are
intercepted by `src/routes/legacyAuthorityRetirement.js` after supported
canonical compatibility reads have been registered.

Do not add a new consumer of a historical module or JSON file without a
separate architecture decision, tenant/persistence analysis, tests, and
review. Compatibility code may reshape canonical values but must not calculate,
persist, or silently recover an alternate value.

## 8. Current, deferred, and future capabilities

### Current mounted behavior

- PostgreSQL-authoritative tenant graphs and immutable Polaris snapshots
- deterministic Business Profile-based calculation
- explicit unavailable/not-calculated semantics
- persisted rule-based recommended actions and aggregate analytics
- tenant/session-scoped canonical and compatibility reads
- presentation-only browser projections across the ratified surfaces
- narrow canonical simulation and voice ingestion boundaries

### Not established as current authority

- automatic retraining from every completed job
- machine-learning model training or prediction updates
- autonomous scheduling, dispatch, route optimization, or crew assignment
- a mounted ChatGPT query interface
- live Retell provider readiness or real-call acceptance
- cross-provider production configuration or credentials

Multi-crew intelligence, autonomous operations, new AI interfaces, and any
self-learning design are future work unless a later separately reviewed and
released change establishes them. Future plans must not be described as
production behavior in this document.

Stripe billing, recording/AI-identity/legal review, and post-Mission-19 UI
requests are outside this architecture correction.

## 9. Evidence and readiness boundaries

Executable authority evidence is maintained in the existing Mission 19 Part 3
unit, ratification, API, integration, and browser suites, including:

- `tests/ratification/m19-part3-production-startup-authority.test.js`
- `tests/ratification/m19-part3-authority-containment.test.js`
- `tests/unit/m19-part3-canonical-calculation.test.js`
- `tests/api/m19-part3-canonical-api-postgres.test.js`
- `tests/browser/m19-part3-cross-page-matrix.js`

The detailed historical implementation and validation ledger is retained in
`docs/m19-part3-canonical-authority-deployment.md`. Its commit ids, environment
versions, provider observations, PR state, and release observations are
time-specific evidence, not permanent readiness claims.

Local PostgreSQL and intercepted-provider tests do not prove production data,
production migration readiness, Railway deployment readiness, or provider
onboarding. Playwright WebKit is not physical Safari. GitHub Actions evidence
exists only when actual workflow/check runs exist; zero runs are unavailable,
not passing.

Any later claim of live provider or production readiness requires its own
authorized preflight, provider/deployment evidence, independent review, and
release acceptance.
