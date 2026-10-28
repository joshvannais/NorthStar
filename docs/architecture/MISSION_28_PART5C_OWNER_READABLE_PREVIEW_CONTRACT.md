# Mission 28 Part 5C — owner-readable no-effect preview

Status: **implementation candidate only**. This slice freezes an immutable, tenant-private preview contract. It mounts no resolver, store, route or UI and creates no eligibility, approval, scheduling, recipient, provider, effect, upstream-mutation, accounting or money authority.

The executable authority is [MISSION_28_PART5C_OWNER_READABLE_PREVIEW_CONTRACT.json](MISSION_28_PART5C_OWNER_READABLE_PREVIEW_CONTRACT.json). Its baseline is released Part 5B at main `0f942b0758297b4514847783b49c6812fa50e71d`, tree `584c7388e382c3cf071f65945991e7a17eec90d8`.

## Exact trusted material

A preview consumes one complete immutable Part 5B output plus separately trusted tenant-private resolutions. It never accepts the candidate's own claim about the viewer, source, recipient, channel, content version, time, limits, suppression, governance or expected effect. The authenticated actor, session and membership resolve to the same active tenant subject, hold `automation_view`, and are an owner or administrator. Cross-tenant and cross-actor substitution fails closed.

The source projection names the exact Part 4 trigger, record identity, event kind, transition head, effective snapshot, source-owned event time, trusted observation time, currentness and source-set digest used by the evaluation. Changed material requires a new evaluation and a new preview. A digest recomputation cannot repair a retargeted source or viewer.

## What the owner can read

The output states, using closed codes only: what would happen; why; which exact source assumptions were used; the UUID/digest-bound intended internal recipient set; the provider-disabled in-app channel with closed unavailable runtime state; the absence of an external document or message version; the separately trusted canonical IANA tenant time zone and the fact that Part 6 scheduling is unavailable; the exact Part 3C limit manifest and profile; the exact suppression evidence; one hypothetical, nonexecuted internal record and zero external effects; and the closed Part 3D conditions that would stop later work.

Part 5B reasons and predicate explanations are copied exactly and remain deterministic. Unknown or unavailable values are displayed as unavailable; they are never filled in or narrated as facts. The Part 5B reevaluation hint is not an execution time. Current first-launch templates have no external document/message body or version, no provider, one internal recipient maximum and zero external/message/money/upstream effects.

An `approval_required` evaluation may produce one no-effect preview for a later Part 3B per-run approval to bind by exact preview ID and digest. That approval requires an entirely new Part 5B evaluation; the preview never upgrades its own evaluation. Any preview of a later eligible evaluation is display evidence only and cannot replace the preview already bound by the authorization.

## Privacy and no-effect boundary

The preview contains stable identifiers, closed codes, digests, versions, timestamps, a time-zone identifier and internal recipient classes. It contains no email, phone, address, customer or recipient name, message/document body, provider token, credential, secret, payment instrument or bank data. Candidate free text is forbidden.

The immutable preview digest proves only that the same no-effect preview material was projected. It is not current authority and cannot be used as approval, a schedule, a provider request, proof of delivery, proof an effect stopped, an upstream mutation, accounting evidence or money authority. Part 5D collision/dry-run work and all Part 6+ runtime execution remain planned and unimplemented.

## Unavailable evidence

Mounted preview resolution/storage/routes/UI, runtime limit or suppression enforcement, pre-effect revalidation, scheduler/queue/worker/provider/recipient/effect execution, provider sandbox/live systems, real recipients, live money, private-production proof, hosted load/SLA, professional legal/privacy/provider/regulatory review, physical Safari/devices, manual assistive technology and the founder visual verdict remain unavailable and unclaimed.
