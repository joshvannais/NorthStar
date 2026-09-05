# Mission 23 Part 6 independent-audit correction log

Audit target: draft PR #170 at exact head
`78906517ffae3de3f0dc4678640675988baab259`.

The external report was read from the immutable handoff artifact
`pr170-audit-artifacts-7890651-20260905/report.md`; its verified SHA-256 was
`5d3a514167ade5d9820fe8e634186ec52ad7f9214964a5bc100e883e6e403687`.
The report returned `CHANGES_REQUIRED` with exactly two reportable findings.

## P2: retry could destroy accepted evidence

- The deterministic session/idempotency-derived object ID was removed.
- A serializable PostgreSQL reservation now validates the complete request and
  current authority before any storage call. It issues database-owned opaque
  reservation, object and immutable generation identities plus a hashed claim.
- Exact accepted replay returns the canonical stored response without provider
  mutation. Conflicting and active concurrent use fails before provider mutation.
- Expired pending work receives a new object and generation. Cleanup is accepted
  only through the provider's required generation-scoped contract, so cleanup
  for failed work cannot name an accepted generation.
- The final record, event, audit, idempotency receipt and reservation acceptance
  remain one serializable transaction.

## P3: accessibility gate absent

- Uploads require one canonical state: `described`, `unavailable`, or
  `needs_review`.
- A described image requires bounded inert description text. Unavailable and
  needs-review states require a bounded inert reason and prohibit an invented
  description.
- Accessibility is included in the pre-storage request digest, immutable record
  and canonical digest, event/audit/idempotency chain, retrieval authorization
  and access event.
- Correction is append-only and changes only accessibility metadata; object,
  generation, storage version, content digest and retention evidence remain
  immutable. No UI was added.

This correction does not claim live storage, malware clearance, accessibility
approval, consent/legal compliance, merge, deployment or release. A different
fresh read-only auditor must inspect the exact corrected head.

## P2 follow-up: unknown COMMIT outcome and hard-crash orphan

A fresh re-audit of corrected head
`050555b309dd0a801ca87b859282c8609e588a74` retained one P2. The immutable
report was read from
`pr170-reaudit-artifacts-050555b-20260905/report.md`; its verified SHA-256 was
`cb0c74b08642b7b04ab536484eb2696812c2ddf54b82fd287a9ca63e146f75ba`.

- Every issued reservation/object/storage generation is now retained in an
  append-only tenant-scoped generation ledger; takeover no longer erases the
  prior reconciliation pointer.
- A fresh serializable reconciliation entry point reauthorizes current
  actor/session/execution/assignment authority, serializes on the idempotency
  key, and returns accepted replay before considering cleanup.
- Current unaccepted work is fenced as `cleanup_pending`. Only a database-issued
  hashed cleanup claim can reach generation-scoped provider deletion, and
  cleanup confirmation rechecks that no immutable accepted record references
  the generation before appending one tombstone.
- Expired takeover emits bounded cleanup claims for retained unaccepted
  generations. Provider deletion is required to be generation-scoped,
  database-fenced and idempotent, so interruption before confirmation is safely
  retryable.
- If COMMIT or reconciliation outcome is unknown, bytes are retained. A real
  PostgreSQL commit-then-throw test proves accepted bytes survive and exact retry
  returns the stored canonical response.

The skill-required fresh read-only bypass reviewer found no actionable defect in
the correction. That review is not the independent exact-head release audit.
Real provider behavior remains unavailable and is not claimed.

## P2 follow-up: request telemetry blocked replay and takeover

A fresh independent audit of exact head
`1dac74a0eeb7ce869a3d19b5064710807ba84287` returned one P2. The sealed report
was read from `audit-evidence-pr170-1dac74a0/report.md`; its verified SHA-256 was
`7a4b4891e7a1b55b8e8ca494dd1c911187cca838d73636d10c1f309606270a67`.

- The semantic upload request digest already excluded correlation telemetry;
  the redundant existing-reservation comparison now does the same.
- An active exact retry with a different server-generated request ID remains
  `M23_FIELD_UPLOAD_IN_PROGRESS`, while a changed semantic request remains an
  idempotency conflict.
- Expired takeover records the new attempt's correlation ID and resets the new
  reservation/generation/claim state to `pending`. Final registration therefore
  binds telemetry to the current attempt while stale prior workers remain fenced
  by their old reservation, generation, object and claim identities.
- Accepted retry returns the original immutable response across a new request
  ID without provider mutation. Expired retry issues the new generation and
  cleanup claim required to reconcile the prior orphan.

No provider, UI, Part 7+, production, merge or deployment scope was added.
