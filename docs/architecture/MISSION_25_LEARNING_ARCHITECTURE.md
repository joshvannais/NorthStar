# Mission 25 tenant-private learning architecture

Status: root contract accepted in Mission 25 Part 1. Part 2 releases the bounded labor-duration observation described below; provider imports and broader calibration remain unimplemented.

## First runtime source

The initial source is a paid-tenant, completed-job comparison between an adopted Mission 24 labor plan and accepted Mission 23 labor intervals. It requires explicit owner/admin purpose consent, pins the complete source manifest, computes a deterministic advisory, and keeps application outside this package. Corrected source records invalidate the current advice; revoked consent prevents further use and suppresses derived values from guarded reads. Demo records and cross-tenant data are rejected.

## Canonical identities

A future learning observation identifies one tenant, one reconciled job/outcome identity, one source class, the exact immutable source references and digests, the source schema/version, the permission/consent decision, observation time, freshness state and correction lineage. A derived calibration identifies the complete observation set and algorithm/policy version that produced it.

The learned value is a versioned tenant-private proposal. It never mutates its input facts, silently replaces a business-profile policy, changes an estimate, contacts a customer or triggers work. A currently authorized human must use the owning mission's reviewed workflow to adopt a proposal.

## Source admission

An input is admissible only when all of the following hold:

1. current tenant and individual access permits the exact purpose;
2. the source version and digest still match the authoritative record;
3. the source's retention, revocation and deletion state permits use;
4. entity reconciliation is unambiguous enough for the stated calculation;
5. units, currency, time zone and observation interval are explicit;
6. freshness and evidence status meet that calculation's policy;
7. the complete bounded source set is available, without silent truncation.

A Mission 23 downstream handoff receipt is a reference and consent history record. It is not a capability token and does not by itself authorize Mission 25 to resolve or learn from the referenced evidence. Customer acceptance proves acceptance of one issued estimate version; it does not prove completion, payment, profitability or customer satisfaction. Operational completion proves the recorded completion decision; it does not prove invoicing, collection or margin.

## Reconciliation and provenance

Provider-neutral imports first retain an immutable minimized source envelope and sync-run identity. Deterministic reconciliation links it to canonical customer, job, estimate, execution, asset, worker, material and financial identities. Low-confidence or conflicting links remain unresolved and excluded from consequential calibration.

Every projection explains:

- which exact records were included and excluded;
- which values were known, inferred, stale, conflicting or missing;
- the unit/currency/time normalization;
- the observation window and sample count;
- the comparison baseline and resulting variance;
- the policy/algorithm version;
- the source corrections or deletions that would invalidate it.

## Correction, revocation and deletion

Learning dependencies form a directed lineage graph. A corrected source appends new authority and makes affected observations stale. A revoked permission immediately blocks new use. A source tombstone or applicable deletion request makes dependent observations unavailable and queues bounded recomputation or removal under the governing retention policy. Historical outputs may retain a non-sensitive audit receipt only when authorized; they cannot retain deleted raw values through a derived cache.

Retries reuse the same tenant, source identity, version, purpose and request digest. Changed input under one idempotency key conflicts. Backfills and continuous updates use bounded cursors and checkpoints, detect duplicates, and can resume without double-counting.

## Isolation and aggregate boundary

Tenant-private parameters, observations, asset condition, worker performance, costs, prices, histories and source payloads are never readable or inferable by another tenant. Shared reviewed knowledge from Mission 21 remains separate from tenant outcomes.

Cross-tenant aggregation, benchmarking or model improvement is disabled by default. A future package must define separate legal/permission authority, contribution eligibility, privacy protection, minimum cohort and anti-reidentification controls, deletion/correction propagation, tenant opt-in/out behavior and red-team evidence before any aggregate result exists.

## Accuracy and action boundary

Learning can reduce uncertainty; it cannot guarantee a truthful future price from weak evidence. It reports sample size, dispersion, freshness and applicability. Small, biased or incomplete samples remain advisory or unavailable. Mission 26 owns forecasts and probability distributions. Mission 28 owns automated application. Mission 25 does not let an algorithm silently update rates, crew standards, utilization, price, schedule or customer commitments.

## Required acceptance for runtime packages

- exact source/version/digest and tenant binding;
- current role, session, consent, purpose and retention enforcement;
- complete-set bounds and fail-closed truncation behavior;
- duplicate, replay, concurrency, resume and partial-failure behavior;
- correction, tombstone, revocation and deletion propagation;
- deterministic rerun and explicit algorithm/policy version;
- cross-tenant and demo/paid isolation;
- readable owner-facing source, confidence, variance and adoption consequences;
- recovery from the last released schema and one-time migration application;
- independent exact-head audit, normal merge, automatic deployment and health.
