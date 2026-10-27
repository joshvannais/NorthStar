# Mission 28 Part 2C — policy lifecycle and historical binding

Status: **implementation candidate only.** This is a source-contract definition. It does not activate a policy, schedule work, persist lifecycle state, call a provider, contact a recipient, mutate upstream facts, move money, change accounting, create UI/demo behavior, or grant runtime authority.

The executable authority is [MISSION_28_PART2C_POLICY_LIFECYCLE.json](MISSION_28_PART2C_POLICY_LIFECYCLE.json). It freezes the exact lifecycle grammar over the released Part 2A policy and Part 2B immutable-record contracts without borrowing Part 2D persistence, trusted-time, canonicalization, RLS, retention, indexing, or restart scope.

## Append-only lifecycle

Each policy version begins with an immutable `draft_create` event. The only ordinary path to activity is `draft` → `validated` → `previewed` → `active`. Validation and preview are separate evidence. Activation additionally requires exact validation, preview, authority, policy, source, and currentness bindings. Part 2C defines those requirements but grants no activation authority.

An active version may be paused; only a paused, nonterminal version may resume, and resume requires the exact still-current validation and preview evidence for that immutable policy version plus current authority and currentness evidence. Superseded, expired, retired, and emergency-stopped versions are terminal. They cannot resume, reactivate, accept another terminal event, or silently attach to a newer authority.

Every lifecycle event has one exact tenant, policy tenant/ID/version/digest, sequence, operation, predecessor ID/digest/state, idempotency digest, source snapshot, prerequisite evidence, currentness, payload, payload digest, and event digest. Records are append-only. Skips, forks, gaps, duplicates, reordered events, stale bindings, cross-tenant/cross-policy reuse, conflicting idempotency, or in-place mutation fail closed. Draft creation, validation, preview, activation, resume, supersession, and rollback-draft creation require exact-current policy and source authority. Coherently stale or unavailable authority cannot create or continue active authority. It may only support the explicitly authority-reducing pause, expiry, retirement, or emergency-stop decisions under their other exact requirements.

## Supersession, expiry, retirement, and emergency stop

Supersession is terminal for the old version and requires one exact same-tenant, same-policy-ID successor at the immediately next version and a distinct canonical digest. A future atomic authority must accept the successor before the old version becomes superseded. Forks, multiple successors, version gaps, and reactivation of the old version are denied.

Expiry requires future trusted-time evidence and cannot be inferred from caller time. Retirement requires future control authority. Emergency stop is terminal for that policy version, never claims that queued or in-flight effects were reversed, and cannot be bypassed by retry, resume, supersession, or rollback. Recovery requires a new append-only version with validation, preview, currentness, and new authority.

## Bounded rollback and history

Rollback never rewinds or reactivates an old policy version. It creates a new draft at the exact next version. The rollback lifecycle event includes a separately trusted current/immediate-predecessor policy binding, and the target policy's `previousVersionDigest` must equal that immediate predecessor's policy digest. A separate rollback-source binding may name an older version that previously reached active; it cannot replace the immediate-predecessor link or name the new target itself. Reviewed configuration may be copied, but the new version receives a new digest and must traverse draft, validation, preview, and activation with new authority.

Historical runs remain permanently bound to the exact tenant, run ID, policy tenant/ID/version/digest, source snapshot digest/currentness, and lifecycle event that created them. A separately trusted immutable run/lifecycle lookup by exact tenant and run ID must return that complete binding; record-supplied tuples and recomputed digests cannot establish their own authority. Pause, resume, supersession, expiry, retirement, emergency stop, or rollback cannot rebind an old run to a newer policy or source. Corrections append new run/evidence records under their own exact bindings; they never rewrite history.

## Acceptance and unavailable evidence

Part 2C acceptance requires the exact lifecycle/terminal-state vocabulary, transition table, immutable event grammar, currentness and idempotency rules, bounded rollback, emergency-stop behavior, supersession uniqueness, historical-run binding, exhaustive forged/skipped/reordered/stale/cross-tenant/cross-policy/replay/fork/rebound tests, zero runtime/schema/migration change, and a fresh independent whole-head audit with P0=P1=P2=P3=0.

Part 2C has no independent acceptance, PR, merge, deployment, or release evidence. Part 2D storage and trusted-time authority, Part 3 controls, providers, real recipients/messages/effects, professional legal/privacy/consent/collections/debt/regulatory/provider/security review, live money, private-production evidence, hosted load/SLA, exercised restore, physical Safari/devices, manual assistive-technology review, and founder visual approval remain unavailable and unclaimed.
