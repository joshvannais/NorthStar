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
  derived from and database-bound to one canonical UTF-8 representation; missing required
  fields fail closed.
- Every committed version has at least one linked provenance row and one matching audit event.
- Version, provenance, audit, and entry identity rows reject update and delete operations.
- Initial draft creation requires an active owner or administrator membership and writes the
  entry, version, provenance, and audit record atomically.
- Reads require an active tenant membership and cannot reveal another tenant's records.
  Members and viewers may retrieve only standard public/internal versions; protected,
  high-risk, and attorney-gated content requires an active owner or administrator.
- No HTTP route, browser control, provider transport, publication pointer, generated content,
  or external synchronization is introduced in Part 1.
