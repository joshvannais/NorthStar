# Mission 23 Part 4 — Requirement-to-evidence ledger

## Frozen scope boundary

- Exact live base: `961245ebd12a28d2c7aa1c0b3e003530e4428f09`
- Base tree: `666a1a385a93a5baad31e77e2e5ed89d5ebd18ef`
- Branch: `mission23/part4-materials-inventory`
- Worktree:
  `/home/joshv/codex-writers/mission23-part4-materials-inventory`
- Scope: additive tenant-scoped material movement, usage, return, transfer,
  waste, adjustment, correction, reversal, review, and bounded-balance evidence
  tied to exact current Part 2 execution and Mission 22 assignment authority.
- Excluded: stock existence or warehouse truth; cost/value; procurement,
  purchasing, supplier, price, quote, invoice, payment, or profitability;
  provider/customer contact; scheduling mutation; Polaris; equipment/assets;
  files/media/notes/checklists/inspections; progress/blockers/changes;
  completion/reopening; UI; and Parts 5–12.

Part 3's separate later-start gate passed before Part 4 editing. Receipt head
`2abef4be3e31c2c468762598edc0e79859f67c2f` merged normally through PR #164
as `15c61f89e4dd52ae768f1d30d1d6a3808c2d7ec5`. Automatic Railway deployment
`2b498fe1-d025-4be7-bd90-cef6154f9bb8` supplied the later ordinary start with
no migration-application entry; the read-only ledger retained 39 rows, exactly
one unchanged checksum row for 039–041, their original common application
timestamp, and healthy canonical persistence. No private row, credential,
provider mutation, or production-data mutation was involved.

## Requirement mapping

| Requirement | Durable evidence | Writer result |
| --- | --- | --- |
| Exact base and serialized lane | Fresh full-history WSL/ext4 worktree and narrow branch from exact `origin/main` `961245ebd12a28d2c7aa1c0b3e003530e4428f09`; preflight found no overlapping Part 4 writer or PR and left frozen PRs #66/#80/#81 untouched. | Pass at writer preflight |
| Versioned unit evidence | Every movement pins `m23-material-unit-v1` and digest `8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba`; quantity is a canonical positive decimal string with at most 12 integer digits and scale 6. Unit codes are opaque tenant-authored evidence and no conversion or equivalence is inferred. | Focused unit and PostgreSQL pass |
| Tenant movement facts | Migration 042 records only explicit `adjustment`, `consumed`, `returned`, `transferred`, and `waste` evidence, each with tenant, exact execution/assignment pins, performer, recorder, server observation instant, material key/description, quantity/unit, and review state. Composite tenant foreign keys prevent cross-tenant linkage. | Focused PostgreSQL pass |
| Optional location and lot | Location, transfer destination, and lot are optional bounded keys. A transfer requires either both distinct endpoints or neither; other facts reject a destination. Missing location stays `needs_review` and never becomes invented location/stock evidence. | Unit and PostgreSQL boundary pass |
| Bounded deterministic balances | Tenant-ledger writes serialize under advisory lock. Decimal arithmetic is PostgreSQL `NUMERIC(18,6)`; absolute balance beyond `999999999999.999999` rejects atomically. Underflow/unknown location remains explicit `needs_review`; unsafe acceptance is denied with zero effects. Read balance is explicitly a bounded visible-execution movement projection with `stockKnown=false` and `conversionApplied=false`. | PostgreSQL underflow/overflow/transfer tests pass |
| Correction and reversal lineage | `correct` requires exact movement revision/digest and advances the current record while immutable revision history retains the prior projection. `reverse` creates a separate exact compensating row tied one-to-one to the original; it never mutates or deletes the original, and a second reversal fails with zero effects. | PostgreSQL lineage and immutability pass |
| Review authority | Review requires owner/administrator authority, exact current source pins, and exact movement revision/digest. Accepted evidence cannot leave the recorded balance underflowed or unknown. Adjustments require owner/administrator and always begin `needs_review`. | PostgreSQL authorization/review pass |
| Immutable complete evidence | Every effect atomically produces current projection, event, immutable revision snapshot, immutable audit event, and immutable idempotency receipt. A deferred completeness trigger rejects partial evidence; history tables reject update/delete/truncate. | PostgreSQL pass |
| Idempotency, retry, and concurrency | Idempotency key hashes and database-computed request digests bind actor/session/action/source/content. Exact replay reauthorizes current session, subscription, assignment, dispatch, appointment, performer scope, and production source before disclosure. Changed-content reuse conflicts; concurrent exact retries create one effect. | Unit and PostgreSQL pass |
| Current actor/performer/crew authority | HTTP derives tenant/account/role/session/CSRF. PostgreSQL reloads active membership, account, workforce, subscription/onboarding, current appointment, assignment, dispatch, execution, performer, direct/active crew scope, and production transcript. Members act only as themselves; owner/admin on-behalf facts remain attributable. | Adversarial PostgreSQL pass |
| Demo/simulation exclusion | Both mutation and read join the exact transcript and use Part 3's fail-closed production-source classifier before effect, replay, or disclosure. Demo, simulation, unknown, control-wrapped, and ambiguous source values fail closed. | Source and zero-effect PostgreSQL pass |
| Strict HTTP boundary | Raw ownership covers only the material POST in addition to prior execution mutations. Duplicate keys, malformed UTF-8/JSON, compression, oversize/preparsed bodies, unknown keys, bad NFC/control text, invalid quantities/keys, and absent exact pins/idempotency fail closed. GET rejects query authority. | 27/27 focused unit pass |
| Safe output and resource bounds | Responses are `no-store`; generic unavailable handling avoids an oracle. Reads cap movement and balance projections at 200; repository sets transaction, statement, lock, and idle timeouts. | Unit and PostgreSQL pass |
| Runtime least privilege | `src/db.js` revokes material-table and helper privileges, grants only the mutate/read entry points, and verifies EXECUTE-only authority at startup. Runtime direct table/helper SQL fails with `42501`. | PostgreSQL privilege pass |
| No invented commercial/operational authority | Schema comments, route responses, roadmap, and unavailable ledger state that evidence is not stock existence, cost/value, procurement/purchasing, supplier truth, pricing/quote, invoice/payment, profitability, provider, contact, schedule mutation, Polaris, or later-part authority. | Source and ratification pass |
| Part 2/Part 3 and M20–M32 preservation | Migration 042 is additive. Protected migrations 001–041 remain byte-for-byte unchanged. Part 2 lifecycle and Part 3 labor stay independent; Part 4 reuses current authorities without mutating them. | Protected/cross-contract regression pass |
| Rendered-surface boundary | No `public`, `views`, browser, style, or UI source changes. This is no rendered-surface diff, not browser/founder approval. Part 9 retains the requirement to match or exceed the then-current deployed NorthStar design system on desktop/mobile, dark/light, accessibility, Chrome, WebKit, and visual inspection. | Source scope pass; visual acceptance not applicable |
| Migration exact-once and recovery | Disposable PostgreSQL 18.4 UTC exercises fresh runner, upgrade runner, forced 042 interruption/rollback, exact retry, and restart zero-op under separated owner/runtime roles. Exact 042 Git identity and read-only production-history compatibility are recorded separately after freeze. No backup/restore rehearsal is available; only forward-fix/no-destructive-rollback disposition is authorized. | Local runner pass; freeze/preflight pending |
| Independent acceptance and release | Writer results do not self-approve. Fresh exact-head independent audit, normal merge, automatic deployment, production application/ledger, health, and later-start zero-op remain required. | Not performed or claimed |

## Current focused results

- Part 4 unit boundary: 1 suite, 27 tests, all passed.
- Part 2–4 real PostgreSQL authority suite: 1 suite, 52 tests, all passed on
  disposable PostgreSQL 18.4, UTC, UTF8, C locale, checksums enabled.

## Writer regression results before migration freeze

### Syntax

- `node --check`: 9 changed JavaScript files passed.

### Focused Part 1–4 ratification

- Test suites: 5 passed / 5 total
- Tests: 41 passed / 41 total
- Snapshots: 0
- Failures: 0

### Complete ratification

- Test suites: 22 passed / 22 total
- Tests: 354 passed / 354 total
- Snapshots: 0
- Failures: 0

### Broad unit regression

- Test suites: 91 passed / 91 total
- Tests: 5,325 passed / 5,325 total
- Snapshots: 0
- Failures: 0

### Mission 21–23 and protected cross-contract regression

- Test suites: 12 passed / 12 total
- Tests: 175 passed / 175 total
- Snapshots: 0
- Failures: 0

### PostgreSQL 18.4 UTC regression

- Part 2–4 field execution/material authority: 1 suite, 52/52 passed.
- Mission 22 predecessor plus Mission 20 security/role authority: 5 suites,
  43/43 passed. An earlier run passed 42/43 and exposed only a stale Mission 22
  final-migration-position assertion; its exact source/ledger equality had
  passed. The corrected predecessor suite and then the entire segment passed.
- Isolated account authority: 1 suite, 11/11 passed.
- All PostgreSQL runs used the approved disposable loopback PostgreSQL 18.4
  cluster with UTC, UTF8, C locale, data checksums, per-suite databases, and
  separated migration/runtime roles.

These are writer results, not independent acceptance. Exact migration identity
and bounded read-only production-history compatibility remain pending until 042
is committed and frozen.
