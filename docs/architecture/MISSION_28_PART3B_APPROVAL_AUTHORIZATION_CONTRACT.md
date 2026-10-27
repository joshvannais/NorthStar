# Mission 28 Part 3B — per-run approval and standing authorization

Status: **Implementation candidate only.** This is a source contract, not a runtime resolver or authorization grant. It adds no route, UI, database object, migration, scheduler, worker, queue, provider, recipient, message, external effect, upstream mutation, accounting action or money authority. Part 3C and later slices remain planned and unimplemented.

## Released inputs

Part 3A is released at accepted source `05a541792adac121f8c51b2cf200c0d18fcfbbf1`, tree `a88024e8140900492d7ac02bcf4e07f020d8b3de`, PR #557, main `1e62336afe2c9e65cccbe1629a62b86855da3ff8`, deployment `7ca335a1-7bf6-4f8d-ae98-a188b891f85d` `SUCCESS/RUNNING`, and image `sha256:201627b8ee00cf950c267bbd522d5538a7c42461c8771de8701463fe790ac40e`. Its second fresh whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and is unclaimed. Startup, migration 273/no274, health, root and demo checks are released evidence.

The [executable contract](MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json) binds the exact normalized-LF identities of Parts 1A–3A. It preserves Part 3A's fixed capability vocabulary and exact server-resolved actor/session/membership-subject binding. No display role, label, event, source fact, preview, policy state, provider evidence or generated content creates authority.

## Exact distinction

| Kind | Exact capability | Exact subject | Reuse boundary |
| --- | --- | --- | --- |
| `per_run_approval` | Owner `automation_run_approve` / `approve_run` | One exact tenant run and its exact proposed-action record and preview | Only the same immutable record may replay idempotently; it never becomes standing authority or transfers to another run |
| `standing_authorization` | Owner `automation_standing_authority_activate` or `automation_standing_authority_change` with the matching operation | One exact policy version and one exact activate/change intent envelope | Only the exact policy version and complete material envelope may replay; it never approves arbitrary runs or survives a policy/source/preview/recipient/effect change |

Both kinds pin one exact authorization identity; tenant; authenticated actor, session subject, active membership subject, capability decision and recent-authentication evidence; policy version; source set; preview; intended recipient identities/classes; intended effect set, action family, channel, provider-disabled mode and internal-only effect class; reason; issue/expiry/trusted-clock evidence; idempotency key; and kind-specific subject. The preview cross-binds the exact policy, source set, recipient set, effect set and kind-specific subject by type, identity and digest, preventing a mix-and-match envelope of independently valid values. A per-run approval additionally requires separately trusted server-resolved evidence for the exact Part 2B `proposed_action` record. That evidence binds its tenant, record ID, record digest, `runId`, policy tuple, source-set digest and currentness marker; the authorization's per-run `runId`, subject ID and subject digest must equal it exactly. A same-tenant different-run value therefore cannot transfer an otherwise valid proposed action or preview. Every value comes from a separate server-owned resolution. The candidate record cannot establish or replace that resolution.

Part 1D remains exact: only `internal_read_digest_task`, `owner_approval_request`, and the owner-only internal-work-item form of `collection_escalation` are conditional first-launch cells, still not implemented. They remain in-app, provider-disabled, and internal-only. `customer_communication`, `secure_document_delivery`, and `financial_reminder` remain unavailable; unsupported upstream mutation or money movement remains permanently denied. This contract cannot authorize those cells by hashing an arbitrary recipient or effect envelope.

## Material change and replay

Every descendant of every material root is material. A changed actor, session, membership, recent-authentication fact, policy, source, currentness marker, preview, recipient, effect, action family, reason, time, idempotency key, run, proposed-action subject or standing intent requires a new preview and a new authorization identity. Recomputing the candidate's material and record digests does not make the changed record authoritative against the old trusted resolution, including when the candidate coherently changes its run while the separately trusted proposed action remains bound to the original run. Exact replay requires the same authorization ID, material digest, record digest and idempotency key and creates no new authority.

Authority expires strictly. Source and preview currentness must be exact. Per-run and standing fields are mutually exclusive. The unsupported upstream-mutation-or-money action family is always denied. An accepted contract record means only `valid_source_contract_record_only_no_runtime_or_effect_authority`; it does not prove activation, scheduling, provider attempt, delivery, reply, business outcome or effect.

## Acceptance and unavailable evidence

Part 3B acceptance requires exact frozen-input hashes, exact two-kind grammar, strict plain-data and identity validation, complete binding/digest checks, separately trusted resolution, full-redigest material-change attacks, same-tenant cross-actor attacks, expiry and replay attacks, kind-confusion denial, unchanged migration 273/no274, exact Node 22.23.3 evidence, and a fresh independent whole-head audit with P0=P1=P2=P3=0.

Runtime subject/capability/recent-authentication resolution; approval or standing-authorization persistence and consumption; activation, scheduling, pause, retry, export, channel and stop controls; provider accounts, credentials, senders, callbacks, templates and deliverability; real recipients/messages/effects; professional legal/privacy/consent/collections/provider/regulatory/security review; private-production evidence; provider sandbox/live money/first-paying-customer validation; hosted load/SLA; exercised restore; physical Safari/devices; manual assistive technology; and founder visual approval remain unavailable and unclaimed.
