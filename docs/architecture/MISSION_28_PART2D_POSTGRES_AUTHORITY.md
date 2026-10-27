# Mission 28 Part 2D — PostgreSQL authority, canonicalization, retention and restart

Status: **implementation candidate only.** Migration 273 establishes tenant-private, append-only PostgreSQL storage for the released Part 2A policy, Part 2B record and Part 2C lifecycle contracts. It grants no application-role storage capability, policy activation, route, UI, scheduler, worker, queue, provider, recipient, message, upstream mutation, accounting effect or money effect.

The executable authority is [MISSION_28_PART2D_POSTGRES_AUTHORITY.json](MISSION_28_PART2D_POSTGRES_AUTHORITY.json). It binds every released Part 1A–2C artifact by normalized-LF SHA-256 and records the exact Part 2C release. [Migration 273](../../migrations/273_canonical_automation_authority_v1.sql) is the sole schema change. [The production canonicalizer](../../src/automation/canonicalJson.js) provides the descriptor-first pre-JSON boundary that PostgreSQL `jsonb` cannot recover after parsing.

## Authority and isolation

Eight append-only tables separate policy versions, exact upstream source bindings, exact source-set snapshots, lifecycle events, typed run/effect/evidence records, historical run bindings, legacy-conversion reviews and the closed retention-class registry. Every tenant table has enabled and forced RLS. A transaction-local exact tenant identity and the table-owning migration role are both required; the runtime role has neither direct table privileges nor function execution. This is deliberate: Part 2D establishes database authority, while Parts 3 and later must separately accept capabilities, approvals and runtime entry points.

Every supported owner-only storage function derives the tenant from exact canonical data, establishes the transaction-local tenant boundary, uses database statement time, validates the stored policy, source tuple, exact source set or causal predecessor, and appends or returns one exact idempotent replay. A lifecycle event or run record can use a source set only after every complete tenant/class/owner/id/version/digest/currentness tuple and the canonical ordered set digest exist in the owner-only immutable source registry. It cannot turn the caller-supplied tuple or source-set digest into authority. Updates, deletes and truncation fail through immutable triggers.

Lifecycle relationship fields cannot establish their own authority. Supersession resolves the exact next stored policy version and its stored active-event digest before the older version may become superseded. Bounded rollback creates a new policy version whose previous-version digest equals the exact stored immediate predecessor, while its rollback-source activation and terminal digests resolve from older stored lifecycle history. Other operations must carry no related-policy or rollback-predecessor binding. Database statement time denies activation or resume at or after policy expiry and denies premature expiry evidence.

## Exact time, canonicalization and currentness

`statement_timestamp()` is the only recorded-time source. Storage is `timestamptz(6)`; transaction-local display is UTC; the canonical evidence format is `YYYY-MM-DDTHH:mm:ss.ffffffZ`. Callers cannot provide `recorded_at`. This trusted clock supports database evidence and exact policy expiry storage only. It does not create a scheduler, activation, effect deadline or provider time authority.

Canonical data is plain JSON data only with bounded depth, node count, keys, arrays, strings and total UTF-8 bytes. Object keys are sorted by Unicode code point exactly as PostgreSQL UTF-8 `C` ordering, arrays preserve order, numbers are safe integers and negative zero is denied before `jsonb`. Strings and keys must contain valid Unicode scalar values; U+0000 and unpaired surrogates fail before hashing because PostgreSQL text cannot represent them. Exact canonical text is required, so whitespace, duplicate-key collapse, alternate number spelling and noncanonical key order fail closed. Each policy, payload, record, lifecycle event and historical binding is recomputed under its released namespace. Policy, source, causal-parent and historical-run tuples must resolve from stored immutable authority.

## Retention, migration and restart

Retention classes distinguish policy history, source snapshot history, lifecycle history, internal decisions, effect evidence, historical run bindings and future reviewed legacy conversions. No duration or deletion authority is invented: every class is retained with no automatic deletion pending professional and product review. Migration 273 never scans, imports or converts legacy data. The conversion table has no accepted write path and cannot name a converted policy.

Migration replay remains checksum-bound and additive. Fresh and through-272 upgrades must create the same schema, applying the migration twice is idempotent through the migration ledger, and a new database connection must read the exact stored documents without recanonicalizing or rebinding them. No production migration or restart evidence is claimed by this candidate.

## Acceptance and unavailable evidence

Part 2D requires exact Node 22.23.3 canonicalizer and contract tests, fresh disposable PostgreSQL evidence through migration 273, separated migration/runtime-role evidence, forced-RLS/cross-tenant/direct-access denials, immutable/digest/currentness/bounds/index/retention/zero-conversion checks, upgrade/replay/new-connection evidence, compatibility with released Parts 1A–2C, and an independent whole-head audit with P0=P1=P2=P3=0.

Independent acceptance, PR, merge, deployment, private-production persistence, runtime capabilities, providers, real recipients/messages/effects, legal/privacy/provider review, hosted load/SLA, exercised restore, physical Safari/devices, manual assistive-technology review and founder visual approval remain unavailable and unclaimed.
