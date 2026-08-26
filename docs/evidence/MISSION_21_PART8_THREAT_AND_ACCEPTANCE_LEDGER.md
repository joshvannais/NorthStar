# Mission 21 Part 8 threat and adversarial acceptance ledger

Status: writer-owned pre-implementation ledger
Base commit: `02c28a430a7be9f1d1173df637a544debd5883b6`
Base tree: `a0f0d4fbb1785355c6c87b2178d33819e839f657`
Branch: `codex/mission-21-part8-closeout`

This ledger binds the Mission 21 closeout threat model to mounted acceptance evidence. It does not
ratify Part 8, replace an independent exact-head audit, or promote accepted Part 1-7 evidence into
new evidence. `Planned` means the writer has identified a missing Part 8 assertion; it is not a pass.

## Scope and security objectives

Mission 21's security boundary is the provider-neutral, tenant-scoped knowledge authority from
deterministic generation through append-only lifecycle and synchronization evidence. The objectives
are:

1. PostgreSQL-owned tenant, individual membership, role, subscription, session, CSRF, workflow,
   publication, lifecycle, projection, and synchronization state must remain authoritative.
2. Every mutation must pin the exact immutable authority it intends to change, fail closed when the
   pin is stale, and append evidence without changing retained history.
3. Every read must minimize before transport and withhold protected bytes, identifiers, counts, and
   derived digests before they reach an unauthorized browser or consumer.
4. Provider-neutral synchronization must distinguish desired, observed, last-known-good, drift,
   retry, dead-letter, and reconciliation truth without a feedback loop or partial publication.
5. Fresh and supported upgrade installations must preserve exact migration bytes and a distinct
   migration-owner/runtime role boundary on PostgreSQL 18.x in UTC.
6. Paid browser surfaces must use mounted production HTTP/session authority. The account-free demo
   must remain isolated, simulated, read-only, and unable to establish provider readiness.

Out of scope are provider SDKs or traffic, provider credentials, schedulers, production data or
configuration, production migration/release, pricing or legal policy, Mission 22 behavior, and a
claim of physical Safari coverage.

## Architecture and trust boundaries

| Boundary | Trusted authority | Untrusted input | Required invariant | Mounted implementation |
| --- | --- | --- | --- | --- |
| Browser to HTTP | Durable cookie session plus CSRF cookie/header | body/query/path IDs, role or tenant claims, stored bytes | request data cannot select actor, tenant, role, subscription, or sensitivity | `src/auth/middleware.js`, `src/routes/knowledgeManagement.js` |
| HTTP to repository | frozen `tenantContext` and current subscription/permission gates | stale workflow, publication, lifecycle, cursor, and target pins | all reads and writes revalidate exact current PostgreSQL authority | `src/knowledge/managementRepository.js`, `src/knowledge/repository.js`, `src/knowledge/synchronizationRepository.js` |
| Source facts to graph | versioned Business Profile/workforce/asset rows | missing, malformed, duplicate, or hostile source bytes | deterministic seven-draft generation with exact provenance and unresolved evidence marked `needs_review` | `src/knowledge/generator.js`, `src/knowledge/contract.js` |
| Graph to consumers | exact published version and consumer projection profile | overbroad applicability, relationship edges, source secrets | authorization before bounded query, fail-closed relationships, deterministic minimized projection | `src/knowledge/projection.js`, `src/knowledge/repository.js` |
| Publication to sync | exact publication and target configuration | replayed, reordered, stale, poisoned, or expired claims | one durable desired state/outbox sequence, lease ownership, immutable attempts, bounded recovery | `src/knowledge/synchronizationRepository.js`, `src/knowledge/synchronizationWorker.js` |
| Migration owner to runtime | exact migration ledger and separate database identities | direct SQL, inherited replica mode, DDL/ledger access | migration owner applies exact bytes; runtime has required DML and no DDL/ledger authority | `src/db.js`, `migrations/025_*.sql` through `031_*.sql` |
| Canonical bytes to DOM | authorized minimized JSON | stored markup, URL-like text, prompt instructions, bidi/control Unicode | inert DOM construction/text nodes only; no stored bytes become executable markup | `public/js/knowledge-management.js`, `public/js/demo-runtime.js` |

## Threat catalogue

Each entry records six fields: asset, adversary/action, entry point, precondition, impact, and
mitigation/acceptance evidence.

### T1 - request-supplied authority or inactive membership

- Asset: tenant knowledge and mutation authority.
- Adversary/action: authenticated or unauthenticated caller supplies another tenant, actor, role,
  membership, or subscription shape; a formerly active member replays a cookie.
- Entry point: every `/api/v1/knowledge-management` route.
- Precondition: guessed cross-tenant IDs, retained session cookie, or smuggled JSON/query fields.
- Impact: cross-tenant disclosure or unauthorized workflow/lifecycle/sync mutation.
- Mitigation/evidence: production cookie middleware reloads session, user, organization,
  membership, role, and subscription from PostgreSQL; permissions run after that reload; request
  bodies accept only exact fields. Part 8 mounted HTTP will cover owner, administrator, member,
  viewer, inactive membership, cross-tenant IDs, forged Bearer/session, CSRF mismatch, subscription
  read-only, and smuggled authority. Status: **planned Part 8 evidence**.

### T2 - sensitivity or relationship oracle

- Asset: restricted/legal/high-risk/attorney-gated bytes, identifiers, counts, and digests.
- Adversary/action: member/viewer filters, paginates, requests a direct ID, or follows provenance,
  comparison, publication, history, lifecycle, or synchronization relationships.
- Entry point: knowledge list/detail repositories and signed cursors.
- Precondition: readable root knowledge plus a protected or unresolved relationship.
- Impact: protected authority leaks through content, shape, count, identifier, timing, or digest.
- Mitigation/evidence: SQL authorization precedes filters/counts/pagination; the one relationship
  policy fails closed and redacts every relationship-bearing field. Parts 5 and 7 contain mounted
  adversarial coverage; Part 8 will exercise the same repositories through real session HTTP and
  one end-to-end trace. Status: **planned Part 8 mounting; accepted component evidence retained**.

### T3 - graph mutation or stale lifecycle write

- Asset: append-only versions, provenance, review events, approval snapshots, publications,
  lifecycle history, and audit evidence.
- Adversary/action: concurrent or direct-SQL update/delete/truncate, stale version/review/publication
  pin, duplicate publish, tombstone bypass, or rollback that rewrites history.
- Entry point: Part 1, 3, and 4 repositories and database tables/triggers.
- Precondition: runtime DML access or a captured prior response.
- Impact: mutable history, approval of different bytes, partial publication, or resurrection.
- Mitigation/evidence: exact pins, serializable transactions, immutable triggers, append-only
  audit/publication/lifecycle constraints, tombstone semantics, and rollback only as a new version.
  Part 8 will trace review through rollback and attempt representative direct-SQL bypasses on both
  fresh and upgraded databases. Status: **planned Part 8 evidence**.

### T4 - nondeterministic generation or provenance substitution

- Asset: seven canonical generated drafts and their source evidence.
- Adversary/action: reorder source rows, duplicate identifiers, mutate non-semantic metadata, inject
  hostile bytes, omit evidence, or substitute a source digest/version.
- Entry point: deterministic generation and registry insertion.
- Precondition: valid tenant source access with adversarial row order or malformed source data.
- Impact: unstable digests, manufactured knowledge, unreviewed publication, or unverifiable facts.
- Mitigation/evidence: canonical UTF-8 JSON, NFC/bounds, stable ordering, exact source pins and
  digests, semantic determinism, and `needs_review` on unresolved evidence. Part 8 will generate the
  same source twice under reordered input and carry one exact changed draft into review. Status:
  **planned Part 8 evidence**.

### T5 - overbroad projection or feedback loop

- Asset: customer/voice/integration projections and private canonical fields.
- Adversary/action: request an overbroad audience, consume drafts, feed observed provider bytes back
  into canonical truth, or query without bounded applicability.
- Entry point: projection repository and synchronization target configuration/publication enqueue.
- Precondition: a published graph containing both eligible and private facts.
- Impact: secret disclosure, nondeterministic provider behavior, or provider state becoming source
  authority.
- Mitigation/evidence: fixed consumer profiles, authorization before bounded selection, exact
  publication pins, deterministic projection digest, outbound-only desired state, and observed data
  retained only as synchronization evidence. Part 8 will assert minimization and that drift does not
  create a graph version or publication. Status: **planned Part 8 evidence**.

### T6 - outbox replay, lease loss, poison, or partial success

- Asset: desired/observed/last-known-good state, immutable attempts, ordering, and reconciliation.
- Adversary/action: concurrent workers claim the same item, replay a token, let a lease expire during
  transport, reorder target sequences, exhaust retries, poison a historical row, crash after claim,
  or suspend/reconfigure a target in flight.
- Entry point: synchronization repository/worker and direct SQL against target/outbox/attempt/state.
- Precondition: queued publication plus worker or runtime database access.
- Impact: duplicate provider action, false in-sync state, lost last-known-good, tenant starvation,
  resurrected work, or partial publication.
- Mitigation/evidence: ordered `SKIP LOCKED` claims, exact target/configuration/sequence pins, durable
  claim token and expiry, ownership verification in the delivery transaction, immutable attempt
  ledger, bounded retries/dead-letter/reconcile, suspension/reconfiguration revocation, and poison
  isolation. Part 8 will trace an intercepted success, drift/failure, bounded reconcile, and restart;
  the combined Part 6 suite remains authoritative for the exhaustive concurrency/expiry/poison
  matrix. Status: **planned trace plus accepted exhaustive component evidence**.

### T7 - executable stored bytes or browser authority race

- Asset: authenticated browser origin, visible immutable target, and mutation pins.
- Adversary/action: store markup/script/URL/bidi bytes, race late detail responses, switch selection
  after opening a dialog, or forge client-side permissions.
- Entry point: list/detail/diff/provenance/history/sync serializers and DOM renderers.
- Precondition: authorized stored content or manipulated browser timing/state.
- Impact: DOM XSS, misleading state, or mutation of an authority different from the visible target.
- Mitigation/evidence: DOM creation and `textContent`, exact URL normalization, request sequencing,
  captured frozen dialog target, immediate pre-transport revalidation, and server-side authorization.
  Part 8 browser coverage will retain hostile bytes and stale-dialog assertions in Chrome and actual
  Playwright WebKit. Status: **planned Part 8 regression evidence**.

### T8 - installation, identity, or startup downgrade

- Asset: migration provenance, runtime least privilege, and fail-closed production startup.
- Adversary/action: rewrite an applied migration, omit a source file, use one privileged credential,
  inherit replica mode, grant runtime DDL/ledger access, or listen before database initialization.
- Entry point: `runMigrations`, `initDatabase`, and `start`.
- Precondition: configuration drift or a malformed fresh/upgrade database.
- Impact: bypassed triggers/RLS-like invariants, unverifiable schema, or an accepting server without
  canonical authority.
- Mitigation/evidence: byte checksums, missing/duplicate/mismatch rejection, migration advisory lock,
  exact role separation and privilege verification, runtime replica-mode rejection, and database
  initialization before listen. Part 8 will run fresh plus supported Mission 21 upgrade boundaries
  on PostgreSQL 18.x UTC and exact production-startup negatives/positive. Status: **planned Part 8
  evidence**.

### T9 - paid/demo or provider-boundary confusion

- Asset: paid tenant data and truthful provider/readiness claims.
- Adversary/action: demo state crosses into paid requests, paid pages render simulated fixtures, or
  intercepted transport is described as live provider delivery.
- Entry point: Settings and Business Profile paid/demo routes and synchronization worker transport.
- Precondition: account-free browser, route interception, or mislabeled evidence.
- Impact: tenant disclosure or manufactured product/provider readiness.
- Mitigation/evidence: demo runtime intercepts its isolated routes and is read-only; paid pages use
  cookie-authenticated mounted HTTP; test transport is provider-neutral and intercepted. Part 8 will
  compare paid and demo surfaces in both engines and keep provider, credential, scheduler, legal,
  production, and physical-device verdicts separate. Status: **planned Part 8 evidence**.

## Part 8 acceptance binding

| Acceptance area | Required mounted proof | Part 8 artifact/status |
| --- | --- | --- |
| Real HTTP authority | owner/admin/member/viewer/inactive, cross-tenant, subscription, CSRF, revoked session, stale pins; no injected authorization | Additive PostgreSQL + production-router harness; **planned** |
| Mission-wide exact trace | generation -> provenance/diff -> review/approve/publish -> minimized projection -> intercepted sync -> desired/observed/LKG -> drift/failure -> reconcile -> tombstone -> reviewed rollback | Additive PostgreSQL harness; **planned** |
| Direct SQL and concurrency | representative mission-wide bypass attempts plus full Part 1-7 database suites for exhaustive constraints, replay, lease, retry, poison, restart, and ordering | Combined mounted matrix; **planned rerun** |
| Install/upgrade/startup | fresh and supported Mission 21 upgrade boundaries, PostgreSQL 18.x UTC, migration/runtime split, exact startup failures and success | Additive migration matrix plus Part 6 startup matrix; **planned** |
| Browser/accessibility | paid/demo Settings and Business Profile, previous consumers, light/dark, desktop/narrow/zoom, keyboard/dialog/focus/Escape, non-color/contrast/reduced motion/overhang/header/Quick Start | Chrome + actual Playwright WebKit; **planned** |
| Stored bytes and bounds | inert rendering across serializers/sinks; sensitivity before query; cursor and graph bounds; 1 MiB JSON request cap | HTTP, PostgreSQL, and browser matrices; **planned rerun** |
| Evidence boundaries | intermediate failures and reruns retained; no CI/provider/credential/production/legal/physical Safari inference | Part 8 closeout/visual ledger; **planned** |

## Pre-implementation gap decision

The accepted Part 1-7 suites establish component contracts but do not yet supply one Part 8
mission-wide mounted trace. In particular, the Part 7 PostgreSQL HTTP suite injects a test actor via
`x-part7-actor` and replaces the production session, subscription, CSRF, and permission middleware.
The Part 7 browser suite uses real durable cookie sessions but covers owner and member only. Part 8
therefore requires additive real-session HTTP coverage, the exact mission-wide trace, and the broader
browser/installation evidence matrix.

One candidate product correction must be decided by authentic validation: list/detail permissions
currently describe owner/administrator mutation capability from role alone, while mounted mutation
middleware also requires mutable subscription authority. If an expired owner is shown enabled
knowledge actions, Part 8 will make the smallest server-owned permission correction and bind it to
real-session HTTP/browser tests. Until that test is run, this is a threat hypothesis, not a finding.

## Residual and separate verdicts

- An exact-head independent audit is mandatory and unavailable during writer execution.
- Hosted GitHub checks/workflows are zero and therefore unavailable, not passing.
- Provider transport, credentials, scheduler activation, live delivery, and provider readiness are
  outside this candidate and cannot be inferred from interception.
- Production migration, merge, deployment, health, and release acceptance are later release-lane
  verdicts and are not writer evidence.
- User visual approval, legal readiness, and physical Safari/device evidence remain separate. Actual
  Playwright WebKit will be labeled WebKit only.
