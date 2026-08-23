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
