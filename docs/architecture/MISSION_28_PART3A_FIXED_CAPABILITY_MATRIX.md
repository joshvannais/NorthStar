# Mission 28 Part 3A — fixed capability matrix

Status: **Implementation candidate only.** This source contract assigns no runtime capability, approval, activation, pause, retry, export, channel, provider, recipient, scheduler, worker, external-effect, upstream-mutation or money authority. Part 3B and later slices remain planned and unimplemented.

## Released authority and vocabulary

The contract consumes Parts 1A–2D only through the exact normalized-LF hashes recorded in the [executable matrix](MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json). Part 2D is released at source `98c4b3562ad48787472584ca64c601d584c2427f`, PR #556, main `529286cf2d513df93680e2c236e37f562782cb52`, tree `cb2f7072f475e927f75ee3b562884adf01234d70`, deployment `f40e401a-649f-42b3-a1cc-71dbd0ffce4d` `SUCCESS/RUNNING`, and image `sha256:586afe8103acc0e4f27d5967e8a8554876d7f5f51dc38bd7c7f4a98e2c320337`. Production source and applied migrations are 269/269 through exact migration 273 with no 274.

The only membership identifiers in this matrix are the released canonical access roles `owner`, `admin`, `member`, and `viewer` from `src/auth/permissions.js`. They are server-resolved tenant membership identifiers, not display names. A display role, job title, team title, operational label, case-folded value, prefix, suffix, fuzzy match, alias, custom role or claimant-supplied role does not grant a capability. Mission 29 retains custom-role, enterprise-threshold, SSO/MFA and organization-scale governance ownership.

The first-launch Part 1D capability names remain released inputs with their original role and recipient vocabulary. They are not aliases for Part 3A. In particular, Part 1D `staff` does not silently become canonical `member`, and `automation_approval_decide` does not silently become run approval or standing authorization.

## Fixed matrix

| Capability | Exact operation | Owner | Admin | Member | Viewer | Consequence and fixed scope |
| --- | --- | --- | --- | --- | --- | --- |
| `automation_view` | `view_automation` | Tenant-wide | Tenant-wide | Exact assigned internal records only | None | Tenant-private read only; no draft, approval, activation, retry, export or effect |
| `automation_policy_draft` | `draft_policy` | Exact tenant policy drafts | Exact tenant policy drafts | None | None | No-authority draft only; no validation, approval, activation, scheduling or effect |
| `automation_run_approve` | `approve_run` | One exact tenant run preview | None | None | None | Consequential per-run approval eligibility; Part 3B still owns approval evidence |
| `automation_standing_authority_activate` | `activate_standing_authority` | One exact policy version | None | None | None | Standing authority remains unavailable until Parts 3B/3D |
| `automation_standing_authority_change` | `change_standing_authority` | One exact policy-version transition | None | None | None | Change requires a new immutable version/lifecycle event; no history rewrite |
| `automation_pause` | `pause_automation` | Exact tenant or policy scope | Exact tenant or policy scope | None | None | Authority-reducing eligibility only; no implied resume or in-flight-effect cancellation |
| `automation_retry_reviewed` | `retry_action` | One exact failed or reconciled action unit | None | None | None | Retry remains unavailable until reconciliation and Parts 6D/6E authority |
| `automation_evidence_export` | `export_evidence` | Exact minimized tenant evidence | Exact minimized tenant evidence | None | None | No secrets, credentials, message/document bodies, public tokens or unnecessary customer data |
| `automation_channel_availability_manage` | `manage_channel_availability` | Exact tenant channel availability | None | None | None | Cannot create credentials, connect a provider, establish consent, enable a channel or authorize a send |
| `automation_tenant_stop_operate` | `operate_tenant_wide_stop` | Exact tenant global stop | Exact tenant global stop | None | None | Static assignment only; Part 3D owns engage/release/drain/evidence semantics and release is never inferred from engage authority |

Run approval, standing authority activation/change, reviewed retry, channel management and minimized evidence export require recent authentication in the fixed matrix. Runtime definitions of freshness and proof remain unavailable until their owning later slices. Pause and tenant-stop eligibility are fail-safe assignments, but this slice creates no control and does not claim that any queued, leased, in-flight, uncertain or completed effect was stopped.

## Fail-closed subject resolution

Every future capability decision must resolve an exact authenticated actor and session, reread one exact active tenant membership, resolve the operation and record scope from server authority, enforce the row's recent-authentication requirement, and match one exact matrix row. Actor tenant, session tenant, membership tenant, requested tenant and record tenant must agree. Capability ID, operation and record scope must match one exact grant. Missing, stale, inactive, suspended, cross-tenant, unknown, duplicate, wildcard, case-folded, prefixed, suffixed, fuzzy, delegated, inherited, chained, impersonated or ambiguous inputs deny.

An eligible result means only `eligible_contract_only_no_runtime_authority`. It is not an approval, activation, schedule, provider attempt, delivery, retry, export, external effect or outcome. A capability cannot grant itself, and no event, source fact, display role, Part 1D label, policy document, AI output or provider callback creates capability authority.

## Acceptance and unavailable evidence

Part 3A acceptance requires exact frozen-input hashing, exact ten-row/order/role/scope symmetry, complete positive grant enumeration, display-label independence, cross-tenant and inactive-membership denial, operation/scope mismatch denial, high-consequence owner-only denial, no implicit Part 1D aliases, mutation/drift rejection, unchanged migration 273/no274, exact Node 22.23.3 evidence and a fresh independent whole-head audit with P0=P1=P2=P3=0.

Runtime capability resolution/enforcement; per-run approval and standing authorization; pause/retry/export/channel/global-stop controls; routes/UI/workers/schedulers/providers; provider accounts, credentials, senders, callbacks, templates or deliverability; real recipients/messages/effects; professional legal/privacy/consent/collections/provider/regulatory/security review; private-production evidence; provider sandbox/live money/first-paying-customer validation; hosted load/SLA; exercised restore; physical Safari/devices; manual assistive technology; and founder visual approval remain unavailable and unclaimed.
