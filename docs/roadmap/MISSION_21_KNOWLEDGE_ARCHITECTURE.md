# Mission 21 — Provider-Agnostic Knowledge Architecture

Mission 21 turns NorthStar's verified operating authorities into a tenant-scoped,
versioned knowledge system. NorthStar remains the authority. A voice, AI, search,
or integration provider may receive a minimized projection of an explicitly
published version, but never becomes the source of truth.

## Non-negotiable boundaries

- Mission 20 Business Profile and normalized authorities remain authoritative inputs.
- Knowledge never authorizes tools, schedules work, finalizes a price, activates a
  provider, supplies credentials, or makes a legal/recording decision.
- Missing, conflicting, stale, or unsupported facts become `needs review`; they are
  never invented.
- Every record is tenant-scoped and every human action is tied to an active individual
  organization membership.
- Authorization and sensitivity filtering happen before retrieval, ranking, projection,
  or provider transport.
- Published content is immutable. Correction and rollback create new versions.
- Provider synchronization is outbound, minimized, idempotent, observable, and cannot
  feed provider mutations back into canonical authority.

## Serialized delivery

1. **Canonical model and persistence foundation** — stable entry identities, immutable
   versions, deterministic bounded documents and digests, provenance links, audit events,
   and tenant/actor constraints. No routes, generation, publication, or provider calls.
2. **Deterministic generation and provenance** — adapters from Business Profile and other
   normalized NorthStar authorities, explicit precedence, conflict/missing detection, and
   reproducible drafts without invented facts.
3. **Draft, review, approval, and publish** — role-authorized review, attorney-gated/high-
   risk approval, stale-write protection, diffs, and atomic publication of exact versions.
4. **Immutable lifecycle** — append-only version history, concurrent revision control,
   tombstones, and rollback-as-a-new-version with actor/source/reason/time/digest evidence.
5. **Retrieval and provider-neutral projection** — authorization filtering before ranking,
   audience/consumer minimization, exact published-version pinning, preview, capability and
   size limits, and deterministic projections.
6. **Transactional synchronization** — outbox, per-tenant ordering/locking, deduplication,
   bounded retry/dead letter, desired-versus-observed state, last-known-good, drift,
   staleness, and reconciliation without partial publication or feedback loops.
7. **Knowledge management experience** — accessible, responsive draft/review/publish,
   provenance, version, diff, and reconciliation UI integrated with the existing Settings
   and Business Profile structure rather than adding another isolated destination.
8. **Mission-wide acceptance** — fresh and upgraded PostgreSQL 18.4 UTC, deterministic
   digest/concurrency/restart/failure/tombstone tests, tenant and role isolation, hostile
   stored-content tests, mounted provider interception, Chrome and actual WebKit, then a
   fresh independent exact-head audit and serialized production release.

## Part 1 acceptance contract

Part 1 is complete only when all of the following are true:

- Migration 025 creates only the canonical entry, immutable version, provenance, and audit
  authorities; it does not copy or infer knowledge from legacy text or Business Profile.
- Entry keys and types are stable and tenant-unique.
- Version documents are deterministic, bounded, top-level objects whose SHA-256 digest is
  derived from and database-bound to one recursively rendered, UTF-8 byte-ordered canonical
  representation; alternate equivalent JSON bytes and missing required fields fail closed.
- Every committed Part 1 version has at least one linked provenance row and an initial-draft
  audit event whose actor, reason, digest, and version number match the version row.
- Version, provenance, audit, and entry identity rows reject update and delete operations.
- Initial draft creation requires an active owner or administrator membership and writes the
  entry, version, provenance, and audit record atomically.
- Reads require an active tenant membership and cannot reveal another tenant's records.
  Members and viewers may retrieve only standard public/internal versions; protected,
  high-risk, and attorney-gated content requires an active owner or administrator.
- No HTTP route, browser control, provider transport, publication pointer, generated content,
  or external synchronization is introduced in Part 1.

## Part 2 acceptance contract

Part 2 is complete only when all of the following are true:

- Generation begins only after an active owner or administrator membership is authorized;
  source rows are then read inside the same serializable transaction that commits the drafts.
- The exact active canonical Business Profile row is pinned by ID, version, normalized-profile
  hash, and a digest of the complete raw/normalized snapshot. Its embedded and stored normalized
  hashes are independently recomputed before any draft write.
- Normalized workforce and asset-catalogue snapshots include only the bounded capability fields
  needed for knowledge generation. Personal contact data, asset serial numbers, VINs, provider
  credentials, and live operational state are not copied into generated knowledge.
- Generation has one versioned, digest-bound contract and an explicit precedence order. A raw
  configured Business Profile fact must agree with its same-version normalized projection before
  it is promoted. Missing, conflicting, orphaned, malformed, or oversized evidence fails closed or
  is represented as deterministic `needs_review`; no default or fact is invented.
- Generic JSON shape validation is followed by the complete operational and canonical Business
  Profile semantic validators before any dependency digest or draft is created. Empty arrays and
  objects are missing evidence unless a future versioned field contract explicitly defines an
  empty collection as meaningful.
- Dependency digests recursively normalize source keys and strings to NFC. The exact stored and
  embedded Business Profile hash is verified first; the knowledge dependency bytes then include
  the complete canonical raw profile and normalized projection with its derived `hash` field
  replaced by a canonical projection digest, so equivalent Unicode cannot change draft identity.
- The same source snapshot produces the same seven sorted canonical draft documents and digests:
  identity, availability, services, customer/workforce guidance, financial constraints,
  operational capabilities, and provider-neutral voice guidance.
- Every generated version includes exact Business Profile/workforce/asset/system-generation
  provenance as applicable. The seven entry/version/provenance/audit graphs commit atomically; a
  duplicate key, source-integrity failure, authorization failure, or serialization conflict leaves
  no partial batch.
- Financial and operational-capability drafts are restricted and high-risk. Customer/workforce
  policy and voice-guidance drafts require high-risk review. Part 2 does not approve, publish,
  retrieve for consumers, authorize tools, call a provider, expose an HTTP route, or add UI.

## Part 3 acceptance contract

Part 3 is complete only when all of the following are true:

- Review and publication writes require an active individual owner or administrator membership;
  browser roles, request claims, provider state, and shared credentials never authorize them.
- Submission pins the latest exact entry/version number, immutable version ID, canonical digest,
  current publication base, deterministic canonical diff, actor, reason, and time. An expected
  review-event ID protects every decision from stale or repeated writes.
- Review snapshots, review decisions, external attorney-review evidence records, publications,
  and their audit evidence are append-only and tenant-scoped. Every direct database write must
  satisfy the same exact-version, state-transition, membership, digest, and audit constraints.
- Standard, high-risk, and attorney-gated versions use distinct approval actions. Attorney-gated
  approval additionally requires a bounded reference, timestamp, and SHA-256 digest for external
  attorney-review evidence; NorthStar records that evidence but does not make a legal conclusion
  or store the legal document in canonical knowledge.
- A generated document whose content state is `needs_review` cannot be approved or published.
  A changes-requested or otherwise terminal review cannot be bypassed for the same immutable
  version; correction requires a later version under the Part 4 lifecycle contract.
- Publication is one serializable transaction that pins the latest exact approval event, version,
  digest, reviewed diff base, previous publication, publication number, actor, reason, and audit
  event. The publication record is append-only; no provider projection or synchronization occurs.
- Part 3 adds no HTTP route, browser UI, provider mapping/call, tool authorization, scheduling,
  pricing decision, recording/AI-identity language, credential, or production configuration.

## Part 4 acceptance contract

Part 4 is complete only when all of the following are true:

- Every later version requires an active individual owner or administrator and pins the exact
  latest parent by tenant, entry, immutable version ID, version number, and canonical digest
  inside the same serializable transaction that writes the next version.
- Database authority independently locks the entry and requires an unbroken, gap-free parent
  chain. A stale parent, duplicate version number, serialization conflict, authorization change,
  or malformed direct write leaves no version, provenance, or audit residue.
- A revision is a non-empty canonical document change with exact parent provenance plus at least
  one bounded change-source link. It cannot disguise a tombstone or revise a tombstoned head.
- A tombstone is a deterministic, non-destructive new version whose content state is exactly
  `tombstoned`. It preserves the prior label, sensitivity, review requirement, and applicability,
  and records the exact parent as its only source; repeated tombstones fail closed.
- Rollback never moves or mutates a version/publication pointer. It creates a new version that
  exactly copies a selected earlier non-tombstone document, pins both the current parent and the
  rollback target, rejects no-op or forward targets, and records both as exact provenance.
- Initial, revised, tombstoned, and rollback-created versions have distinct reciprocal audit
  actions. Actor, reason, database-owned time, version number, parent/target IDs, digest, and
  provenance must identify one exact immutable graph for repository and direct database writes.
- Creating a later version does not change the current publication. Revisions, tombstones, and
  rollbacks remain drafts and must pass the existing exact-diff review, approval class, and atomic
  publication workflow before later consumers may observe them.
- Complete lifecycle history is append-only and owner/admin readable with version, parent,
  rollback target, canonical digest, provenance, actor, reason, action, and time evidence. Existing
  sensitivity rules for exact-version reads remain in force.
- Part 4 adds no HTTP route, browser UI, retrieval/ranking, provider projection/synchronization,
  tool authorization, scheduling, pricing decision, recording/AI-identity language, credential,
  or production configuration.

## Part 5 acceptance contract

Part 5 is complete only when all of the following are true:

- Every preview begins with one active individual tenant membership inside a serializable,
  read-only PostgreSQL snapshot. Voice-runtime and integration-adapter previews require an owner
  or administrator; search and assistant previews still apply the existing exact sensitivity and
  review-class rules for the active member before selecting any knowledge row.
- Retrieval reads only append-only publication records joined to their exact immutable versions.
  Latest selection pins the highest publication number per entry, exact-pin replay requires the
  tenant-scoped publication ID/number, version ID/number, and canonical digest to agree, and a
  newer unpublished draft is never observable.
- Consumer, audience, capability, and supported applicability filters are explicit and bounded.
  Customer projections cannot request financial or operational-capability knowledge. Customer
  identity, availability, service, guidance, and voice content is field-minimized; private contact,
  precise-location, routing, scheduling, pricing/cost, and workforce-policy fields do not enter the
  customer projection or its ranking text.
- Tenant/role/sensitivity authorization is enforced in the publication query before rows are
  retrieved for ranking. Applicability and audience minimization happen before query ranking, so
  unauthorized or excluded content cannot affect a score, source pin, count, or projected item.
- Projection output is provider-neutral, deterministic, recursively canonical, and digest-bound.
  It names the tenant, consumer, audience, requested capabilities, selection mode, exact sources,
  missing capabilities, bounded items, query digest when applicable, and truncation state without
  making a provider authoritative.
- External-bound previews are complete-or-fail and bounded by consumer-specific entry and UTF-8
  byte limits. Search and assistant retrieval may return bounded ranked subsets. Exact-pin mismatch,
  integrity failure, unsupported capability, malformed applicability, incomplete external content,
  or oversized output fails closed with no partial transport.
- A published tombstone projects only a deterministic deletion marker and its exact publication
  pin; it never copies removed content. A later reviewed and published rollback is observed as its
  own new exact publication while historical pins remain replayable.
- Stored markup, URLs, prompt instructions, and hostile Unicode remain inert data. A projection
  never authorizes a tool, schedule, final price, legal/recording statement, provider activation,
  credential, or provider mutation.
- Part 5 adds no migration, HTTP route, browser UI, provider SDK or network call, synchronization
  state, outbox, retry, production configuration, or secret. Those transport and reconciliation
  authorities begin only in Part 6 after a Part 5 projection has been independently accepted.
