# Mission 23 Part 7 — Progress and issue facts

Writer candidate only. Independent audit, merge, deployment, and release gates
remain pending. The exact released base is
`6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9` (Part 6, PR #170).

## Meaning and boundaries

This is attributable operational evidence, not a second execution authority.
It attaches immutable revisions to the existing tenant-scoped field execution
and its exact current assignment/execution revision and digest pins. No new
execution lifecycle is introduced. The execution must currently be in progress
or paused; recording a fact while paused does not resume work.

Every projection says `commercialConsequences: false`,
`authorizationToContinue: false`, `executionLifecycleChanged: false`,
`professionalConclusion: false`, and `percentComplete: null`. A reported
request from a customer is merely the recorder's report of its source, never
customer identity verification or acceptance. Owner confirmation reviews the
operational record; it is not a quote, change-order, safety, or legal approval.

Nothing here creates or changes price, quotes, change-order approval, customer
acceptance, invoices, purchases, customer contact, permissions to continue,
scheduling, payroll, inventory balances, or downstream handoffs. There are no
provider calls, file-storage enablement, rendered UI changes, or new dependencies.
Parts 8–12 and all Mission 24+ authority remain reserved to their own gates.

## Versioned document contract

All documents use `m23-progress-facts-v1` and begin `needs_review`. Exact keys,
types, bounds, and vocabulary are checked independently in JavaScript and SQL.
Every record includes a description, raw offset-bearing observed instant, exact
current Business Profile time-zone identity/version/hash, and zero to twenty
same-execution Part 6 evidence pins. Raw observations and database-owned UTC
instants remain distinct. Future observations beyond five minutes, offset/zone
disagreement, and stale zone authority fail closed. Evidence links are actual
tenant-composite foreign keys with exact immutable revision/digest validation.

- Progress has an explicit per-performer `workKey`, quantity and/or milestone,
  plus `measured`, `estimated`, or `unknown` uncertainty. Non-measured evidence
  requires a reason. Unknown evidence cannot invent a quantity or a completed
  milestone. A milestone has its own key/state and optional pinned Part 6
  checklist evidence. A checklist link does not assert every item is complete.
- Quantity uses decimal strings, at most nine integer and six fractional digits,
  nonnegative completed and positive total, completed no greater than total.
  Units are `m23-progress-units-v1`: `ea`, `m`, `m2`, `m3`, `ft`, `ft2`, `ft3`,
  `yd3`, `kg`, `lb`, `l`, `gal`. There is no floating-point percent, implicit unit
  conversion, inferred quantity, aggregation across unlike work, or inferred
  completion when completed equals total.
- Blockers and exceptions retain category (access, weather, material, equipment,
  scope, quality, coordination, other), operational impact (prevents work,
  constrains work, no current constraint, unknown), reported severity (low,
  moderate, high, unknown), responsible active tenant follow-up profile and
  action, observed time, evidence, and state. These are reported classifications,
  not legal or professional safety conclusions.
- Field-change facts distinguish requested from observed scope difference,
  initiator/source description, affected work, and reported schedule/resource
  implications. Implications are inert descriptions, never scheduling commands
  or commercial consequences. Corrections preserve the former fact.

Text is bounded NFC Unicode. Ordinary international text is retained exactly;
controls, bidi/invisible ambiguity, lone surrogates, markup, and URL-like input
are rejected by both boundaries. Stored text is serialized as JSON, with no
rendering path added. Future Part 9 UI must render it as inert text.

## Actions, history, and review

`record_progress`, `record_blocker`, `record_exception`, and `record_change`
create roots. `update_progress`, `issue_state`, `correct`, and `review` require
the exact current unsuperseded record ID/revision/digest as well as current source
pins. One predecessor has at most one successor. Recorder and performer remain
separate; performer attribution cannot be replaced within a root. A worker may
record/review only their own currently assigned work; owner/admin may record on
behalf of a currently assigned performer, retaining both individual identities.

Progress updates may advance quantities without changing the unit/total basis.
Decreases, removing a measurement, or changing its basis require the explicit
`correct` action and reason. Issues begin open; open, investigating, and awaiting
follow-up may transition among one another or resolve. Resolution requires its
own description, observed instant, and nonempty exact Part 6 evidence pins.
Resolved issues may reactivate only to open; this is issue state, not Part 8
execution reopening. The original unresolved and resolved revisions remain.
Corrections cannot silently alter issue state or resolution history.

Review states are `needs_review`, `owner_confirmed`, `worker_acknowledged`, and
`disputed`. Owner confirmation requires current owner/admin authority. Worker
acknowledgment requires the actual performer. A new operational revision resets
review to needs review. Review itself is another immutable revision and grants
no authority outside this document.

## API, authorization, and deterministic storage

- `POST /api/v1/field-executions/:executionId/progress-actions` requires the
  production signed session, current tenant permission, CSRF, rate limiting,
  strict UTF-8 JSON boundary, printable 16–128 character Idempotency-Key, source
  pins, individual performer, and reason. Mutation bodies are capped at 32 KiB;
  individual canonical documents are bounded to 12 KiB at the API.
- `GET /api/v1/field-executions/:executionId/progress` permits only `limit` and
  `cursor`. Limit is 1–200 (default 50). Returned history, total, truncation, and
  latest-root unresolved/pending-review counts are explicit. No percentage or
  execution completion is inferred. Responses are private/no-store.

Only `canonical_progress_mutate` and `canonical_progress_read` are runtime
entrypoints. All progress tables and helpers are withheld from runtime/PUBLIC;
helpers use fixed search paths. Writes are serializable. Reads use bounded
repeatable-read transactions with the authority fence, not unguarded snapshots.
Session advisory locks for supporting authority and the tenant/execution key are
acquired in that order before the snapshot. Database functions independently
check the released MVCC fence and required work lock. Current session, account,
membership, subscription/trial, onboarding, assignment/crew, dispatch, execution,
and normalized non-demo transcript authority are checked before every write and
before returning any cached receipt. Source revision/digest drift blocks replay.

An exact retry returns the original committed body after current reauthorization;
a changed semantic request with the same key conflicts. Correlation IDs are
telemetry, not semantic identity. All revisions, events, audits, source links,
and receipts commit atomically, enforced by deferred completeness constraints.
Database-owned decision time is monotonic within the locked execution. The
cursor binds execution, original durable high-water time, and exact last row;
later inserts cannot enter subsequent pages. The execution history cap is 2,000
revisions, including reviews/corrections; after that, new writes return a bound
error while authorized exact retries and reads remain available. Raising this
limit requires a separately reviewed change, not deleting history.

## Migration and release evidence

Migration 048 is additive. See
[migration identity](../../outputs/m23-part7-writer/MIGRATION_IDENTITY.md) and
[requirement evidence](../../outputs/m23-part7-writer/REQUIREMENT_TO_EVIDENCE.md).
Local PostgreSQL tests are writer evidence only. No production database, Railway,
private rows, credentials, providers, or backup system was accessed in this work.
Backup/restore and production recovery evidence remain unavailable. Only a
separately reviewed forward fix is an available recovery disposition; no
destructive down-migration or unproven application rollback is approved.
