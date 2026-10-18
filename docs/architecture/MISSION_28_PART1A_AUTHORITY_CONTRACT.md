# Mission 28 Part 1A — authority and terminology contract

Status: Part 1A implementation candidate. This documentation and executable
ratification package starts from terminal Mission 27 main
`4b69a1c81db0d86eaa154a489f560c0a85b8f547`, tree
`05e317ee7ef2dc8e64604839752976f93a9968cc`. Independent whole-head audit,
normal merge, automatic deployment and release verification remain pending.
Part 1A adds no route, worker, queue, event listener, policy, approval, runtime
automation, provider or receiver adapter, customer communication, schema,
migration, permission, UI or external effect.

## Controlling authority

This contract ratifies Slice 1A of the founder-approved
[Mission 28 canonical roadmap](../roadmap/MISSION_28_BUSINESS_AUTOMATION.md)
and its [66-slice acceptance ledger](../roadmap/MISSION_28_ACCEPTANCE_LEDGER.md).
The frozen structure is 14 serialized parts and 66 slices. A later change
requires a written authority or acceptance reason, the affected gates, and a
revised total before implementation continues.

Mission 28 owns tenant-private automation policy, evaluation, approval,
scheduling, execution coordination, outbound communication evidence,
suppression, recovery and the owner-facing Automation Center. It may later
create its own internal automation tasks, approvals, run records and delivery
evidence only after the responsible slice accepts that behavior. It never
acquires authority merely because an upstream event, prediction, learned
recommendation, elapsed clock or provider callback exists.

## Dependency and ownership map

| Authority | Mission 28 may consume | Mission 28 must not take over |
| --- | --- | --- |
| Mission 20 | Current business identity, communication identity, locations, workforce, fixed roles, contact preferences, and accepted operating policy | Business-profile ownership, workforce administration, or invented legal/communication policy |
| Mission 21 | Reviewed provider-agnostic knowledge and exact version references | Knowledge publication, unreviewed advice, or silent policy generation |
| Mission 22 | Current appointments, assignments, dispatch state, timing, and customer-response handoff contracts | Scheduling, assignment, dispatch, routing, or automatic rescheduling |
| Mission 23 | Current work state, field events, completion/reopening evidence, and accepted customer-update facts | Work execution, completion, evidence editing, or operational truth |
| Mission 24 | Exact current estimate, proposal, quote, commercial revision, customer acceptance, expiry, and customer-safe document | Pricing, estimate calculation, commercial approval, or scope revision |
| Mission 25 | Accepted tenant-private observations, learned recommendations, evidence quality, and graduated-trust status | Learning, source ingestion, calibration, or treating advice as permission |
| Mission 26 | Current facts, alerts, predictions, uncertainty, and reviewed action handoff | Forecasting, KPI definition, or turning a prediction into a fact or action |
| Mission 27 | Exact current invoice, balance, due/aging, payment, receipt, refund, dispute, settlement, and collection-workflow facts | Invoice/payment truth, charging, refunds, fees, write-offs, accounting, or earned-revenue policy |
| Mission 29 | Later enterprise governance, custom roles, thresholds, SSO/MFA policy, and organization-scale administration | Pulling forward enterprise administration; Mission 28 implements only fixed minimum safe-operation capabilities |
| Missions 30–33 | Later reviewed handoffs where explicitly compatible | OS-wide integration, public guided simulation, calculator ownership, or platform administration |

Each dependency remains the authority for its source record. Mission 28 may pin
and revalidate exact source identities, versions, digests and correction
lineage. It may not copy a source into a new record and then treat the copy as
permission to mutate the source.

## Ratified four-stage boundary

The following terms are separate. No stage is evidence that a later stage
occurred, and no later-stage evidence retroactively creates authority for an
earlier decision.

| Stage | Ratified meaning | Authority and effect boundary |
| --- | --- | --- |
| **Upstream fact** | One exact current tenant-private fact owned by its source mission, with identity, version or revision, digest, provenance, currentness and correction state. Examples include an appointment, work completion, approved proposal, overdue invoice, forecast or reviewed recommendation. | It may make a policy eligible. It never activates, widens, approves or executes an automation. Missing, stale, conflicting or unavailable facts fail closed. |
| **Automation decision** | A Mission 28 internal evaluation or approved plan bound to one exact policy version, source snapshot, audience, channel, timing, limits, suppressions and action authority. Eligibility, proposed action, approval, scheduled run and action unit remain distinct records. | It is intent, not execution. Preview, approval, queueing or a due clock creates no provider call, message, upstream mutation or other external effect. |
| **External effect** | The bounded real-world action attempted through an accepted adapter after immediate pre-effect revalidation, such as one provider send or supported native handoff. | It requires exact current authority, recipient, consent, channel, limits, suppression, idempotency and stop checks. Part 1A authorizes none. Unsupported upstream mutation and money movement remain excluded. |
| **Evidence of the effect** | Append-only minimized evidence about an attempt, provider acknowledgement, delivery state, reply, opt-out, failure, correction or business outcome, bound to the exact action and source lineage. | An attempt is not provider acceptance; provider acceptance is not delivery; delivery is not acknowledgement, reply or business success. Evidence cannot authorize a retry, duplicate effect, upstream rewrite, payment, collection or other outcome by inference. |

The durable separation is therefore:

`upstream fact → automation decision → external effect → evidence of effect`.

Arrows mean a later slice may evaluate the next boundary under its own accepted
contract. They do not mean automatic promotion, mutation authority or proof of
success.

## Ratified terminology

| Term | Meaning |
| --- | --- |
| Policy | Versioned standing authority or per-run authority with explicit action, source class, audience, channel, timing, limits, expiry, suppression and stop conditions. A draft policy grants nothing. |
| Eligibility evaluation | Deterministic value-free or explainable result over an exact policy and source snapshot. Eligible does not mean approved, scheduled or executed. |
| Proposed action | A bounded owner-readable plan stating what, why, source, recipient, channel, content/document version, time, limits and stop conditions. It creates no effect. |
| Approval | Exact current per-run approval or standing authorization pinned to actor, session, policy/source/preview digests, intended effects, reason, expiry and required assurance. It cannot survive a material change. |
| Scheduled run | Durable intent for a future evaluation or action window. The clock reaching that window is not action authority. |
| Action unit | One bounded tenant-scoped unit with stable idempotency and exact policy/source/recipient/effect identity. It is not evidence that a provider was called. |
| Provider attempt | One adapter invocation under an accepted action unit. It remains distinct from acknowledgement, delivery and outcome. |
| Provider acknowledgement | Minimized authenticated provider evidence that the provider accepted or classified an attempt. It is not delivery or business success. |
| Delivery state | Correctable evidence about delivery, failure, block, complaint or unknown status. Missing or provider-specific ambiguity never becomes delivered. |
| Reply or opt-out | Current recipient evidence that suppresses or redirects later work under accepted policy. It does not directly rewrite an upstream business record. |
| Suppression | A fail-closed reason preventing or invalidating pending automation, including manual activity, reply, opt-out, source correction, dispute, pause, cancellation, global stop or provider uncertainty. |
| Demo | Physically and logically isolated fictional authority using production engines without real recipients, providers, paid-tenant adoption or external effects. |
| Unavailable | A named value-free state caused by missing, unsupported, stale, conflicting, denied or unverifiable authority. It is not false, zero or permission. |

## Ratified exclusions

Part 1A grants no capability and makes no current application path a Mission 28
path. In particular, Mission 28 does not own or infer:

- business-profile, workforce, knowledge-publication, schedule, dispatch, work,
  estimate, pricing, proposal, signature, learning, forecast, invoice, payment,
  refund, fee, write-off, accounting, earned-revenue, calculator or platform
  administration authority;
- permission from a source event, prediction, recommendation, elapsed clock,
  provider callback, role label, queue record, demo record or previous effect;
- arbitrary code, hidden provider logic, free-form recipient widening,
  missing-as-zero behavior, unreviewed AI claims or cross-tenant learning;
- automatic rescheduling, work completion, commercial revision, charge, refund,
  fee, write-off, collection-agency action, legal threat, credit reporting,
  lien, repossession, financing or other unsupported upstream/money mutation;
- delivery, acknowledgement, reply, payment, collection, reconciliation or
  success merely from queueing, an attempt, provider acceptance, composer
  opening, screenshot, static contract or seeded/demo value; or
- Mission 29 enterprise governance, Mission 31 public guided simulation,
  Mission 32 calculator authority, Mission 33 platform administration, or any
  Mission 29+ behavior before its owning mission accepts it.

Legacy cron jobs, workers, queues, listeners, notifications, email/SMS paths,
reminders, retries, webhooks, templates, adapters, demo actions and quick-send
surfaces remain unclassified and unauthorized until Part 1B inventories and
disposes them. Ratification by name is not adoption.

## Frozen implementation sequence

The order and counts are exact: Part 1 (4), Part 2 (4), Part 3 (4), Part 4 (4),
Part 5 (4), Part 6 (6), Part 7 (6), Part 8 (4), Part 9 (4), Part 10 (4), Part 11
(6), Part 12 (4), Part 13 (5), and Part 14 (7), for 66 slices. Work proceeds
`1A, 1B, 1C, 1D, 2A … 14G`. Part 1B owns inventory and quarantine; Part 1C owns
the action/risk catalog and threat model; Part 1D owns the first-supported
launch matrix. This slice does not preempt any of them.

Every slice remains serialized through one writer, an independent whole-head
audit reporting P0–P3, same-writer correction where needed, one normal merge,
one automatic deployment and read-only release verification before the next
slice starts. Documentation-only Part 1A requires that release lane but does
not require invented PostgreSQL, browser, provider or production evidence.

## Part 1A acceptance boundary

Part 1A closes only when the canonical roadmap preserves the founder-approved
mission body, all 12 invariants, all 14 parts and all 66 slices exactly; the
acceptance ledger preserves the same order; executable ratification tests catch
count, order, ownership and four-stage-boundary drift; and an independent audit
finds no P0–P3 issue on one frozen clean head.

Production provider accounts and credentials, verified senders, real callbacks,
deliverability, professional legal/privacy/consent/collections/tax/accounting/
security opinions, real recipients, private production, live outbound messages,
provider mutation, first-paying-customer live-money validation, hosted CI/load,
exercised disaster restore, production performance/SLA, physical Safari/devices,
manual assistive-technology review and founder visual approval remain
unavailable and unclaimed.
