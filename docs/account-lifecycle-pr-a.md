# Account Lifecycle PR A

This change establishes PostgreSQL as the only runtime authority for account identity, organization ownership, memberships, current subscriptions, account preferences, onboarding state, browser sessions, refresh families, and authentication abuse controls.

## Emergency checksum hotfix boundary

PR #71 merged normally as `4618ebcc9386f56655c9fd4bec612d0881fcca51`, with parents `dfff096241d3be4fd1580a741cfe21ee64a5dfb3` and `ef5418c51b405f8c1d04214ecb66f8f978e8cf0b`. Its first Railway startup failed because `AUTH_ACCESS_SECRET` was missing or too short. That secret was repaired through the separately authorized production-recovery workflow and must remain unchanged.

The next startup reached the migration runner but failed before migration with `Protected legacy migration checksum mismatch: 001_initial_schema.sql`. The merged protected constants for migrations 001-009 were hashes of complete CRLF-expanded Windows checkout representations, while Railway read the authoritative LF Git content. Production remained HTTP 502 at hotfix preparation time. The immediately preceding recovery ledger established that production PostgreSQL was healthy and unchanged, migrations 001-009 were recorded exactly once, migrations 010-011 were absent, and no active session or refresh authority existed. This source-preparation task did not reconnect to Railway or production PostgreSQL.

The retained pre-release backup remains at `northstar-production-pre-pr71-20260731T130123Z.dump`, 151,928 bytes, SHA-256 `C15430CAC090E23AB2212D40B0F24F1CA0A8D93327BB024212F642212C7B032A`. It was used only with the already verified disposable PostgreSQL 18 restore from the release-validation ledger; it was not restored to production.

This draft hotfix changes only checksum authority in `src/db.js`, authentic migration tests, and this evidence document. Migrations 001-011, authentication/session behavior, browser code, Jobber, payments, manifests, lockfiles, Railway configuration, provider configuration, and tracked data are unchanged. The repaired `AUTH_ACCESS_SECRET` was neither read nor changed. No rollback, production restore, Railway mutation, deployment, provider call, production account, or production-database mutation occurred during preparation.

The validation below is local implementation evidence, not independent review, CI, deployment, or production proof. GitHub reports zero statuses/check runs/workflow runs, so CI is unavailable rather than passing. The hotfix requires a separate delta-only review and remains draft, open, unmerged, and undeployed.

## Frozen lifecycle

- The production server does not receive a signup capability. No environment value can enable public signup during PR A; the endpoint returns a bounded unavailable response without writes or cookies. PR B must make a reviewed source-level capability change.
- Disposable tests inject the real signup transaction into a test-owned application. Signup normalizes email by trimming and lowercasing only, accepts passwords from 8 through 128 characters, and atomically creates the organization, pending-verification user, owner membership, 14-day trial, notification preferences, onboarding row, session, and refresh family.
- Pending-verification accounts retain authenticated tenant access: `/api/auth/me`, verification status, refresh, logout, tenant-scoped dashboard reads, Business Profile onboarding, the initial Business Profile save, and strictly internal onboarding configuration.
- Email verification and onboarding are independent PostgreSQL states. Saving the first active Business Profile completes onboarding but never verifies the email. Provider/customer-facing actions require both verification and completed onboarding, plus a current session, active membership, tenant, and role.
- An existing active canonical Business Profile makes onboarding `complete`. Persisting the first active profile updates the onboarding row in the same PostgreSQL transaction.
- The historical JSON user registry is neither read nor imported by any mounted authentication path. `data/users.json` remains protected evidence.

## Browser credential contract

`northstar_access` and `northstar_refresh` are `HttpOnly`, `SameSite=Lax`, `Path=/` cookies. They are `Secure` in production. The access JWT contains only the user and session identifiers; organization and role authorization are reloaded from PostgreSQL on every request.

`northstar_csrf` is deliberately readable by the shared browser client and is not an authentication credential. Every cookie-authenticated state-changing request must send its value in `X-CSRF-Token`; the server also compares its hash with the current session row. Refresh rotates both refresh and CSRF values, so missing, wrong, stale, and cross-session values fail.

`public/js/auth-session.js` is the only browser authentication client. It retains account projections only in memory, loads identity through `/api/auth/me`, retries once after a successful refresh, routes lifecycle states, and performs server-side logout. Browser storage may still contain presentation theme and per-tab simulation metadata, but never access tokens, refresh tokens, users, organizations, or roles.

Each protected request captures a non-secret authentication generation before transmission. Responses from one expired-access wave join one refresh rotation; callers whose captured generation is already stale retry once without another rotation. Same-origin tabs coordinate that rotation with Web Locks and a non-authoritative BroadcastChannel outcome, with a bounded IndexedDB lease fallback where Web Locks are unavailable. A failed outcome is attached to every still-active capture from that wave, so pruning non-authoritative history cannot change a delayed original caller's result.

BroadcastChannel messages share exactly seven fields: protocol, document ID, type, attempt ID, success, generation, and timestamp. Local-storage coordination adds only epoch and bounded outcome ordering; the IndexedDB lease adds only lease owner and expiry. The in-memory BroadcastChannel dedupe retains at most 256 keys for 60 seconds of local receipt time, per-document ordering retains at most 128 entries for 60 seconds, and failed-wave summaries retain at most 64 entries for 120 seconds. All are opportunistically pruned without a perpetual timer. No credential, cookie, session ID, user identity, organization identity, role, email, or provider token is shared. Forged coordination metadata can affect retry timing only: PostgreSQL sessions, memberships, tenants, roles, verification, and onboarding remain the sole authority, and a retry never recursively refreshes.

User Bearer compatibility is retired. A Bearer request receives the same stable unauthorized response regardless of environment flags or claims; the browser client never constructs an Authorization header.

## Session and replay behavior

Refresh credentials are stored only as SHA-256 hashes. Every session has one active refresh token in a family. Rotation is a row-locked transaction that consumes the current token, inserts its replacement, and rotates access/CSRF state. Reuse of a rotated token marks it reused, revokes the active replacement and session, and prevents the family from continuing across processes.

Logout validates the refresh/CSRF pair, locks its durable authority, and transactionally revokes the session plus every active token in the family/session. Cookies are cleared only after commit. HTTP, CSRF, network, or PostgreSQL failure stays visible and retryable in the browser; it does not redirect or claim success.

## Notification preference authority

`notification_preferences` is the sole mounted authority for operational email and SMS choices. All five delivery choices default to `false`; a signup phone or email is only a destination and does not imply consent. Account-security email is mandatory and is not controlled by these fields. Business Profile JSON and browser storage cannot override operational delivery choices.

The generic `organization_account_preferences` row retains only unrelated internal presentation/configuration values. Migration 010 removes operational notification keys from that JSON and prevents them from being reintroduced. Because no durable explicit-consent provenance exists for upgraded legacy booleans, migration 010 deterministically sets all operational delivery choices to `false` while preserving unrelated preferences and notification destinations.

## Jobber OAuth authorization state

Jobber is the only mounted OAuth authorization-state producer in this repository. Its provider-bound state is exactly 32 cryptographically random bytes encoded as a bounded 43-character base64url value. It contains no JWT, JSON, user, durable session, tenant, organization, role, email, or other durable identifier. PostgreSQL stores only the SHA-256 hash and binds it to provider, organization, user, current durable authentication session, creation, expiration, and consumption state.

Migration `011_oauth_authorization_states.sql` is a transaction-body-only additive migration. It creates the dedicated organization-scoped state table, its composite session/tenant foreign key, unique state hash, ten-minute expiration contract, status/time checks, and bounded-cleanup indexes. Issuance and consumption use real PostgreSQL transactions. Consumption row-locks the state, requires exact provider and current request bindings, reloads session, user, membership, role, verification, and onboarding authority, and commits a single-use transition before the provider exchange boundary. Expired pending rows and consumed rows older than 24 hours are cleaned opportunistically in batches of at most 100; cleanup is not a correctness dependency and uses no timer.

The opaque-state service remains lower-level infrastructure for a future reviewed persistence implementation. Its disposable-test capability exercises random issuance, hash-only persistence, expiration, replay rejection, concurrency, restart durability, revoked-session rejection, and tenant isolation. That capability is not supplied by production construction.

Canonical Jobber token persistence is unavailable in PR A, so the mounted production journey is intentionally disabled at a source-owned capability boundary. After normal session, membership, verification, onboarding, and role checks, authorization start returns the stable bounded `jobber_unavailable` `503` before state creation, provider URL construction, or redirect. Callback returns the same bounded `503` before state lookup or consumption, provider exchange, or token save. Status reports `available: false`, `configured: false`, and `connected: false`; disconnect is likewise unavailable. Environment values, request data, browser state, roles, and provider data cannot supply the missing capability.

Provider transmission remains intercepted in local validation. No Jobber credentials are exchanged, discarded, or persisted, and no production or provider destination is contacted. Jobber is not production-ready in PR A; a separately reviewed canonical token repository and source-level capability remain required.

## Migration and readiness

Migration `010_account_session_authority.sql` aborts on normalized-email collisions, null ownership, unsupported roles/statuses, or multiple current subscriptions. It backfills memberships and onboarding only from existing PostgreSQL rows, revokes legacy refresh tokens, and disables the known source-seeded demo and admin credentials. It never reads a JSON data file and is transaction-body-only.

The production migration runner owns one transaction that acquires a PostgreSQL advisory transaction lock, verifies the ledger/checksums, executes every pending migration body, inserts every ledger row, and commits. Schema and ledger therefore roll back together on SQL failure, ledger failure, or pre-commit process/database termination. A lexical verifier removes only the exact outer transaction envelope in legacy migrations 001-009, including valid comment/BOM variants; arbitrary nested transaction statements are rejected. Migrations 001-009 remain byte-identical. PostgreSQL connection or migration failure leaves readiness false.

Inside that same advisory-locked transaction, the runner creates or transactionally rebuilds the ledger to one physical definition and column order: `id`, `filename`, `checksum`, `applied_at`. The final timestamp column is exactly `applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`. A branch-era `TIMESTAMP NULL` value is interpreted using the database session time zone. A known non-null moment is preserved; an unknown null historical timestamp becomes the deterministic sentinel `'-infinity'::timestamptz`, never an invented upgrade-time `NOW()`. Newly executed migrations continue to receive their genuine transaction timestamp.

The rebuild preserves legitimate IDs, filenames, checksums, timestamps, owned serial semantics, and safe sequence state, advancing the next generated ID beyond the greatest retained ID when necessary. It fails closed on unsupported ledger shapes, dependencies, or swap-sensitive metadata such as nondefault ACLs, owners, relation options, tablespaces, rules, publication membership, and comments. Constraint comments and index-relation comments are inspected independently through PostgreSQL catalogs after the advisory/table locks but before any replacement table, rename, drop, alteration, sequence-ownership change, migration body, or ledger insertion. Any non-null comment on any `_migrations` constraint or associated index relation produces the stable internal error `Unsupported _migrations catalog comments`; comment contents are never included. Rejection leaves the original rows, physical catalogs, comments, sequence state, next-ID behavior, and application data unchanged and leaves no replacement table.

Physical convergence therefore applies only to supported histories that pass the metadata preflight. Fresh, genuine-base upgrade, branch-era divergent upgrade, and negative-control comparison include ordinal position, exact types and widths, nullability, defaults, constraint definitions and status, constraint-backed index ownership and status, serial ownership/configuration/state, and next-ID behavior.

### Protected migration checksum authority

The exact committed LF Git blobs are the independent protected authority for migrations 001-009. Production contains immutable source constants for those digests and does not invoke Git or require `.git`. The runtime reads migration files as binary buffers. It accepts exact LF bytes or reverses a pure whole-file CRLF checkout conversion to LF before hashing. It rejects mixed line endings and lone carriage returns and does not trim or normalize spaces, tabs, Unicode, BOMs, trailing whitespace, comments, blank lines, statement order, or final-newline presence. Migration files are never rewritten.

The canonical buffer also supplies the checksum recorded in `_migrations`, so LF and complete CRLF checkouts produce one stable ledger checksum for every migration, including migrations 010-011 and future migration bodies. The production ledger had no checksum column before migration 010, so its first protected backfill receives these canonical LF digests; no previously recorded valid checksum is silently changed.

| Migration | LF Git bytes | Authoritative LF SHA-256 | CRLF checkout SHA-256 formerly embedded at merge |
| --- | ---: | --- | --- |
| `001_initial_schema.sql` | 15,275 | `74ee47a852a376c3f5f8b2a5bf24579d24eb6a20dc8284e8b233a0159e858c14` | `dbbcad4947474777a61a3b230aa8aca54b9a3ef4257301368e39731fa05307e9` |
| `002_seed_data.sql` | 3,973 | `370b2b2cd466817724f4788e104adef3f93d3d8a02bd877f252d1e3d6f588cd5` | `4b124ac5713caaddc4f2316e8c055c6235eb17881c5b4ba5d0edef481a8a63ff` |
| `003_voice_sessions.sql` | 2,729 | `535a47115df60e96a7d18d8b7c557b378aa18391a19eb658750f86faa18d1e1f` | `d37d402df2792a015b6d1f9d3e0f72226298f9a4d9ec7551f629e52c677f41c2` |
| `004_canonical_persistence_v2.sql` | 14,771 | `097f398d0bf37982947d35b04890c396dee2d84ce8acdb34fa5434e13ba1263a` | `946b1819dd4c5205637e9fae91f3b36c28c1688e401f1f2f5b67ffba7d2e1651` |
| `005_canonical_organization_authority.sql` | 4,518 | `b45c61d2da94d6aba753d3d2bbd1ebf657af4626ff1bcbabd2e45434e0e529f6` | `4065d873dd204935cfbd8ea8abe45d2b0b44e80df38ef203359d2863d37c5379` |
| `006_canonical_voice_sessions.sql` | 3,840 | `acde20fd0cfa4ef8e8899f036cac4dd82d9052c12c50cec28014c2ac3cc0daf7` | `236809d3b87367804bbd6c28ccaaca27408fa340020ab3d3b48e3e81da203ec2` |
| `007_canonical_tax_authority.sql` | 1,201 | `c1838c6ea7cd83d12d2b9c3f9bf7740f0c5344d21f06873968527ad1318ac5a0` | `a5f2c8c78fc339790f2993c997ea2cd50134a9ed97de93267cd470b18ea408a6` |
| `008_canonical_demo_authority.sql` | 647 | `a71a0c49be60943ee52e041139c9db3b64c64cbeaf4449dec46571c721fbd1e0` | `c157ac2c10f07bf933b4774ac14584ecc580f93108926b5e53acbfed28263ef2` |
| `009_canonical_voice_provider_identity.sql` | 463 | `a521efdcf96cd90d11e505018f034fd2b93a4998da97823491b5195aa78aef98` | `6ec531dbb385607818c4a70ae69bab7f5d85ff98565d61ad8026c20ef68634fe` |

Binary-safe `git cat-file blob 4618ebcc9386f56655c9fd4bec612d0881fcca51:migrations/<filename>` established each LF value before source editing. Every merged constant equaled the corresponding CRLF digest and differed from the LF digest, proving the nine-file defect without relying on checkout text.

Migration 010 is absent from base `dfff096241d3be4fd1580a741cfe21ee64a5dfb3` and was introduced at `137ad6d473fac69fd5b7ee81aea5e513f3a1e7b4`. Its introduction-time committed blob is 12,043 bytes and hashes to `cac651ea70624f013377e21e74b393a5133f5f6551aed20939a12014ea040a1b`. At `9ec1812630a54be3811ec94155824abc868cecdd`, `b794033e22874145fe7de8708b66c28b5e509b75`, `43752350fc9acbce57a80cc87c212cd9d9bbf53c`, and this final correction, the exact committed blob is 14,419 bytes and hashes to `0087278b1fb0062ba88a4dd7e4699e2e5c4c98d78e822193e2e7c0bff5c9ca48`.

The protected test invokes `git cat-file blob <ref>:migrations/010_account_session_authority.sql` through argument-array process execution with no shell and captures stdout as a raw `Buffer`. It requires a successful Git exit, rejects fatal diagnostics, requires nonempty exact-length output, and never falls back to checkout bytes. SHA-256 is calculated directly from that buffer. A cloned in-memory buffer with exactly one byte changed provides the negative control and produces a different hash without writing a file, index entry, or worktree change. Migrations 001-009 are compared as raw Git blobs across base and current head; migration 011 is compared across `43752350...` and current head.

The previously reported `fe78838214f05ea4a76325fd0881e1b8168103d2cff84d1636ad3b0baeae4fcb` is the hash of a 14,763-byte CRLF-expanded checkout representation and is a reviewer newline-normalization artifact. In a fresh genuine-history Windows checkout, that CRLF working-tree representation coexisted with the authoritative 14,419-byte Git blob; the protected assertion continued to hash only the blob. Migrations 001-011 remain unchanged by this final correction.

## Local correction validation

The emergency hotfix ran the real production checksum path and migration runner against PostgreSQL 18.4 on loopback port 55483 outside OneDrive. The checksum-contract suite and production migration suite passed together: 2/2 suites and 60/60 tests, comprising 36 representation/provenance cases and all 24 physical migration cases. Every protected migration accepted exact LF and complete CRLF bytes with one canonical digest and rejected altered LF and CRLF copies. The shared negative matrix rejected mixed LF/CRLF, lone carriage return, BOM, final-newline addition/removal, trailing-space addition/removal, comment alteration, reordered content, added/deleted content, and an empty file. Git provenance also failed closed for an unavailable executable and unavailable history.

Fresh LF and CRLF databases each recorded migrations 001-011 exactly once and produced byte-for-byte equal ledger filenames and checksums; second startup remained at 11 rows. The real runner also upgraded the already verified disposable restoration of the retained pre-release backup from ledger 001-009 to 001-011, populated canonical checksums, preserved the captured application-table counts, and created no session, refresh token, OAuth state, Business Profile, integration owner, or voice-session authority. The canonical ledger finished in physical order `id`, `filename`, `checksum`, `applied_at`, with sequence state at 11 and the next generated ID safely beyond it.

The production-equivalent local application ran from an LF source copy with no `.git`, a disposable independently generated 64-byte test secret, no provider configuration, and a fresh disposable database. Runtime validation passed, migrations 001-011 completed, and `/api/health` returned HTTP 200 with PostgreSQL and canonical persistence healthy at startup and after a ten-second stability window. The process and port were then stopped and verified clear.

The complete API gate passed 10/10 suites and 129/129 tests. The complete serial gate passed 55/55 suites and 1,130/1,130 tests. No required PostgreSQL suite was skipped. Because the production correction introduced no timer, listener, worker, or persistent handle and browser code is unchanged, a separate `--detectOpenHandles` or browser campaign was not required for this delta.

An initial focused run truthfully failed 21/24 physical migration cases: two schema-equivalence comparisons exposed that the historical fixture was using CRLF checkout SQL rather than the real production-loaded canonical buffer, and two archived-head negative-control databases had not yet been populated. The fixture was corrected to consume the real production `loadMigrations` result, the negative databases were built by the authentic archived `9ec18126...` runner, and the full focused gate was rerun from the beginning to 24/24. A redundant second attempt to restore the retained backup was blocked by the execution guard; the already completed verified restore and captured source/pre/post counts remained authoritative.

The previously published mounted/lower-level Jobber OAuth gate (20/20), mounted external-family gate (9/9), account-containment gate (4/4), and browser gates remain historical validation for otherwise unchanged code. They were not relabeled as independent evidence for this checksum hotfix.

At published head `b794033e22874145fe7de8708b66c28b5e509b75`, installed Chrome and actual Playwright WebKit each passed the complete refresh/BroadcastChannel lifecycle at 1440x900 and 390x844. In every engine and viewport, sixteen simultaneous expired-access responses caused one refresh, two distinct waves caused two total refreshes, two tabs caused one rotation, restart caused no replay or bootstrap storm, and concurrent refresh count never exceeded one. The retained coordination maxima were 256 dedupe keys, 128 document-order entries, and 64 failed-wave summaries. Each viewport processed the required 10,000-message malformed, unsupported, duplicate, and cross-tab floods. Chrome inspected 1,511 local requests and 1,017 API bodies; WebKit inspected 1,511 local requests and 1,034 API bodies. No nonlocal/provider request, Bearer header, credential-bearing storage/global/body, or unexpected unsafe mutation was observed. That historically resolved browser-authentication implementation and `public/js/auth-session.js` are unchanged by this correction.

For this final Jobber UI delta, installed Chrome and actual Playwright WebKit each passed the bounded unavailable journey at 1440x900 and 390x844. Each engine observed 40 requests and six Jobber status responses across the two viewports, zero provider authorization navigations, zero provider destinations, zero OAuth-state row changes, zero Authorization headers, no false connected success, and a visible bounded unavailable result. The only nonlocal browser request was Google Fonts and was locally intercepted; no provider or production destination was contacted.

Two intermediate Chrome runs failed before the final complete rerun: the first exposed a 30-second drain-sentinel timeout after an unchunked 10,000-message duplicate flood; the second exposed a timing-dependent `NOW()+30,001 ms` future-message test vector. The test-only harness was bounded into production-acknowledged chunks and the future vector was moved durably outside the acceptance window. Complete Chrome and WebKit then passed from the beginning. These are implementation-validation results, not independent re-review. GitHub reports zero checks/statuses, so CI remains unavailable rather than passing.

## Operations

Required runtime configuration:

- `DATABASE_URL`
- `AUTH_ACCESS_SECRET` with at least 32 bytes
- optional `AUTH_ACCESS_MINUTES` from 1 through 60 (default 15)
- optional `AUTH_REFRESH_DAYS` from 1 through 90 (default 30)

`ACCOUNT_SIGNUP_ENABLED`, `ACCOUNT_VERIFICATION_DELIVERY_READY`, and `AUTH_BEARER_COMPAT_ENABLED` are not PR A runtime capabilities and are intentionally ignored. No Redis dependency or email-provider configuration is part of PR A. This hotfix preparation made no Railway, deployment, or production-database change.
