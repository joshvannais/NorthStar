# Mission 28 Part 8C — Shared delivery version and idempotency contract

Status: **Implementation candidate only.** This contract creates no send, native handoff, policy execution, provider request, message, delivery or customer evidence.

## One shared boundary

Manual quick-send, native handoff and policy-driven delivery all consume the same server-resolved material: tenant, exact immutable customer-safe document version and revision, source resolution, content preview, sender/recipient resolution, communication-permission resolution, channel resolution, canonical Part 3B authorization, and—only for policy delivery—the exact policy ID, version and digest. Every identity and digest is independently resolved. Candidate data cannot create or retarget authority.

Manual quick-send and native handoff require one exact `per_run_approval` and carry no policy binding. Policy-driven delivery requires one exact `standing_authorization` and exact policy binding. Part 8C does not create a third authorization kind and does not redefine Part 3B's authorization-material digest.

The server-recomputed material digest and idempotency-key digest cover delivery mode, exact document version, preview, recipient, permission, channel, authorization and policy material. Exact same identity and material is an idempotent no-effect replay. The same identity with changed material, the same material under another identity, a delivery-mode relabel, or cross-tenant/source/policy reuse is denied.

## Revisions and history

A different document version identity, revision or digest is different material. It requires a new content preview and either a new per-run approval or a newly resolved exact material binding under the matching standing authorization, plus a new idempotency key. Earlier immutable request snapshots are never rewritten or reattached. They do not become proof of send, provider acceptance, delivery, reply, opt-out or customer outcome.

## Current truthful availability

Part 8A supplies one exact-current Mission 24 estimate/quote subject, but external delivery remains unavailable. Part 8B proves that no exact issued/current customer-safe Mission 27 financial-document subject exists, so financial-document material is denied before a request identity could be created. Native operating-system handoff and policy delivery executors are not mounted. Therefore all three modes remain no-effect and unavailable, and no migration 288, intent row, provider identity, message, link, handoff, delivery or response is created.

The executable contract is [MISSION_28_PART8C_SHARED_DELIVERY_VERSION_IDEMPOTENCY_CONTRACT.json](MISSION_28_PART8C_SHARED_DELIVERY_VERSION_IDEMPOTENCY_CONTRACT.json). External/provider/live evidence, private-production customer data, physical Safari/devices, manual assistive technology, professional legal/privacy/provider review and founder visual approval remain unavailable and unclaimed.
