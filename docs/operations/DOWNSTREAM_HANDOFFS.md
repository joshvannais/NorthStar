# Mission 23 Part 11 — Downstream reference handoffs

This candidate records an explicit, immutable internal handoff for future review.
It does not release or implement Missions 24–32. Independent exact-head review,
production migration/recovery approval, release and founder visual review remain
separate from writer evidence.

## Authority and user workflow

Current owners and administrators open **Downstream handoffs** in the existing
completion-review page, review the current reference counts, select one purpose,
and explicitly consent before saving. Changing the purpose clears the checkbox.
The server reloads current authority and source versions before committing.
Receipt history is a separate disclosure. Revocation requires an explicit review
and confirmation; it appends a receipt rather than changing prior history.

The audience is `tenant_owner_admin_review`. Consent version
`m23-internal-reference-consent-v1` permits saving and reviewing reference pins
inside that tenant. It does **not** authorize a downstream consumer, external
disclosure, raw evidence access, learning, aggregation, automation, customer
action or financial action. Consent is individually attributed to the current
account, access role and durable session. All destinations remain delivery-
unavailable and `consumptionAuthorized: false`.

| Mission | Selected future purpose | Boundary preserved now |
| --- | --- | --- |
| 24 | Estimating | Source references only; human price/quote authority remains separate. |
| 25 | Private learning | No learning or aggregation; future use must validate exact permitted versions and correction/tombstone propagation. |
| 26 | Business intelligence | No metrics/prediction engine; future predictions cannot become facts. |
| 27 | Customer lifecycle | No contact, acceptance, invoice or payment. |
| 28 | Business automation | No active trigger, delivery, worker or action. |
| 29 | Enterprise governance | No new roles, delegation or cross-tenant authority. |
| 30 | NorthStar OS | Existing authorities retain their identities and ownership. |
| 31 | Interactive experience | Explicitly unavailable for real operational references. Synthetic-only isolation is mandatory. |
| 32 | Estimate Studio | Future draft inputs only; no calculation, quote or conversion is activated. |

These are handoffs of **immutable source references**, not copies of raw facts.
No worker identity, note, transcript, file URL/content, cost, margin, customer
contact or provider payload is included in the saved snapshot. A future mission
must implement and audit authorized resolution against the source revision,
digest, current permission, retention and consent before using any actual facts.
The receipt is never a capability token or authority to resolve a record.

## Mounted contract

- `GET /api/v1/field-executions/:executionId/handoffs` returns a current complete
  bounded source-reference preview and bounded receipt history.
- `POST /api/v1/field-executions/:executionId/handoff-actions` records `prepare`
  or `revoke` with exact keys: `action`, `mission`, `audience`, `consentVersion`,
  `consentConfirmed`, `sourceDigest`, and `targetId`. The existing raw UTF-8 JSON
  boundary, duplicate-key rejection, no compression, 32 KiB request limit, current
  CSRF authority and internal per-tenant/individual availability limit apply.
- `Idempotency-Key` is 16–128 ASCII letters, numbers, dots, underscores, colons or
  hyphens. Only its SHA-256 is stored. Tenant + individual + key identify a replay;
  changing the execution or any consent/request field conflicts.
- Both HTTP and PostgreSQL independently restrict the audience to current owner
  or administrator authority. Current membership, individual account, workforce,
  durable session, eligible assignment/record, positive production transcript,
  onboarding and subscription checks run before disclosure and exact replay.
  Current actor/work checks are never replaced by historical receipt ownership.

Migration 056 stores append-only preparation and revocation receipts, source and
request digests, session/actor attribution and digest-bound timestamps. It uses
the existing ordered supporting-authority/work locks, current completion read
gate, digest function and canonical identities. It writes no operational source.
The runtime can execute only the two new guarded entries, with no direct table
or helper access. Startup grants and verifies this boundary transactionally.

The source snapshot pins execution and current assignment revisions/digests,
every bounded labor/material record, progress/field-evidence/completion history
record, and equipment event. Append-only history includes corrections, rather
than treating a visible predecessor as the current authoritative fact. Each
domain has an exact ordered source-set digest. Individual values stay at their
original authorities. Lifecycle remains an explicit recorded lifecycle, never
inferred completion or commercial acceptance.

Any changed source set makes prior preparation `source_changed`; revocation
takes precedence. Reads retain historical receipt digests without replacing
their saved source snapshot. Replaying an old successful request confirms the
original receipt only and cannot restore revoked consent, make stale references
current or authorize consumption. Future consumers must enforce this same
currentness/consent boundary and propagate corrections/tombstones before use.

## Bounds and retry disposition

There are at most 1,000 references per source domain and 256 KiB per complete
snapshot. Exceeding either bound returns unavailable/limit evidence; no truncated
set is silently accepted. A source-bound failure still returns authorized receipt history and permits revocation and exact historical replay; it cannot enable preparation. At most 50 preparations and their 50 revocations are
stored per execution. Revocation remains available at the preparation limit.
HTTP response parsing is bounded to 512 KiB. SQL statements are limited to five
seconds, lock waits to two seconds, idle transactions to five seconds and complete
transactions to ten seconds. Reads use repeatable-read snapshots; the existing
material fence requires `FOR SHARE`, so these semantically read-only operations
cannot use PostgreSQL's `READ ONLY` transaction flag. Writes are serializable.
The repository retries only uncommitted serialization/deadlock failures, at most
three attempts; stale source pins are never automatically changed.

No delivery transport exists, so an outbox or delivery worker would prematurely
implement a later mission. Receipt creation and its replay identity commit in
one transaction. The browser retains one exact pending request in memory and
offers an explicit same-key retry after a lost response. It clears displayed
source/receipt data on denial, offline failure or invalid response; a confirmed
write followed by a failed refresh is stated separately. Browser state is not
durable consent authority. No external call, provider setting or background job
is created or activated.

## Migration compatibility and recovery

056 adds one new table, two indexes, an immutable-history trigger and six new
functions. Every preceding migration file remains byte-for-byte unchanged. No
backfill or rewriting of existing rows is performed. Fresh initialization and an
upgrade from the exact preceding schema use the production migration runner and
separate owner/runtime roles. A synthetic failure after 056 in that transaction
rolls back the entire new schema and ledger change; a subsequent ordinary start
applies 056 once, and the next start is zero-op with unchanged ledger timestamps.

**An old application cannot simply be restarted after 056.** Its migration
inventory lacks the applied 056 source and the accepted runner rejects that
missing source before runtime grants. This fail-closed behavior is tested. Do
not remove the 056 ledger row/table or destroy receipt history to make an old
binary start. Recovery is a reviewed forward fix that retains the new migration
source and authority grants. No destructive downgrade or production rollback is
authorized by this candidate.

Production backup/access evidence, exact pre-migration history, deployment
coordination, first application and later-start reconciliation belong to the
coordinator's separate gate. Local interruption recovery is not production
backup/restore evidence.

## Evidence and unavailable claims

The new mounted tests exercise ordinary consent, all permitted purposes, source
change, revocation, exact-key concurrency, role/tenant/session/CSRF gates, bounded
history, immutability, no operational mutation, migration upgrade, interruption
recovery and zero-op restart. Chrome and actual Playwright WebKit use real local
HTTP/PostgreSQL and ordinary desktop/mobile, light/dark, keyboard/reflow flows.
Denied/offline responses and a lost POST response are explicitly identified
interceptions after a real mounted success. Provider transports remain blocked.

The separate sealed writer packet retains exact commands/counts and all original
failed attempts. Inherited Part 10 wider-corpus evidence remains 636/651 with 15
exact-base failures; this candidate does not silently convert that to all green
or rerun unrelated suites to conceal it. Hosted CI, physical Safari/devices,
manual assistive technology/native zoom, live providers, production/private-data
workflows, production backup/restore and founder personal visual approval are
not claimed by writer tests. Part 12 retains mission-wide acceptance ownership.
