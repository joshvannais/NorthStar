# Mission 28 Part 3C — owner limits and mandatory constraints

Status: **Implementation candidate only.** This is a source contract, not a runtime limit resolver or authority grant. It adds no route, UI, database object, migration, scheduler, worker, queue, provider, recipient, message, external effect, upstream mutation, accounting action or money movement. Part 3D and later slices remain planned and unimplemented.

## Released inputs

Part 3B is released at accepted source `56a39854325826982283d78dffed4e039c61335b`, tree `6ae86ee398e47fd75403bb98bcc3259522ec9461`, PR #558, main `d88a0fe294619fa982bc1541affc8052031cc406`, deployment `81bc25de-eb77-413e-8745-97882bdd7c09` `SUCCESS/RUNNING`, running instance `ae88752d-2f49-46bc-9692-adafbd1ba5cc`, and image `sha256:96720a1fc1c5379d53992081046540f28ddf1c42307cb34f0b824fe737ef8974`. Its required second fresh whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and is unclaimed. Dockerfile/start binding, canonical startup, migration 273/no274, healthy PostgreSQL canonical persistence, health, root and demo checks are released evidence.

The [executable contract](MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json) binds the normalized-LF identities of Parts 1A–3B. Parts 1D, 2A, 3A and 3B remain exact: current launch cells are internal and provider-disabled; limit changes belong to a new exact policy version and exact owner standing authorization; a limit record creates no runtime authority.

## Eleven exact dimensions

| Dimension | Owner may only narrow | Mandatory behavior |
| --- | --- | --- |
| Frequency | Raise a minimum interval or lower finite hourly/daily/weekly maxima | Finite safe integers, minimum interval at least one second, hour ≤ day ≤ week |
| Recipient | Choose an ordered subset and lower the count, including deny-all | Exact tenant-private resolution, at most one internal recipient, zero external recipients |
| Channel | Choose an ordered subset | `in_app_passive` and `provider_disabled` only; no fallback |
| Time window | Intersect eligibility with ordered, non-overlapping local windows | Exact server-resolved tenant timezone; no scheduler/effect authority |
| Quiet hour | Add quiet windows | Quiet time is unioned and may only suppress; it cannot reroute or authorize |
| Action count | Lower per-evaluation and pending maxima | At most one action per evaluation; no batch or fan-out |
| Invoice value | Set or lower one exact-currency minor-unit ceiling for reviewed internal collection | Not applicable elsewhere; never changes an invoice or grants a financial effect |
| Aging stage | Choose an ordered subset of exact current Mission 27 buckets for reviewed internal collection | Not applicable elsewhere; aging is evidence, never permission |
| Campaign | Disable only | Campaign grouping, identity, batch and fan-out are unavailable |
| Daily/weekly volume | Set or lower finite internal-action maxima | Daily ≤ weekly; no external volume |
| Provider spend | Disable only | Provider-disabled and exactly zero; no credentials, attempt or money authority |

Every dimension is present in one exact order. Missing, unknown, duplicated, reordered, ambiguous, null, unbounded, fractional, non-finite or contradictory values fail closed. Numeric values are bounded safe integers. Allowlists intersect; maximums take the minimum; minimum intervals take the maximum; allowed windows intersect; quiet hours union; and any mandatory denial wins. An empty owner allowlist or zero owner maximum is a valid deny-all narrowing, never an error default.

## Current launch boundary

Only `internal_read_digest_task`, `owner_approval_request`, and the owner-only internal-work-item form of `collection_escalation` may have a contract profile. Their recipient classes stay inside the released Part 1D cell; channel is `in_app_passive`; provider mode is `provider_disabled`; external recipients, external messages, provider attempts, upstream mutations and money effects remain zero.

Invoice-value and aging-stage constraints are available only as eligibility restrictions over the exact current Mission 27 invoice and reviewed collection handoff used by the internal collection work item. They cannot alter an amount, due date, bucket, invoice, fee, payment, collection state or accounting fact. Campaigns and provider spend remain disabled. Customer communication, secure document delivery, financial reminders, external collection escalation, unsupported upstream mutation or money movement remain unavailable regardless of an owner-supplied value or digest.

## Authority, currentness and replay

The profile binds one exact tenant, policy version/digest, source-set digest/currentness, action family, mandatory-constraint manifest, server-resolved tenant timezone and accepted Part 3B owner standing authorization. The separately trusted policy authority must already bind both the profile digest and the same exact action family; a profile cannot claim a broader launch cell than its policy action. Candidate-supplied policy, timezone, manifest or authorization values never establish authority. A per-run approval cannot create or weaken standing limits.

Every constraint leaf is material. A change requires a new policy version, preview and exact Part 3B standing authorization. Recomputing the candidate digest does not make changed limits authoritative against the prior trusted policy. Exact replay requires the same profile identity and digest; a conflicting replay fails. Historical runs retain the exact profile that governed their immutable decision evidence.

## Acceptance and unavailable evidence

Part 3C acceptance requires exact frozen-input hashes, exact eleven-dimension order and grammar, fixed mandatory-manifest digest, independently trusted policy/timezone/standing-authorization binding, complete owner-narrowing matrices, full-redigest attacks, strict plain-data validation, unchanged migration 273/no274, exact Node 22.23.3 evidence, and a fresh independent whole-head audit with P0=P1=P2=P3=0.

Runtime profile resolution, persistence or consumption; scheduling and immediately-pre-effect limit evaluation; provider accounts, credentials, callbacks, costs or spend reconciliation; real recipients/messages/effects; professional legal/privacy/consent/collections/provider/regulatory/security review; private-production evidence; provider sandbox/live money/first-paying-customer validation; hosted load/SLA; exercised restore; physical Safari/devices; manual assistive technology; and founder visual approval remain unavailable and unclaimed.
