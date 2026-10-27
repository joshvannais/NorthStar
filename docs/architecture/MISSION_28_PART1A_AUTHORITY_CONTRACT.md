# Mission 28 Part 1A — authority and effect-boundary contract

Status: **implementation candidate only.** This contract has not been independently accepted, merged, deployed, or released. It adds no runtime authority or behavior.

## Controlling artifacts

Part 1A ratifies the founder-approved [Mission 28 roadmap](../roadmap/MISSION_28_BUSINESS_AUTOMATION.md) and its [66-slice acceptance ledger](../roadmap/MISSION_28_ACCEPTANCE_LEDGER.md). The roadmap's canonical body is frozen at SHA-256 `109589DA2242EE6AA7FDD4C2DED3E3440B909B26452DEFCD39BC2502C1ADAAF5`; its source provenance is frozen at SHA-256 `DDBA5CA7523A1684330E136313F4416584D142A63167310EEABEC1EBFBB010B4`.

Mission 28 begins only after Mission 27 terminal functional release acceptance at deployed main `7736fe6d31ce2300cf06cfcaa461f9b9ea5184c3`, tree `861215b3b6ffdcdf53f2f658e2d46098526f8b65`, and automatic Railway deployment `c452d8fd-c896-407e-9f20-5f9ba01ee587` `SUCCESS`. That baseline is a dependency, not permission to alter any Mission 20–27 fact or to create an external effect.

The exact serialized order is Part 1 (A–D), Part 2 (A–D), Part 3 (A–D), Part 4 (A–D), Part 5 (A–D), Part 6 (A–F), Part 7 (A–F), Part 8 (A–D), Part 9 (A–D), Part 10 (A–D), Part 11 (A–F), Part 12 (A–D), Part 13 (A–E), and Part 14 (A–G): fourteen parts and sixty-six slices. Part 1A cannot reorder, collapse, rename, pre-accept, or borrow behavior from a later slice.

## Ratified ownership and exclusions

| Authority | Mission 28 may consume after the owning contract accepts the handoff | Mission 28 owns | Mission 28 must not infer, replace, or mutate |
| --- | --- | --- | --- |
| Mission 20 | Current tenant/business identity, communication identity, locations, fixed roles, contact preferences, accepted operating policy | Nothing inside Mission 20 | Business profile, workforce administration, consent or legal policy not explicitly present |
| Mission 21 | Reviewed provider-neutral knowledge with exact versions | Nothing inside Mission 21 | Publication, unreviewed advice, or silently generated policy |
| Mission 22 | Exact current appointments, assignments, dispatch state, timing, and response-handoff facts | Later communication eligibility about those facts | Schedule, assignment, dispatch, route, arrival, cancellation, or reschedule truth |
| Mission 23 | Exact current work state, completion/reopening and customer-safe evidence | Later communication eligibility about those facts | Work execution, completion, evidence, or operational truth |
| Mission 24 | Exact current estimate, quote, proposal, commercial revision, acceptance, expiry, and customer-safe document | Later approved communication about an exact version | Pricing, calculation, commercial approval, scope, signature meaning, or acceptance |
| Mission 25 | Accepted tenant-private observations and recommendations with evidence quality and trust status | Later attention or approval-request handoff | Learning, source ingestion, calibration, or treating advice as permission |
| Mission 26 | Accepted facts, alerts, predictions, uncertainty, and reviewed handoffs | Later attention or approval-request handoff | Forecasting, KPI definition, or treating a prediction as fact or authority |
| Mission 27 | Exact current invoice, balance, due/aging, payment, receipt, refund, dispute, settlement, and collection facts | Later human-controlled communication and collection-workflow coordination | Invoice/payment truth, charging, refund, fee, write-off, accounting, settlement, or earned revenue |
| Mission 28 | Exact automation policy, evaluation, approval, scheduling, execution coordination, communication evidence, suppression, recovery, internal tasks, and Automation Center | The bounded automation lifecycle defined by this roadmap | Any upstream business fact, provider fact without validation, or outcome not evidenced |
| Mission 29 | No dependency until a separately accepted handoff exists | Only the fixed minimum capabilities explicitly accepted in Mission 28 | Enterprise roles, thresholds, SSO/MFA policy, or organization-scale administration |
| Missions 30–33 | Only separately reviewed compatible handoffs | Nothing inside those missions | OS-wide integration, public guided simulation, calculator ownership, or platform administration |

Mission 28 may create its own tenant-private policies, evaluations, approvals, scheduled runs, action units, attempts, suppressions, tasks, and evidence. It may not mutate an upstream fact merely because it evaluated, queued, communicated, or observed something about that fact. NorthStar subscription billing remains separate from contractor-to-customer financial facts and automation.

## Four disjoint authority classes

| Class | Exact meaning | Required lineage | What it never proves |
| --- | --- | --- | --- |
| `upstream_fact` | An accepted current fact owned outside Mission 28 and referenced without transferring ownership | Tenant, owning mission, source class, record identity, version/revision, digest, observation time, availability, and currentness | Automation eligibility, approval, execution, delivery, reply, payment, collection, or business outcome |
| `automation_decision` | A deterministic internal result under one exact current policy and coherent exact current inputs | Policy/version/digest, source pins, recipient/consent/channel/limit/suppression checks, decision digest, reason, evaluator version, evaluated time, and result state | Provider attempt, external effect, delivery, acknowledgement, reply, or success |
| `external_effect` | One bounded consequential boundary crossing, such as a provider request, supported native handoff, or separately accepted internal effect | Exact current action authority, action unit, tenant-scoped idempotency, pre-effect revalidation, adapter capability/mode, attempt identity, and effect time | Provider acceptance, delivery, view, reply, payment, collection, reconciliation, or outcome |
| `effect_evidence` | A minimized append-only observation about an attempted effect, authenticated and reconciled under its own source rules | Tenant/action/attempt binding, evidence source, provider or handoff mode where applicable, source identity/version, observed time, received time, correction lineage, and evidence state | Retroactive authority, a different effect, an upstream mutation, or a stronger status than the evidence states |

The boundary is monotonic but not automatically progressive. An `upstream_fact` can make a policy eligible but cannot create an `automation_decision`. A decision can propose or schedule an action but cannot become an `external_effect`. An effect attempt can exist without accepted, delivered, viewed, replied, paid, collected, or successful evidence. `effect_evidence` records what is known; it never retroactively authorizes the attempt and never rewrites its upstream source.

These are prohibited equivalences:

- event, elapsed clock, prediction, recommendation, callback or provider label = permission;
- eligible, previewed, approved, scheduled or queued = attempted;
- attempted or provider-accepted = sent or delivered;
- composer opened or native handoff created = sent;
- sent or delivered = viewed, acknowledged, replied, paid, collected, successful, reconciled or causally effective;
- reply, promise, payment or business outcome = Mission 28 evidence unless the owning authority separately accepts and exposes that exact fact;
- communication evidence = schedule, work, estimate, invoice, balance, payment, settlement, accounting or legal truth.

## Ratified terminology

| Term | Meaning |
| --- | --- |
| Policy | A tenant-private versioned statement of permitted source class, action, audience, channel, timing, limits, approvals, suppressions, expiry, rollout state, and stop conditions. A draft or invalid policy grants nothing. |
| Per-run approval | Current human authority bound to one exact preview, policy/source/recipient/effect digest, actor/session, reason, expiry, and idempotency scope. It cannot be replayed after a material change. |
| Standing authorization | Versioned bounded authority for repeated matching runs. It grants only its exact action and constraints and is revalidated per run; it is not blanket consent. |
| Eligibility | A deterministic internal finding that prerequisites currently match. It is not approval, queueing, execution, or evidence. |
| Preview | An owner-readable projection of a proposed action and its exact inputs. Viewing or creating it creates no effect. |
| Scheduled run | Internal intent to reconsider or execute at a bounded time. The pre-effect gate must still pass. |
| Action unit | The smallest tenant-scoped idempotent proposed consequential action. Fan-out creates separately bounded units. |
| Provider attempt | An external-effect attempt through an accepted adapter and exact mode. Timeout or unknown acknowledgement remains uncertain, never success. |
| Native handoff | Opening or preparing a supported OS/app composer. It is evidence of handoff only, never send or delivery evidence. |
| Delivery evidence | Authenticated minimized evidence whose exact state may be accepted, sent, delivered, opened, replied, failed, complained, corrected, or unknown. States are not interchangeable. |
| Suppression | A current reason that blocks, cancels, or rebuilds a pending action. Human activity, opt-out, source correction, dispute, pause and global stop take precedence. |
| Currentness | Server-owned proof that all required identities, versions, digests, permissions, limits, suppressions and prior-effect facts still form one coherent decision. It is checked at evaluation and immediately before effect. |
| Unavailable | A value-free state for missing, unsupported, stale, conflicting, denied or unverifiable authority. It is not false, zero, success or permission. |
| Demo | Fictional, resettable, physically and logically isolated use of production logic that cannot address real recipients, providers, paid tenants or money and cannot become paid authority. |

## Dependency and decision contract

Every later supported action must satisfy all of the following without a missing-as-safe default:

1. The owning upstream mission exposes an accepted tenant-private source class, exact record identity, version/revision, digest, availability and currentness.
2. Mission 28 has an accepted policy version whose source class, action family, recipient class, channel, timing, limits, approval class, suppressions and stop conditions match exactly.
3. The authenticated actor/session and fixed capability grant authorize the exact operation. A role name alone does not.
4. Recipient identity, communication permission or other separately reviewed basis, channel capability, quiet hours, locale, content/template version and attachments are exact and current.
5. Prior manual activity, replies, opt-outs, prior effects, uncertainties, corrections, disputes, pauses and global/tenant/customer/document stops are reconciled.
6. The evaluation creates only an `automation_decision`; separately accepted later slices own transactional scheduling and external execution.
7. Immediately before any effect, every relevant authority is reread and revalidated coherently. Stale, mixed, unavailable, uncertain or changed state fails closed.
8. The effect uses stable tenant-scoped idempotency and bounded retry/reconciliation. Unknown outcome blocks another attempt until reconciled.
9. Evidence remains append-only, minimized, correction-aware and explicitly typed. The strongest displayed claim cannot exceed accepted evidence.

Part 1A itself implements none of those runtime steps. It grants no route, worker, queue, scheduler, provider adapter, callback, credential, recipient, message, document delivery, internal task, payment, refund, fee, write-off, accounting action, database authority, migration, UI control, production flag or demo effect. Parts 1B–1D own inventory, risk classification and first-supported launch choices before any later implementation may rely on them.

## Acceptance and unavailable evidence

Part 1A acceptance requires exact source and canonical-body identity, complete fourteen-part/sixty-six-slice order, all twelve invariants, exact ownership/exclusion boundaries, the four disjoint authority classes, a source-linked ledger with only Part 1A current, executable drift tests, zero runtime/schema/migration change, and a complete fresh independent whole-head audit with no P0–P3 findings before release.

The following remain unavailable and unclaimed: production provider accounts or credentials; sending domains or numbers; sender registration; real callbacks, provider templates or deliverability; professional legal, privacy, communication-consent, collection, debt, consumer-protection, tax, accounting, provider or security review; external collection agencies or legal remedies; automatic fees, write-offs, charges, refunds or money movement; private-production customer data; real recipients or outbound messages; provider sandbox/live mutation; first-paying-customer live-money validation; hosted CI/load; exercised disaster restore; production performance/SLA; physical Safari/devices; manual assistive-technology review; and founder visual approval.
