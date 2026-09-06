# Part 7 requirement-to-evidence map

Writer candidate on exact released Part 6 base `6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9`.
This map is implementation/test evidence, not the writer auditing or approving
their own release. This is the current mapping for the corrected, unreleased
Part 7 candidate. [PROFILE_ROTATION_VERIFICATION.md](PROFILE_ROTATION_VERIFICATION.md)
records the exact runtime verification head, runs and retained failures.
[TEST_RESULTS.md](TEST_RESULTS.md) is the historical rejected-candidate ledger,
not the corrected candidate's current test or migration identity.

Current migration: `migrations/048_canonical_progress_issue_change_facts.sql`,
**55,557 raw Git-blob bytes**, Git blob
`55b527c2dc8a31514e3398489ed1bcc0811e1b47`, SHA-256
`c87210731112f7da7df2f955eadbe7fa6e66c16d80c732441c2ee1688dbc189a`.

| Requirement | Implementation | Reproducible evidence |
| --- | --- | --- |
| One canonical execution/assignment, exact current pins | SQL `canonical_progress_mutate`; production field-execution router | Mounted progress, stale execution/assignment, actual pause/resume, dispatch/reassignment tests |
| Exact quantities, explicit units, milestones and uncertainty; no inferred percent | `src/progress/contract.js`; SQL full-document validator and projection | Decimal boundary and ordering property checks; exact full-quantity/checklist milestone test; unknown evidence checks |
| Blocker and exception classification and lifecycle | Versioned typed documents, `issue_state`, immutable predecessor chain | Parameterized blocker/exception open/resolved/reactivated tests with exact Part 6 resolution evidence |
| Original unresolved and resolved facts preserved | Immutable revision/root/one-successor constraints; no table update/delete/truncate | Correction and lifecycle history reads; direct SQL immutable-table denials |
| Field change scope, initiator/source, affected work, implications, evidence, review | `record_change` document and owner/worker review | Requested change with reported customer source, worker acknowledgment, owner confirmation; no-commercial projection |
| No commercial/contact/scheduling/permission/professional authority | Exact allowlists; false authorityBoundary; no downstream writer calls | Extra price/approval/invoice/purchase/customer/permission/schedule fields rejected; unchanged execution state; ratification protected-path/no-provider assertions |
| Owner versus actual worker review and individual attribution | Existing actor authority; assigned/crew performer validation; immutable recorder/performer fields | Worker acknowledgment and denied worker owner-confirmation; real-cookie viewer/foreign-tenant denials; crew revocation |
| Tenant-composite immutable event/revision/audit/receipt/link graph | Migration 048 FKs, computed digest constraint, link binding, deferred complete transaction check | Fresh and upgrade constraints, runtime direct SQL denial, same-key winner counts, forced audit failure rollback |
| Current authorization before replay or data disclosure | Existing actor/source authority plus Part 7 supporting/work lock protocol | Session, account, membership, performer, subscription, onboarding, crew, dispatch, assignment, execution pins and normalized transcript revocation before exact replay; revoked read denial |
| Database-owned time and deterministic stale snapshots | Per-execution monotonic decision time; released supporting-authority MVCC fence | Real UTC/UTF8/checksum checks; old-snapshot revocation SQLSTATE 40001; stable high-water pages excluding later inserts |
| Serializable mutation and repeatable-read bounded read | `src/progress/repository.js`; DB isolation/lock enforcement; bounded retries/timeouts | Same-key one effect; competing successor one winner; 2,000 real writes, capacity denial, exact retry and complete bounded traversal |
| Exact idempotent retry and audit atomicity | Semantic request hash excludes correlation telemetry; receipt checked after authorization | Equal canonical response bodies; changed semantic key conflict; one record/event/audit/receipt; failing audit leaves no record and retry commits once |
| Strict HTTP and inert Unicode | Existing strict UTF-8/duplicate-key/32KiB body middleware expanded to progress-actions; mirrored JS/SQL text checks | Mounted no cookie, CSRF, permission, compressed/duplicate/oversized/forged authority denials; direct SQL hostile text; NFC international round-trip JSON |
| Bounded pages/truncation without hidden history | 1–200 limit, exact dataset cursor, immutable time cutoff, 2,000 revision cap | Ten non-overlapping 200-row pages reach every real record; totals stable; cross-execution and fabricated cursor denial |
| Fresh install and supported upgrade/apply once/zero op/interruption rollback | Real `src/db.js` migration runner and progress role authority | Part 7 migration lifecycle suite plus real production initialization; all prior Part 2–6 lifecycle tests retained |
| Frozen source/runner compatibility | Current migration identity above, ratification, inspector exact-source seals | Exact 55,557-byte SHA-256/Git blob; every released migration byte preserved; inspector source/reconcile tests |
| Tests first and no test-history erasure | Commit `b43cae0` contains only the original new tests and red evidence | RED_EVIDENCE.md and tracked red-results.json: absent module/route/authority, 10 failed mounted assertions |
| Serialized release and explicit unavailability | This evidence directory and roadmap writer-candidate status | One writer branch; draft PR exact refs in terminal handoff; fresh exact-head audit required; no independent acceptance, merge or deployment claimed |

Retained compatibility is tested against deployed Parts 2–6, including labor,
materials, equipment and field evidence. Their migration bytes are untouched.
The historical 046/047 lifecycle tests now copy only their own new target into
their preceding-migration directory before retry, preserving the original
exact-once contract when a later additive migration exists. They are not
excluded from this candidate's broad available inventory.

Scope contract: `docs/operations/PROGRESS_ISSUE_FACTS.md`.
Unavailable evidence: `UNAVAILABLE_EVIDENCE.md`.
Migration/recovery: [current migration/recovery](PROFILE_ROTATION_MIGRATION.md).
Historical rejected migration receipt: [MIGRATION_IDENTITY.md](MIGRATION_IDENTITY.md).
