# Mission 28 Part 1C — action and risk catalog

Status: **Implementation candidate only.** This is a static classification and threat contract. It grants no runtime, launch, provider, recipient, message, document-delivery, financial, collection, upstream-mutation, or money authority. Part 1D and all later slices remain planned and unimplemented.

The executable source of this catalog is [`MISSION_28_PART1C_ACTION_RISK_CATALOG.json`](MISSION_28_PART1C_ACTION_RISK_CATALOG.json). It consumes the released Part 1A authority/effect boundary and released Part 1B surface inventory as frozen inputs. Their line-ending-independent normalized-LF SHA-256 identities are `92DAD00F8A7623A87C780FC1AC965B66569616650F53FDED8454F51872458179` and `62E37CF07A26F0C2B1A50A2C2F0EB927695500DB32B44B16E5B431F594B93142`. It does not revise either input and does not convert any Part 1B surface into authority.

The Part 1B artifact's candidate-era status and statement that Part 1C was then unimplemented are retained inside that frozen historical input. They do not override the canonical roadmap and ledger's current released-Part-1B/current-Part-1C truth.

## Action families and risk classes

| Order | Action family | Owner boundary | Risk class | Part 1C decision |
| ---: | --- | --- | --- | --- |
| 1 | `internal_read_digest_task` | Mission 28 tenant-private internal automation policy | `internal_sensitive` | `catalogued_not_authorized` |
| 2 | `owner_approval_request` | Mission 28 owner-control contract | `owner_attention` | `catalogued_not_authorized` |
| 3 | `customer_communication` | Mission 28 approved customer-communication policy | `external_communication` | `catalogued_not_authorized` |
| 4 | `secure_document_delivery` | Mission 28 approved delivery policy over one exact upstream-owned document | `sensitive_document_delivery` | `catalogued_not_authorized` |
| 5 | `financial_reminder` | Mission 28 approved reminder policy over exact Mission 27 facts | `financial_communication` | `catalogued_not_authorized` |
| 6 | `collection_escalation` | Mission 28 human-controlled policy over one reviewed Mission 27 handoff | `collection_communication` | `catalogued_not_authorized` |
| 7 | `unsupported_upstream_mutation_or_money_movement` | No Mission 28 owner | `prohibited_mutation_or_money` | `deny_unsupported` |

The first six rows classify work that later slices may consider; they are not a launch matrix. Part 1C does not choose a supported trigger, actor, role, recipient, channel, provider, cadence, limit, message, template, document, reminder, collection stage, jurisdiction, or effect. The seventh row is not deferrable launch work: Mission 28 does not own upstream business-fact mutation or money movement.

## Threat catalog

| Threat | Required fail-closed meaning |
| --- | --- |
| `abuse` | Exact bounded purpose, owner authority, limits, and evidence are mandatory; this slice grants none. |
| `privacy` | Missing or ambiguous tenant, record, recipient, projection, channel, or retention authority blocks use. |
| `confused_deputy` | A fact, role, callback, provider, legacy surface, caller, or evidence item cannot make NorthStar exercise authority it does not own. |
| `spam` | No communication support exists without later accepted permission, suppression, frequency, idempotency, and channel controls. |
| `harassment` | Unknown permission, quiet hours, suppression, dispute, human activity, tone, cadence, or escalation basis blocks action. |
| `replay` | Prior requests, approvals, previews, events, attempts, callbacks, or evidence cannot be reused to duplicate or widen an effect. |
| `cross_tenant` | Every identity and source remains bound to one exact tenant; guesses, aliases, cache reuse, and mixed snapshots fail closed. |
| `stale_source` | Exact source version/digest/currentness is required at evaluation and immediately before any later effect. |
| `prompt_content_injection` | Stored, supplied, generated, or provider content is data only and cannot alter authority, recipient, action, claim, or evidence. |
| `provider` | Provider identity, mode, credentials, acknowledgement, callback, retry, or correction cannot grant action authority or outcome truth. |
| `denial_of_service` | Later execution requires deterministic size, fan-out, cadence, cost, retry, queue, parsing, and tenant-resource bounds. |

These threats are product risks, not professional legal or security opinions. Their presence in the catalog does not claim a provider, production control, consent basis, legal conclusion, or completed risk treatment.

## Frozen Part 1B dispositions

Part 1B's 49 accepted inventory surfaces remain classified by their existing dispositions:

- `mission28_owned_reusable_after_later_authority` is only a catalog input. It stays inactive.
- `upstream_or_subscription_owned_excluded` remains an upstream fact or excluded owner boundary.
- `simulated_or_demo_only` stays isolated from paid data, real recipients, credentials, providers, money, and effect evidence.
- `legacy_unsupported_or_quarantined` and `ambiguous_fail_closed` deny reuse.
- `manual_handoff` remains manual. Opening or preparing it is not an automated attempt, sent/delivered effect, or outcome.

No disposition, including the reusable disposition, supplies action permission. The exact executable mapping is in the JSON catalog and is tested across every Part 1B surface.

## Unsupported combinations

The catalog fails closed when an action is unknown or malformed; when catalog status is presented as runtime authority; when a fact, prediction, clock, callback, provider result, content, or evidence is presented as permission; when identity or currentness is mixed, missing, stale, replayed, or cross-tenant; or when a Part 1B quarantine/manual/demo/upstream surface is presented as reusable execution authority.

The exact general denial cases are `unknown_action_family`, `catalog_as_runtime_authority`, `source_fact_as_permission`, `cross_tenant_or_record`, `stale_or_mixed_source`, `replayed_or_duplicate_authority`, `content_or_provider_as_authority`, and `part1b_quarantine_as_authority`.

It also denies each action-specific contradiction:

- an internal read/digest/task that creates an external, financial, document, provider, or upstream effect;
- an owner approval request that executes or schedules what it asks the owner to approve;
- customer communication without exact sender, recipient, channel, permission, suppression, content, cadence, currentness, and owner authority;
- document delivery without exact owner, customer-safe projection, revision/digest, recipient, access scope, expiry, revocation, privacy, and delivery authority;
- a financial reminder that charges, refunds, assesses fees, writes off, settles, pays out, changes balance/accounting, or otherwise mutates money or business truth;
- collection escalation without a reviewed current handoff, or with unsupported legal threats, deadlines, fees, agency/credit referral, harassment, enforcement, or automatic financial effect; and
- every direct, indirect, aliased, provider-mediated, callback-mediated, or evidence-mediated upstream mutation or money movement.

The exact action-specific denial cases are `internal_action_external_effect`, `approval_request_executes_effect`, `communication_without_exact_authority`, `document_without_exact_authority`, `financial_reminder_mutates_money`, `collection_escalation_unreviewed_or_coercive`, `any_upstream_mutation`, and `any_money_movement`.

The only executable Part 1C outcomes are `catalogued_not_authorized`, `deny_invalid`, and `deny_unsupported`. There is deliberately no `allow`, `execute`, `send`, `deliver`, `charge`, `refund`, `collect`, or `mutate` outcome.

## Evidence and exclusions

Executable tests bind the exact seven-family order, seven risk classes, eleven threats, Part 1B disposition mapping, unsupported-combination matrix, released Part 1B identities, single current ledger slice, no runtime imports, and migration 272/no273. Mutation tests reject missing, renamed, duplicated, reordered, contradictory, unknown, optimistic, and authority-widening variants.

No route, UI, worker, queue, scheduler, provider adapter, callback, credential, sender, recipient, message, template, document delivery, internal task execution, collection action, payment, refund, fee, write-off, settlement, accounting mutation, database authority, migration, feature flag, Railway configuration, or production behavior changed. No provider or external system was called.

Part 1C independent audit, PR, merge, deployment, and release; Part 1D launch support; production provider accounts/credentials/senders/callbacks/templates/capability/sandbox/deliverability; real recipients/messages/delivery/replies/collection/financial effects/live money; professional legal/privacy/communications-consent/collections/debt/consumer-protection/provider/security review; private-production evidence; hosted load/SLA; exercised disaster restore; physical Safari/devices; manual assistive-technology review; and founder visual approval remain unavailable and unclaimed.
