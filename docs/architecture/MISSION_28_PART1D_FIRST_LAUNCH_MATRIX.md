# Mission 28 Part 1D — first-supported launch matrix and acceptance contract

Status: **Implementation candidate only.** This static matrix completes the Part 1 planning contract but implements no route, UI, policy, task, worker, queue, provider, recipient, message, document delivery, financial reminder, collection communication, database record, migration, feature flag, demo action, or production effect.

The executable authority is [`MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json`](MISSION_28_PART1D_FIRST_LAUNCH_MATRIX.json). It consumes the released Part 1A authority, Part 1B inventory, and Part 1C action/risk catalog as immutable normalized-LF inputs. Part 1D does not revise their ownership, dispositions, threats, or denials.

## First-supported cells

The first launch is intentionally internal and provider-disabled:

| Action family | Owner | Risk | First-launch posture | Exact effect boundary |
| --- | --- | --- | --- | --- |
| `internal_read_digest_task` | Mission 28 tenant-private internal automation policy | `internal_sensitive` | Conditional, not implemented | One passive in-app internal item from one exact accepted source snapshot; no external or upstream effect. |
| `owner_approval_request` | Mission 28 owner-control contract | `owner_attention` | Conditional, not implemented | One in-app request to the exact tenant owner; requesting or deciding cannot execute an unavailable downstream effect. |
| `customer_communication` | Mission 28 approved customer-communication policy | `external_communication` | Unavailable | No country/region, consent, quiet-hour, language, provider, retention, or professional-review gate is accepted. |
| `secure_document_delivery` | Mission 28 approved delivery policy over upstream-owned documents | `sensitive_document_delivery` | Unavailable | Existing link creation/copy stays upstream/manual and is not automated delivery. |
| `financial_reminder` | Mission 28 approved reminder policy over Mission 27 financial facts | `financial_communication` | Unavailable | No automated billing recipient, channel, legal/provider, retention, or effect authority is accepted. |
| `collection_escalation` | Mission 28 human-controlled collection policy over a Mission 27 reviewed handoff | `collection_communication` | Conditional internal owner work item only, not implemented | One owner-only work item; no customer contact, legal escalation, provider, financial mutation, or money effect. |
| `unsupported_upstream_mutation_or_money_movement` | No Mission 28 owner | `prohibited_mutation_or_money` | Deny unsupported | No input, role, provider, evidence, demo, flag, or later Mission 28 policy may authorize it. |

“Conditional” does not mean currently available. It means later slices may implement the cell only after every named policy, retention, migration, currentness, privacy, performance, audit, and release gate is accepted. The matrix contains no `allow`, `execute`, `send`, `deliver`, `charge`, `refund`, `collect`, `mutate`, or provider-success decision.

## Source, role, channel, recipient, and region boundaries

Seven source classes cover exact accepted facts from Missions 20–27. Each is read-only to Mission 28 and stays owned upstream. First-launch actions bind one tenant and one exact source snapshot; event, elapsed time, prediction, recommendation, callback, label, and evidence remain ineligible as permission.

The fixed launch roles are `owner`, `admin`, and `staff`, but role names do not independently grant authority. The owner may later view/prepare internal work, create/decide owner requests, and view/prepare the internal collection work item. Admin may view/prepare ordinary internal work and create an owner request, but cannot decide it or operate collection escalation. Staff is assigned-view-only. No role receives external-effect or upstream/money-mutation capability.

`in_app_passive` is the only conditional first-launch channel. Existing native/manual handoffs remain manual and excluded from Mission 28 effect evidence. Email, SMS, secure-link delivery, and provider callbacks are unavailable as execution channels. The only conditional recipients are exact same-tenant owner/admin/assigned-staff identities within their capability and record scope; customers, billing contacts, leads/prospects, collection agencies, legal/credit/enforcement recipients, and all widened external recipients are unavailable or unsupported.

Internal actions preserve accepted tenant timezone/region metadata without claiming country eligibility or legal meaning. No country or region is accepted for automated external execution. `en-US` is the only first-launch internal interface language; no external customer-content language is accepted. Authenticated membership plus exact capability is an internal product authority, not customer communication consent or a legal basis. Passive in-app state creates no interruptive quiet-hour exception; every later external action requires accepted tenant timezone/quiet-hour rules and professional review.

## Providers, modes, limits, retention, and flags

Provider mode is `none_internal` with `provider_disabled` required by default. Sandbox and live modes are unavailable. Per action unit the frozen maximum is one tenant, one source snapshot, one proposed action, and one internal recipient. External recipients/messages, provider attempts/retries, upstream mutations, money movements, batch, and fan-out are all zero or unavailable.

Part 1D creates no runtime records. Runtime retention/deletion/export remains unavailable until Parts 2D and 13E accept exact rules; launch without those rules fails closed. All named global, tenant, external-effect, provider-effect, and money-effect flags remain false and unimplemented. The fictional demo must remain isolated, labeled, resettable before runtime support, and have zero paid-data, recipient, credential, provider, money, and external effects.

The functional decision bound is one source snapshot, one action unit, one internal recipient, no external/provider work, at most 65,536 input bytes, and a 2,000 ms mounted-local deadline. That deadline is a future functional acceptance bound, not hosted load, percentile, capacity, or SLA evidence.

## Unavailable and migration rules

Missing or ambiguous identity/capability; stale, mixed, replayed, cross-tenant, or unavailable source/authority; unsupported recipient/channel/country/language; absent retention or professional review; unavailable provider capability; uncertain provider outcome; Part 1B quarantine/manual/demo/upstream disposition used as authority; any external/upstream/financial/legal/money effect; and any exceeded size/deadline/resource bound all return unavailable or a fixed denial without fallback.

Part 1D adds no migration. The source tree remains 268 migrations through 272/no273. Any later migration must be additive, reviewed, tied to exact later-slice authority, and independently reconciled; no destructive rewrite, implicit legacy adoption, production SQL, or applied-status claim is permitted here.

## Audit and release sequence

Writer evidence is not independent. The exact sequence is: freeze one clean remote head; fresh isolated whole-head audit; same-writer correction if needed; whole corrected-head re-audit; one normal PR/merge; one automatic deployment; then passive startup, migration, health, root, and demo verification. No manual deployment, configuration mutation, provider call, or live effect is part of this slice.

Part 1 exits only after independent acceptance confirms all 49 Part 1B surfaces and 181 source references retain one of six dispositions, all seven Part 1C action families retain exact owner/risk classes, the three conditional first-launch families are bounded above, the three external families remain unavailable, the mutation/money family remains unsupported, and all 16 Part 1C contradiction cases plus every Part 1D matrix mismatch fail closed.

## Evidence limits

Part 1D independent audit, PR, merge, deployment, release, and runtime implementation; provider accounts/credentials/senders/callbacks/templates/capability/sandbox/deliverability/live mode; automated customer communication, secure delivery, financial reminder, external collection escalation, real recipients/messages/provider effects/live money; professional legal/privacy/communications-consent/collections/debt/consumer-protection/country-region/regulatory/provider/security review; private-production evidence; hosted load/SLA; exercised disaster restore; physical Safari/devices; manual assistive-technology review; and founder visual approval remain unavailable and unclaimed.
