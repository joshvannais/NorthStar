# Mission 23 Part 8 — Completion and reopening authority

Implementation writer candidate only. Independent exact-head audit, normal
merge, deployment, production migration verification, health, and release
remain separate gates. The exact released base is
`fce4000f22c08f5f74712d37439286a4c601b1a7` (Part 7, PR #171).

## Meaning and boundaries

Completion is a separately authorized operational decision. It is never
inferred from appointment status, elapsed time, a completed quantity, a
checklist response, an inspection, a file, an AI recommendation, a provider
callback, an invoice, or payment. The API always returns
`completionInferred: false` on its read projection.

This part extends the canonical field-execution lifecycle with
`completion_pending`, `completed`, `reopened`, and `cancelled`. It does not
rewrite the Mission 22 appointment or assignment. It creates no customer
acceptance, signature, quote, change-order approval, price, purchase, invoice,
payment, refund, warranty, permit, professional conclusion, regulatory
conclusion, customer contact, scheduling mutation, or downstream handoff.
There is no rendered UI, browser-state authority, provider call, new
dependency, or file-storage enablement in this part. Parts 9–12 and every
Mission 24+ consequence remain reserved to their own gates.

## Explicit actions and role authority

All actions require exact current execution and assignment revision/digest
preconditions, one printable 16–128 character idempotency key, a current signed
session, CSRF on mutation, a bounded inert reason, and current tenant/work
scope. PostgreSQL independently reloads the actor, account, membership,
workforce profile, subscription/trial, onboarding, assignment/crew, dispatch,
appointment, accepted non-demo transcript source, and execution authority.

- `propose_completion` moves `in_progress`, `paused`, or `reopened` to
  `completion_pending`. An assigned member may propose; owner/admin may propose
  tenant-wide within current authorized scope.
- `approve_completion` moves the exact pending proposal to `completed` and is
  restricted to owner/admin.
- `withdraw_completion` resolves a pending proposal and returns to the exact
  lifecycle state from which it was proposed. The member who proposed it, or
  owner/admin, may withdraw it.
- `cancel_execution` explicitly moves an eligible non-completed execution to
  `cancelled`; owner/admin authority is required. Cancelling a pending proposal
  requires its exact current pin. Cancellation is not completion or a refund.
- `reopen_execution` moves the exact current `completed` decision to
  `reopened`, requires owner/admin and an explicit next action, and preserves
  the original approval unchanged.
- `resume_reopened` is a second owner/admin decision that moves `reopened` to
  `in_progress`. The older generic `resume` action cannot bypass this gate.
- `correct_completion` appends a bounded annotation to the exact current
  completion-history record. It does not change lifecycle state, prior bytes,
  or a prior decision's meaning, and requires owner/admin.

## Deterministic proposal and approval gates

A proposal stores the exact source and resulting execution pins, current
assignment pin, proposer and performer identities, session, reason, database
decision time, expiry, explicit requirements, and one deterministic gate
snapshot. Explicit requirements may pin up to twenty current records in each
of three classes:

- Part 6 checklist instances, whose every required item must have a current
  pass, observation, or measurement response;
- Part 6 inspection observations whose current result is `pass`; and
- Part 6 file evidence whose current quarantine disposition is
  `released_after_clean_scan` and whose retention has not expired.

The same snapshot commits to the complete current labor, material, progress,
field-evidence, and execution-used equipment sets by deterministic count and
digest. A proposal fails when any required pin is missing, stale, superseded,
or unsatisfied; a blocker/exception is unresolved; progress is `needs_review`
or disputed; a labor timer is open; labor or material needs review; used
equipment remains checked out or in recorded downtime; or current field
evidence needs review. Recorded equipment faults and expired files that were
not explicitly required remain visible summary counts; they are not silently
converted into professional safety, retention, or legal conclusions.

Approval reloads the exact proposal, current actor and work scope, current
execution and assignment, and recomputes the entire gate snapshot. It succeeds
only if the snapshot is byte-equivalent and every hard gate still passes.
Changed evidence, assignment, dispatch, scope, execution, proposal resolution,
or expiry rejects with no partial mutation. A proposal expires at a
database-owned instant greater than creation and no more than seven days later.
Expiry never auto-completes or auto-cancels; the expired pending proposal remains
truthfully readable until an authorized withdrawal or cancellation.

## Immutable history, replay, and concurrency

Every accepted action writes one immutable completion record, event, audit
event, and idempotency receipt in the same transaction. Every lifecycle-changing
action also writes the matching canonical field-execution event, revision,
audit, and receipt. Deferred database constraints require the complete evidence
set before commit. Completion records are capped at 2,000 per execution and
reads return at most the newest 200 with exact total/truncation state.

Corrections form an append-only root/predecessor revision chain with one
successor per predecessor. Approval and withdrawal/cancellation resolution have
one winner per proposal; reopening has one winner per completion. Existing
completion and field-execution receipt namespaces cannot collide silently.
Exact retry returns the original committed response only after current
actor/session/role/work-scope reauthorization; a changed request with the same
key conflicts. Revocation fails before cached response disclosure.

The repository acquires the released supporting-authority fence and one
tenant/execution session lock before opening a serializable mutation. Reads use
the same order with a shared tenant/execution lock and one repeatable-read
snapshot. PostgreSQL independently verifies those locks. Concurrent evidence
and completion writes participate in serializable source/execution dependencies;
concurrent proposal resolutions serialize to one accepted result. A failed
audit, invariant, constraint, or commit rolls back current state and every
evidence row.

## Mounted API and database authority

- `POST /api/v1/field-executions/:executionId/completion-actions`
- `GET /api/v1/field-executions/:executionId/completion`

The mutation route is inside the existing raw execution-body boundary: UTF-8
JSON only, 32 KiB maximum, no compression, duplicate keys, malformed escapes,
or ambiguous envelope. Unknown and extra authority fields fail closed. Both
responses are private and `no-store`; the read accepts no query parameters and
returns bounded history plus the current pending proposal and explicit expiry
state when present.

Only `canonical_completion_mutate` and `canonical_completion_read` are granted
to the separate nonprivileged runtime role. Completion tables and every helper,
trigger, DDL, role-assumption, and migration-ledger capability are withheld from
runtime and PUBLIC. Entry functions use fixed trusted search paths and
schema-qualified relations. Text is bounded NFC Unicode; markup, URL-like text,
controls, bidi/invisible ambiguity, and lone surrogates fail in both JavaScript
and PostgreSQL boundaries.

## Migration and release evidence

Migration 049 is additive; migrations 001–048 remain unchanged. Its exact Git
blob, byte count, and SHA-256 are sealed in
[MIGRATION_IDENTITY.md](../../outputs/m23-part8-writer/MIGRATION_IDENTITY.md).
The requirement map and local writer results are in the adjacent Part 8 writer
evidence directory.

Disposable PostgreSQL evidence is local writer evidence only. No production
database, Railway service, provider, private tenant rows, credentials, hosted
CI, or backup system was accessed. Production preflight, migration application,
later-start zero-op, health, and backup/restore remain unavailable until their
separately authorized release stages. Recovery permits only a separately
reviewed forward fix; no destructive down-migration or assumed-compatible old
application rollback is authorized.
