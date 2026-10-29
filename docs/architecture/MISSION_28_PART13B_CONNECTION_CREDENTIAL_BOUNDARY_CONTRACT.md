# Mission 28 Part 13B — Connection and credential boundary

Part 13B freezes a tenant-bound provider-account, connection, credential and mode boundary. It does not connect a provider or read a credential. Every Part 13A external adapter remains disabled, provider account provisioning remains an unavailable upstream dependency, and the only current result is `unavailable_no_tenant_bound_provider_account_or_credential`.

## Exact authority

The executable source is [MISSION_28_PART13B_CONNECTION_CREDENTIAL_BOUNDARY_CONTRACT.json](./MISSION_28_PART13B_CONNECTION_CREDENTIAL_BOUNDARY_CONTRACT.json). It binds the released Parts 1B, 1D, 3A, 3B, 7A, 7B, 7D and 13A contracts by normalized-LF digest. Part 13A was independently accepted at source `8efea794a2345620c32f79a951613f222df38380`, normally released through PR #603 and live main `8f2ab04524747f4e92b9f1116ed7ee51ff3d0c11`, and verified by the deployment, instance, image, startup and health identities recorded in the executable contract. Exact rendered hash values and direct applied production migration history were not supplied to this writer and remain unclaimed.

Only a separately trusted active owner whose actor, session subject, membership subject, tenant and exact record scope match may be capability-eligible for `automation_channel_availability_manage`. That capability requires recent authentication. Eligibility creates no provider account, connection, credential, mode, sender, consent, recipient, message or effect authority.

## Tenant, account and mode separation

A future provider account must resolve from an upstream trusted source to one exact tenant, adapter family and environment. Repository source, configuration, a candidate provider identifier or an external account's existence cannot establish that binding. Raw provider account identifiers are not accepted into this contract or owner-readable output.

`testmode` and `livemode` are distinct authority domains. They require different provider-account, connection and credential bindings. Test evidence, credentials, requests, callbacks, messages or outcomes can never be promoted or aliased into live authority. Both modes are currently unavailable; `provider_disabled` is the only current mode.

## Connection and credential lifecycle

The closed connection vocabulary distinguishes disabled/unavailable, disconnected, connect requested, connected, disconnect requested, revoked, rotation required and rotation pending. Requests are intent, not provider outcomes. Every prospective state change is append-only, exact-predecessor bound and sequence-plus-one. Connected status would require separately trusted exact account, credential, least-privilege-review and provider-evidence identities and digests; non-connected states cannot carry that connected evidence. Revocation is terminal for one connection identity; reconnect requires a new identity and trusted resolution.

No provider capability is granted now. A future granted set must equal one separately reviewed minimal capability set; wildcard, administrative, extra, missing, reordered, aliased or undocumented scopes fail closed. A connection or credential never establishes sender, consent, recipient, message, callback, delivery, business, financial, accounting or money authority.

Credential material remains outside browser, logs, metrics, traces, evidence, exports and demo. Only nonsecret internal version identity and metadata may be referenced later. A credential-binding digest must never hash secret bytes. A requested rotation binds an active prior credential and a pending-verification successor. Its verification or failure keeps that exact old/new credential identity and digest pair: verification binds the prior credential as retired or revoked and the successor as active; failure binds the prior credential as suspended from new work and the successor as failed. Every rotation also requires a different old/new version and binding digest, exact event sequence-plus-one, the same tenant/account/adapter/environment and the same least-privilege review. Failed or uncertain rotation stops new provider work and requires reconciliation.

## Privacy, replay and current result

The inspection request is strict plain data with exact fields, exact released-registry binding, canonical digests and stable semantic idempotency. Structural validation precedes property access, serialization, digest and history lookup. Candidate data cannot create or replace actor, account, connection, credential, mode, scope, rotation or success resolution. Exact replay is idempotent; identity conflict and semantic clone reuse fail closed.

The fixed owner-readable label is `Provider connection and credentials are unavailable.` It is nonreflective and contains no account, provider, credential, payload, recipient or message material.

## No-effect and later-slice boundary

Part 13B adds no migration, table, function, route, UI, worker, queue, scheduler, callback, adapter or resolver. It performs no provisioning, connection, disconnection, revocation, credential read/write/rotation, sandbox/live call, recipient contact, message, provider attempt, effect, upstream mutation, financial effect or money movement.

Authenticated callbacks and exact status reconciliation belong to Part 13C; outage/degradation/circuit-breaker/fallback/switching to Part 13D; observability/retention/deletion/lifecycle to Part 13E. Parts 14A–14G remain planned. Provider/private-production/live-recipient/live-money/legal/privacy/regulatory/security and founder visual evidence remain unavailable and unclaimed.
