# Mission 21 Part 8 evidence and visual-change ledger

Status: writer closeout candidate; independent exact-head audit not yet performed
Base commit: `02c28a430a7be9f1d1173df637a544debd5883b6`
Base tree: `a0f0d4fbb1785355c6c87b2178d33819e839f657`
Base parents: `382101328627d988d7199536864fed35bebd1b96`,
`a95461cc7a5742a30db24678c98acde67b4ae6c6`
Branch: `codex/mission-21-part8-closeout`

This ledger resolves the hypotheses and planned evidence in
`MISSION_21_PART8_THREAT_AND_ACCEPTANCE_LEDGER.md`. It is writer evidence, not the mandatory
independent review, merge authority, deployment evidence, or a claim that Mission 21 is released.

## Candidate decision and narrow production correction

The Part 1-7 production graph, workflow, projection, lifecycle, synchronization, and browser
implementations already satisfied the mission-wide trace when mounted together. Part 8 adds one
mission-wide mounted PostgreSQL/HTTP harness, durable threat/evidence documentation, and one product
correction found by that harness.

An expired paid owner received `permissions.canMutate=true` from the mounted list/detail GET while
the same durable cookie session and CSRF-authenticated POST correctly failed with
`403 subscription_read_only`. That response could display enabled mutation authority which the
server would reject. Tests or documentation alone could not correct the false browser contract.

`src/routes/knowledgeManagement.js` now intersects repository role capability with the trusted
server-owned `req.subscriptionAuthority` by the same `canMutateInternal(..., { allowPending: true })`
policy used by mutation middleware. List and detail return `role_read_only`,
`subscription_read_only`, or no restriction, and direct-revision capability is suppressed whenever
the subscription cannot mutate. `public/js/knowledge-management.js` renders the corresponding
read-only reason. Request bodies still cannot choose actor, tenant, role, subscription, or
sensitivity.

A root `.gitattributes` entry fixes a separately observed checkout portability defect by requiring
`migrations/*.sql text eol=lf`. It changes no applied migration blob. Before the correction, a clean
Windows checkout materialized all 29 SQL files with CRLF even though Git/index blobs were LF, causing
the protected byte tests to fail. After rematerialization, every migration worktree hash equals its
immutable `HEAD` blob, every CR count is zero, and cached plus working migration diffs are empty.

## Exact mounted authority trace

The additive `tests/integration/m21-part8-mission-wide-postgres.test.js` mounts `src/server.js`, real
cookie sessions, real CSRF, production permission/subscription middleware, the production
repositories, and disposable PostgreSQL. It does not inject an actor header or replace mounted
authorization.

| Trace step | Mounted evidence |
| --- | --- |
| Deterministic generation | Exact seven sorted Part 2 canonical keys, generator version, canonical hostile-byte content, and source-owned provenance are persisted. |
| Provenance and diff | Owner detail returns the exact version digest and pinned provenance; review creates a canonical root-add diff whose digest is recomputed from the exact canonical diff. |
| Review, approval, publication | Owner submits, a distinct administrator approves, stale approval conflicts, and owner publishes the exact immutable version. |
| Minimized retrieval/projection | A member receives the exact published source through the production projection repository; a private profile email is absent before transport while inert hostile content remains data. |
| Provider-neutral synchronization | A target is configured for `intercepted.mission21-part8`; the injected transport accepts the exact minimized projection. No network transport or provider SDK is used. |
| Desired, observed, last-known-good | The production repository reports one `in_sync` state with equal desired, observed, and last-known-good digests. |
| Drift/failure and bounded reconciliation | Staleness queues one reconciliation; an intercepted provider-neutral failure produces bounded retry while preserving last-known-good. Mounted reconcile and retry routes pin target revision/configuration. |
| Crash/restart boundary | A new worker/repository instance drains the retained job successfully without deriving new canonical knowledge from observed state. |
| Tombstone | Mounted lifecycle creates version 2 as a tombstone; owner review, administrator approval, and publication complete before it becomes current. |
| Reviewed rollback as a new version | Mounted rollback pins version 1 and creates version 3; it is separately reviewed, approved, and published. Versions remain `[1,2,3]`; a direct SQL update is rejected with `55000`. |

The same harness covers every mounted knowledge-management route: list, detail, review, changes,
approve, publish, revise, tombstone, rollback, synchronize/reconcile, and synchronize/retry. It also
mounts the eligible human revision path after a changes request. The trace exercises generator,
registry, management, workflow/publication, projection, lifecycle, synchronization repository, and
worker production modules.

## Adversarial coverage resolution

| Threat ledger area | Final evidence |
| --- | --- |
| Tenant, actor, role, session, CSRF, subscription | Real owner/admin/member/viewer cookie sessions pass their permitted reads; inactive membership is `403`; revoked session and Bearer-only request are `401`; cross-tenant ID is `404`; missing CSRF and smuggled authority fail; expired-owner GET and POST agree on read-only truth. |
| Sensitivity and bounded relationships | Member/viewer lists exclude protected financial knowledge before item disclosure; cross-tenant hostile bytes are absent. Parts 5 and 7 exhaustive relationship, cursor, graph, count, and fail-closed matrices rerun in the combined/full suites. |
| Append-only graph and stale writes | The trace binds exact version/review/publication/target pins, proves stale conflict, retains three lifecycle versions, and rejects direct SQL mutation. Parts 1, 3, 4, and 6 exhaustive concurrency/direct-SQL matrices rerun. |
| Projection and feedback isolation | Projection excludes private source data before the intercepted transport. Observed/failure evidence changes sync state only; version/publication counts remain controlled by the reviewed lifecycle. |
| Outbox, lease, retry, dead-letter, poison, ordering | The trace covers success, stale reconcile, failure, retry, restart, and last-known-good. The complete Part 6 suite supplies exhaustive claim ownership, replay/idempotency, lease expiry/loss, retry exhaustion, poison isolation, revocation, reconfiguration, ordering, and recovery coverage. |
| Hostile stored bytes and DOM sinks | Hostile markup/bidi bytes remain inert across mounted HTTP/projection and both browser engines; `window.__part7Xss` remains zero. The browser uses DOM construction and text nodes; no stored byte reaches an executable sink. |
| Paid/demo and provider boundary | Paid Settings/Business Profile use durable cookie authority; isolated demo Settings/Business Profile remain simulated/read-only. All external/provider actions are intercepted and zero. |
| Resource bounds | Part 7 browser loads the bounded 200-row page then an explicit continuation, source filter, and narrow layouts. Combined Parts 1-7 retain query, JSON, cursor, graph, relationship, projection-entry, byte, claim-batch, retry, and diagnostic bounds. |

## PostgreSQL and migration evidence

The deterministic cluster identity was:

- PostgreSQL `18.4` on x86_64 Windows, UTC;
- data checksums `on`;
- `listen_addresses=127.0.0.1`, port `55482`;
- data directory
  `C:/Users/joshv/AppData/Local/Temp/northstar-m21-part8-writer-02c28a4-20260825/data`.

The Part 8 harness uses distinct migration-owner and runtime roles. The migration owner applies exact
bytes; runtime initialization authenticates separately, remains in replication mode `origin`, and
is denied `_migrations`. Combined Parts 1-6 cover fresh plus every supported Mission 21 boundary:
pre-025 to 025, 025/026/027 graph upgrades, 027 to 028 lifecycle, 028 to 029-031 synchronization,
poisoned-upgrade rejection, runtime ownership/grant rejection, and fresh convergence.

| Protected Mission 21 migration | LF bytes | SHA-256 |
| --- | ---: | --- |
| `025_provider_agnostic_knowledge_registry.sql` | 13,528 | `174c3eb967d1663cd103d8edd331ee2bc373f1bcaa41829d7006bc41c539b15d` |
| `026_canonical_knowledge_review_publication.sql` | 40,087 | `76bfeec25d20cf96cb3d871d1049e83600176532f6f6a40f8c4d3164c8ea3fc7` |
| `027_canonical_knowledge_audit_graph_authority.sql` | 26,883 | `0b36d01ffa23286c40f0d75c9f627ab3dbefcdc480dd4d7ad000d88345df3c3e` |
| `028_canonical_knowledge_immutable_lifecycle.sql` | 23,809 | `9e279c6d0e4b627c46dc2140eaa02b4fb1c55846ffb496248334a0b96fa4daca` |
| `029_canonical_knowledge_transactional_sync.sql` | 98,513 | `135d96e1398d14a61e226c106f9f54e73c9c99dc37205187d5fe8ee9bae22645` |
| `030_canonical_knowledge_sync_revocation.sql` | 39,982 | `bee80ec2853d09b1531db0cc86b0cef9481e6c2c0318d12e5328540cad1047bb` |
| `031_canonical_knowledge_sync_recovery_lifecycle.sql` | 17,478 | `36574b14b4418430e0c7ebbf7150a5ea6553282664d488cad0dd8a7a4f9a8347` |

No migration, schema, seed, package manifest, runtime credential, production configuration, or
production data changed in this candidate.

## Browser and visual evidence

Visible product code changed: **yes**. An expired owner now sees accurate `Read-only subscription`
text in the knowledge mode and detail header instead of enabled knowledge mutations or a misleading
membership-only explanation. No layout or styling code changed.

Installed Chrome `151.0.7922.173` and actual Playwright WebKit `26.5` each passed paid and isolated
demo Settings/Business Profile, light/dark, `1440x1000`, `390x844`, and `320x800` reflow-equivalent
coverage. The matrix covers headings/labels/name-role-state, tab keyboard order, dialogs,
Escape/focus restoration, alert focus, non-color badges/text, reduced motion, computed contrast,
narrow overhang/header/Quick Start, hostile bytes, pagination, exact stale conflicts, lifecycle, and
synchronization. Subscription mode/detail contrast was approximately `13.35:1` and `17.06:1` in
both engines. There were zero XSS executions, horizontal-overflow findings, Bearer headers,
provider actions, or nonlocal application requests.

Each engine produced 12 PNGs in writer-owned external evidence directories. The four new/changed
subscription captures are:

| Capture | Bytes | SHA-256 |
| --- | ---: | --- |
| Chrome desktop | 341,844 | `92f101bec19ee2034c5a5a2dd08361d6b35ffeb368fcd2479f7b24d45201f996` |
| Chrome 320px reflow | 291,135 | `12aae3e2ed18c4d5c5b95db4616c806ab50a6a6a441c83094405f9c847d32568` |
| WebKit desktop | 311,617 | `a839027721851deb3ad8432952ffcebb893b27b002babd4dab2d2ad69a802817` |
| WebKit 320px reflow | 264,200 | `6330dd89b1e7128c5eace2a81fbd2ea665715713ee55d00693af74a73dc7eed2` |

Writer inspection found the subscription banner and knowledge explanation consistent, mutation
controls absent, legible reflow, and navigation/Quick Start reachable. **User visual approval is not
claimed and remains a separate required release verdict because visible product copy changed.**
Actual Playwright WebKit is not physical Safari.

## Validation ledger

Final successful commands/results on the candidate working tree:

- Mission 21 unit matrix: 7 suites, 89/89 tests.
- Focused Part 8 mounted PostgreSQL trace: 1 suite, 4/4 tests.
- Combined Mission 21 Parts 1-8 PostgreSQL matrix: 8 suites, 86/86 tests.
- Historical Account Migration 010 physical matrix: 1 suite, 24/24 tests after authentic archived
  fixture construction.
- Full Jest unit/API/integration/regression/ratification/compatibility matrix: 141 suites,
  1,983/1,983 tests, 0 snapshots.
- Explicit production-startup authority: 1 suite, 2/2 tests.
- Installed Chrome mounted browser matrix: pass, 12 screenshots.
- Actual Playwright WebKit mounted browser matrix: pass, 12 screenshots.
- `git diff --check`: pass.

The exact-head full rerun and staged-blob/scope checks are repeated after the final documentation
freeze and recorded in the draft PR/handoff.

## Retained intermediate failures and corrections

No red output was discarded or relabeled as passing:

1. Initial Part 8 fixture rejected an invalid Business Profile version label; the fixture was
   corrected to the accepted `org-profile-v1` identity.
2. Revoked-session setup lacked the schema-required revoke reason; test-only revocation evidence was
   completed.
3. An initial focused authority run exposed the production expired-owner permission mismatch. The
   server-owned permission intersection and explicit UI reason are the narrow product fix.
4. The first trace tried to resubmit a changed version instead of appending a revision; changes and
   eligible human revise coverage were separated according to the append-only contract.
5. A canonical JSON assertion compared serialized escape bytes rather than parsed projection data;
   the assertion was corrected without changing production serialization.
6. A stale-target attempt naturally produced retry rather than drift. The intercepted negative
   transport now returns an explicit provider-neutral failure, satisfying the required
   `drift or failure` branch while preserving last-known-good.
7. A management history response correctly failed relationships closed under a deliberately complex
   graph. Complete lifecycle history is asserted through the canonical lifecycle repository; mounted
   detail still proves the exact published rollback.
8. Two WebKit attempts timed out after rendered tabs replaced a captured element handle. The harness
   now waits on the current mounted tab by accessible name and selected state; assertions were not
   relaxed. Chrome and WebKit passed from the beginning after the correction.
9. The first combined Part 1-8 run passed 81/86 tests in 3/8 suites and correctly failed protected
   migration CRLF bytes. `.gitattributes` and exact HEAD rematerialization fixed the checkout, not a
   migration. The next run passed 85/86; one Part 7 expected object was updated to require the new
   `role_read_only` field. The complete rerun passed 86/86.
10. The first full Jest run passed 1,959/1,983 tests in 140/141 suites; all 24 failures were an absent
    historical negative-control identity. Creating empty allowlisted controls passed 23/24 and proved
    they required authentic history. A sparse archived checkout then hit unrelated Windows-invalid
    historical root filenames. Binary-safe, path-scoped Git archives independently ran genuine
    `dfff096...` and `9ec181...` migration runners and verified the exact fresh/upgrade ordinal
    divergence. The focused suite passed 24/24 and the complete rerun passed 1,983/1,983.

## Separate and unavailable verdicts

- Independent exact-head code/security review: **unavailable during writer execution; mandatory next**.
- GitHub hosted checks/workflows: **zero/unavailable, not passing**.
- Merge, production migration, automatic deployment, health, passive production acceptance, and
  release cleanup: **not performed**.
- Live provider transport, SDK, credentials, scheduler, and delivery readiness: **not tested and not
  implied by intercepted transport**.
- Physical Safari/device evidence: **unavailable**; WebKit is labeled accurately.
- User visual approval: **not claimed; separate and required for the visible copy change**.
- Legal, pricing, credential, provider, and production-configuration readiness: **outside this
  candidate and separate**.
- Mission 22 behavior: **not started**.
