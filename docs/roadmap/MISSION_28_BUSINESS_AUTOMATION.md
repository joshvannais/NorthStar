# Mission 28 — Business automation

Status: **Parts 1A–5D released; Part 6A implementation candidate only.** Parts 6B–14G remain planned and unimplemented. Part 6A adds an owner-only transactional outbox/storage boundary for bounded provider-disabled internal action units; it grants no mounted runtime resolver, route, UI, scheduler, publisher, queue consumer, worker, provider, recipient, external-effect, upstream-mutation, accounting or money authority.

## Frozen authority provenance

- Founder-approved source: `C:\Users\joshv\Documents\Codex\2026-09-09\view-northstar-mission-success-and-look\MISSION_28_PROPOSED_PART_SLICE_PLAN.md`
- Exact source SHA-256: `DDBA5CA7523A1684330E136313F4416584D142A63167310EEABEC1EBFBB010B4`
- Canonical body rule: take the source beginning with `## Mission objective`, normalize line endings to LF, trim surrounding whitespace, and append exactly one LF.
- Canonical body SHA-256: `109589DA2242EE6AA7FDD4C2DED3E3440B909B26452DEFCD39BC2502C1ADAAF5`
- Exact Mission 27 terminal deployed baseline: commit `7736fe6d31ce2300cf06cfcaa461f9b9ea5184c3`, tree `861215b3b6ffdcdf53f2f658e2d46098526f8b65`, automatic Railway deployment `c452d8fd-c896-407e-9f20-5f9ba01ee587` `SUCCESS`.
- Released Part 1A baseline: source head `c42d1a9f72dcb6bbdd480e804988ddc3ec43cc09`, PR #549, merged main `21ca719e24382443bbf3f52e460f3c16b016c4ad`, tree `0cfdc4f0e8dc28c790893edff7bbebe0b31a5d10`, automatic Railway deployment `d3010671-da95-4247-807f-f2089b90df74` `SUCCESS/RUNNING`, image `sha256:12b0bfeb266c4849b127102ad98a2f8b6ad06080898462c41ee63c3a5b699b26`, migration/startup/health/root/demo verified.
- Part 1A independent corrected audit: P0=P1=P2=P3=0; report SHA-256 `1C3AA77E9B1E31A4FE4A8167FC2072A5818EDC52D19B5BCB1356352FEADDBDE1`.
- Released Part 1B baseline: accepted source head `bc09c83d8352c4ae707e26042f9bf52750adcbc2`, PR #550, merged main `1801aa90c26bab5cba6583b8a6be342763ba387a`, tree `faaead16ab89d0f75ab021db8d7cf34436f234e6`, automatic Railway deployment `21505f81-8df6-4f7a-9f4d-61ff33e6ec90` `SUCCESS/RUNNING`, image `sha256:97210537e4a682de1e61b7e95b9873812e167fa0e47dcfcb3fba17a401df4bfd`, migration/startup/health/root/demo verified. Its fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 1C baseline: accepted source head `467668a9de408adb381ac91beb61cc73b01532ec`, PR #551, merged main `eba50a7903ac0000a9eb663d52744cc760f3afd3`, tree `f923240512ae70a1029708ff9f9c9354a21d504b`, automatic Railway deployment `fbca00f3-5806-46c3-981f-7120306a09ed` `SUCCESS/RUNNING`, image `sha256:ff3695a8ea06b5096d11487c21e7d349f5a686fba2f20e32818df11e62f75452`, migration/startup/health/root/demo verified. Its fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 1D baseline: accepted source head `f869b0b1e0da15149e33948e1a732208d585ebd0`, PR #552, merged main `aa875c9a2ad6e03f8d41575e6b19e31aa36ed02d`, tree `0f7df37487cc8d0b57b7ef79a730ba9fea93e7ac`, automatic Railway deployment `dc96dc7d-5fe7-4eaa-a093-e37792373f6e` `SUCCESS/RUNNING`, image `sha256:cff3f90fa227c84b24e8230581d87d2ff8f0a82cd113ac5e1c00c4589547019d`, migration/startup/health/root/demo verified. Its fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 2A baseline: accepted source head `6f1c299193456afd756542da43c72c6517101661`, PR #553, merged main `cc55048e91c2b5c6dd70671d01ebe913123201ad`, tree `954f9e685642ee23c17376c83cc92a34ae6b72ad`, automatic Railway deployment `9e976ab1-733d-4d85-b1f6-6c33073dc3aa` `SUCCESS/RUNNING`, image `sha256:a4fffc825163c836e10a59a60fd64586531d6a365b96eced5b0ce3a880fa5372`, migration/startup/health/root/demo verified. Its fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 2B baseline: accepted source head `be14e2467b278f00dfd55082b0f42a4497ef5c22`, PR #554, merged main `dd31bb4d36057c4c3f1774c589a0f425210bb439`, tree `0fb86eefc19c322593d9e09710e9102329d82d12`, automatic Railway deployment `1a04c6ac-412a-4f5f-b86b-7f506b2a3cc8` `SUCCESS/RUNNING`, image `sha256:9defb2eda71fc5fb8905c6b4c623aefd5a0b3a7923980b7b6736cdcebbaf217e`, migration/startup/health/root/demo verified. Its second fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 2C baseline: accepted source head `69d4a375a4971ab98310872b9382cba92f5a67c0`, PR #555, merged main `1d52b675d8d2bbe9065c220ff3719460bd530f38`, tree `cb6efc54e0fe591cb9c3439126d6c7b6454b5048`, automatic Railway deployment `036663b4-a364-4c3a-9842-5e1686164be0` `SUCCESS/RUNNING`, image `sha256:b38f14f81706ee11c00b698228532744bc1efc8d2b68273c442d0c72e4651a46`, migration/startup/health/root/demo verified. Its fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 2D baseline: accepted source head `98c4b3562ad48787472584ca64c601d584c2427f`, PR #556, merged main `529286cf2d513df93680e2c236e37f562782cb52`, tree `cb2f7072f475e927f75ee3b562884adf01234d70`, automatic Railway deployment `f40e401a-649f-42b3-a1cc-71dbd0ffce4d` `SUCCESS/RUNNING`, image `sha256:586afe8103acc0e4f27d5967e8a8554876d7f5f51dc38bd7c7f4a98e2c320337`, Dockerfile/start command bound, production migrations reconciled 269/269 through exact 273/no274, authority objects present, zero legacy conversion rows, and startup/health/root/demo verified. Its fresh independent audit accepted P0=P1=P2=P3=0 with exact Node 22.23.3 10/10 suites and 138/138 tests, fresh PostgreSQL 17.10 1/1 suite and 15/15 tests plus non-vacuous forced-RLS cross-tenant verification, syntax 11/11, JSON 1/1 and clean diff; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 2D artifacts: [PostgreSQL authority, canonicalization, retention and restart contract](../architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.md) and [executable storage contract](../architecture/MISSION_28_PART2D_POSTGRES_AUTHORITY.json).
- Released Part 3A baseline: accepted source head `05a541792adac121f8c51b2cf200c0d18fcfbbf1`, PR #557, merged main `1e62336afe2c9e65cccbe1629a62b86855da3ff8`, tree `a88024e8140900492d7ac02bcf4e07f020d8b3de`, automatic Railway deployment `7ca335a1-7bf6-4f8d-ae98-a188b891f85d` `SUCCESS/RUNNING` with one running instance, image `sha256:201627b8ee00cf950c267bbd522d5538a7c42461c8771de8701463fe790ac40e`, Dockerfile/start command bound, production migrations reconciled 269/269 through exact 273/no274, and startup/health/root/demo verified. Its required second fresh independent whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 3A artifacts: [fixed capability matrix contract](../architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.md) and [executable matrix](../architecture/MISSION_28_PART3A_FIXED_CAPABILITY_MATRIX.json).
- Released Part 3B baseline: accepted corrected source head `56a39854325826982283d78dffed4e039c61335b`, PR #558, merged main `d88a0fe294619fa982bc1541affc8052031cc406`, tree `6ae86ee398e47fd75403bb98bcc3259522ec9461`, automatic Railway deployment `81bc25de-eb77-413e-8745-97882bdd7c09` `SUCCESS/RUNNING` with instance `ae88752d-2f49-46bc-9692-adafbd1ba5cc`, image `sha256:96720a1fc1c5379d53992081046540f28ddf1c42307cb34f0b824fe737ef8974`, Dockerfile/start command bound, production migrations reconciled 269/269 through exact 273/no274, and startup/health/root/demo verified. Its required second fresh independent whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 3B artifacts: [per-run approval and standing authorization contract](../architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.md) and [executable contract](../architecture/MISSION_28_PART3B_APPROVAL_AUTHORIZATION_CONTRACT.json).
- Released Part 3C baseline: accepted source head `3cd41fe5379d92fe629c62e0ebc3a51d8886c3cc`, PR #559, merged main `d227c50f73e3fb9fc89ee48332a9eda57d1c8713`, tree `1a54cd43a2d3f218cc7040842847caaf668505df`, automatic Railway deployment `b745a483-1031-4020-9ab2-38c0044e599d` `SUCCESS/RUNNING` with instance `0227dd84-13e8-48b1-99fd-8268ae8e8ba8`, image `sha256:27c84d6cd34be043aa2f6388080c90b5500a8ea1d87ab018c9d58f34277e5590`, Dockerfile/start command bound, production migrations reconciled 269/269 through exact 273/no274, and startup/health/root/demo verified. Its fresh independent whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 3C artifacts: [owner limits and mandatory constraints](../architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.md) and [executable contract](../architecture/MISSION_28_PART3C_OWNER_LIMITS_CONTRACT.json).
- Released Part 3D baseline: accepted corrected source head `797be4a33bb2128ae2efd79b5347ef43f94da0f6`, PR #560, normally merged at 2026-10-27T21:20:22Z to main `041971bb190998e1444087482941686c4166573d`, tree `ac4b98e48a7fd524e96ed41305f8a677350587a1`, automatic Railway deployment `7e0ef15f-1275-4578-aade-70b8c8277bef` `SUCCESS/RUNNING` with instance `d229cffd-2e7b-4341-b1da-2ff728d1d581`, image `sha256:b631fefb559f09cdb3073a80bdd8051487a6e0478bd07606705903af41174595`, Dockerfile/start command bound, production migrations reconciled 269/269 through exact 273/no274, and startup/health/root/demo verified. Its required second fresh independent whole-head audit accepted P0=P1=P2=P3=0 with exact Node 22.23.3 13/13 suites and 208/208 tests, syntax 12/12, JSON 11/11, frozen inputs 14/14 and no runtime-path changes; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 3D artifacts: [governance controls and safe degraded behavior](../architecture/MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.md) and [executable contract](../architecture/MISSION_28_PART3D_GOVERNANCE_CONTROL_CONTRACT.json). Reducing controls never prove an effect stopped; authority increases require exact current evidence and the fixed dual-control rules.
- Released Part 4A baseline: accepted source head `0ff6be659df199357635f447eeff77cfd9d7aa38`, PR #561, merged main `c3a6d6c691ae39c982c872009ed4fc3f5123d13b`, tree `3fcf036fcad83a804cf6baa98c7d931de2606422`, sole automatic Railway deployment `40335d30-2b8d-4e99-b2fb-3083348f9d2d` `SUCCESS/RUNNING` with instance `b232d3ee-74aa-4fd8-96f9-00b8ca97895f`, image `sha256:e57f0d9e3429333938903dc700c67e84fc9d0de018d23d69f8c70cda96d89978`, canonical startup and exact-deployment health/root/demo verified. Its required second complete fresh root audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 4A artifacts: [closed trigger catalog](../architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.md) and [executable catalog](../architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json). Catalog membership never grants action authority.
- Released Part 4B baseline: accepted source head `032377507ca73e9c7f332d257751679e1295c944`, PR #562, merged main `3a906372cc41f9167eb6bf40c0e8cfe111be5dd2`, tree `621787f4d2d2e19b4f8b76b2c2b352133a108fac`, sole automatic Railway deployment `379268a5-0ab4-4bab-8e5d-df50b24f5f9e` `SUCCESS/RUNNING` with instance `9aecaf98-c9f4-42d4-a8db-d8e74beec19f`, image `sha256:6799297b20f807393c83c32b18acc87abfcecb2baf6cf3b185559eed2a87e67f`; migration 274 applied, source has 270 migrations through 274/no275, canonical startup and exact-deployment health/root/demo verified. Its complete fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 4B artifacts: [tenant-private source snapshot contract](../architecture/MISSION_28_PART4B_SOURCE_SNAPSHOT_CONTRACT.md), [executable source snapshot contract](../architecture/MISSION_28_PART4B_SOURCE_SNAPSHOT_CONTRACT.json), and additive migration `274_canonical_automation_trigger_snapshots_v1.sql`.
- Released Part 4C baseline: accepted source head `cd18dc20cb7882b01ebca260220a7c5dc1427df7`, PR #563, merged main `e66a03a89b8fe8102627d896e70ea73bef8d6fed`, tree `5b24886c445df8ee314a82569949d40af88c6217`, sole automatic Railway deployment `f8877912-3064-4ad7-a80b-93fe232d551e` `SUCCESS/RUNNING` with instance `4d28dedd-b642-4284-8d88-4091b6666d1b`, image `sha256:9bd4ec8fc0824a8b4c0bce498d6e11e6c606dc9ad03ba60f3552b89191b8f911`; source and production have 270 migrations through 274/no275, canonical startup and exact-active-service health/root/demo verified. Its complete fresh independent whole-head audit accepted P0=P1=P2=P3=0 with exact Node 22.23.3 15/15 suites and 208/208 tests, syntax 15/15, JSON 14/14 and frozen inputs 10/10; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 4C artifacts: [coherent currentness revalidation contract](../architecture/MISSION_28_PART4C_CURRENTNESS_REVALIDATION_CONTRACT.md) and [executable revalidation contract](../architecture/MISSION_28_PART4C_CURRENTNESS_REVALIDATION_CONTRACT.json).
- Released Part 4D baseline: accepted corrected source head `41be176abfddae512f34da25a9d3564b1fea6e1b`, PR #564, merged main `7308a529f7f6e295d786fd2c52073705eebaa2f2`, tree `df150a26d03642cb4930de8914b85bf5d8b73510`, sole automatic Railway deployment `82b50c73-5414-4e7f-bb07-72d71f65dc92` `SUCCESS/RUNNING` with instance `99c20fdd-cf03-4b8b-98cf-20f05d8bd72f`, image `sha256:2ac7426c032f38de4b1715e59ed382cb92b0af9486baf8be43150a8c5cc9371b`; source and production have 270 migrations through 274/no275, canonical startup and exact-active-service health/root/demo verified. Its fresh corrected independent whole-head audit accepted P0=P1=P2=P3=0 with exact Node 22.23.3 16/16 suites and 221/221 tests, syntax 16/16, JSON 15/15 and frozen inputs 11/11; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 4D artifacts: [deterministic fact lineage, coalescing and precedence](../architecture/MISSION_28_PART4D_FACT_PRECEDENCE_CONTRACT.md) and [executable precedence contract](../architecture/MISSION_28_PART4D_FACT_PRECEDENCE_CONTRACT.json).
- Released Part 5A baseline: accepted corrected source head `973175776028b563bd5f4a8b1d1282c1ddd9aa05`, PR #565, merged main `0b86beab6d0ac3f81a079d47f8569e8e24c34de7`, tree `12f4e02e10c4b507a8e9b76e81dcff078318059b`, sole automatic Railway deployment `9973fa71-fbfc-4079-b345-cdf2c5f3ab1b` `SUCCESS/RUNNING` with instance `1b57682a-3f02-4892-a9a6-f0302f6438c2`, image `sha256:3066db7c0cbcb190753545db4ba3df4d8e3db8cc475135dbcf940df4b1cc1e9d`; source and production have 270 migrations through 274/no275, canonical startup and exact-active-service health/root/demo verified. Its complete fresh corrected independent whole-head audit accepted P0=P1=P2=P3=0 with exact Node 22.23.3 17/17 suites and 231/231 tests, syntax 17/17, JSON 16/16, frozen inputs 7/7 and docs/tests-only clean diff; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 5A artifacts: [bounded declarative rule grammar](../architecture/MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.md) and [executable grammar contract](../architecture/MISSION_28_PART5A_DECLARATIVE_RULE_GRAMMAR.json).
- Released Part 5B baseline: accepted corrected source head `1ed57934cd127b083a3accacc9735ae6b3b9f5cd`, PR #566, merged main `0f942b0758297b4514847783b49c6812fa50e71d`, tree `584c7388e382c3cf071f65945991e7a17eec90d8`, automatic Railway deployment `cb9fcc37-473e-43c9-b243-37ce1860b17d` `SUCCESS/RUNNING` with instance `2edcb483-5388-4375-b43a-7a7841bf1807`, image `sha256:99d66b682bcd53d9b6822a6ced0a663b6591b7aa4156f7bbe8c084c3833b4ce2`; source and production have 270 migrations through 274/no275, canonical startup and exact-active-service health/root/demo verified. Its complete fresh corrected independent whole-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 5B artifacts: [deterministic explainable evaluator](../architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.md) and [executable evaluator contract](../architecture/MISSION_28_PART5B_DETERMINISTIC_EVALUATOR_CONTRACT.json).
- Released Part 5C baseline: accepted corrected source head `4533cc9be115ecd4195193d2ec7a2e196defe729`, PR #567, merged main `cff573851f853e3e729fdd6a964c8b031352c00b`, tree `51e1513401928200d4f676630339afc0021637dd`, automatic Railway deployment `08ee5c3c-1bf8-497d-b90e-96111210b8df` `SUCCESS/RUNNING` with instance `db41c5f3-0991-4fc3-853a-4877597e9019`, image `sha256:abd9e05fc5d06d43a89cbb0a051c9207a2cbbbd26eed101cda0d938fba7286e4`; source and production have 270 migrations through 274/no275, canonical startup and exact-active-service health/root/dashboard/demo verified. Its fresh independent corrected-head audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 5C artifacts: [owner-readable no-effect preview](../architecture/MISSION_28_PART5C_OWNER_READABLE_PREVIEW_CONTRACT.md) and [executable preview contract](../architecture/MISSION_28_PART5C_OWNER_READABLE_PREVIEW_CONTRACT.json).
- Released Part 5D baseline: accepted source head `244a3cddb4e67a375aeab507294b87426dbfcfda`, PR #568, merged main `8e83cf96a8f8102dd04d88e1458389ce21219dbf`, tree `b02826b3fc2269dbb7bc0676c167d8610625d80d`, sole automatic Railway deployment `9ddb846c-bcbc-4024-aebe-83ca2a9c8cbf` `SUCCESS/RUNNING` with instance `f384b83f-520a-40ca-b544-8dc567c184d1`, image `sha256:02002ac870993b765e3cef94f55c1b17f51bbca49b95fe5f2a1ebb6b63a05998`; source and production have 270 migrations through 274/no275, canonical startup and exact-deployment health/root/dashboard/demo verified with paid/demo rendered title/byte parity. Its complete fresh independent audit accepted P0=P1=P2=P3=0; the report hash was not supplied to this writer and remains unclaimed.
- Released Part 5D artifacts: [collision, suppression and no-effect analysis](../architecture/MISSION_28_PART5D_COLLISION_SUPPRESSION_DRY_RUN_CONTRACT.md) and [executable contract](../architecture/MISSION_28_PART5D_COLLISION_SUPPRESSION_DRY_RUN_CONTRACT.json).
- Current Part 6A artifacts: [transactional outbox and bounded action-unit contract](../architecture/MISSION_28_PART6A_TRANSACTIONAL_OUTBOX_CONTRACT.md), [executable contract](../architecture/MISSION_28_PART6A_TRANSACTIONAL_OUTBOX_CONTRACT.json), and additive migration `275_canonical_automation_transactional_outbox_v1.sql`. Writer evidence is not independent acceptance.

The source's proposal/review status is immutable provenance from before founder approval and Mission 27 terminal release. This repository record reconciles that status only; it does not change the approved mission body, fourteen-part order, sixty-six-slice order, invariants, exclusions, acceptance standard, or release discipline. Any future authority change requires an explicit founder decision and a newly recorded source/body identity before implementation continues.

## Mission objective

Mission 28 gives each NorthStar business a trustworthy, tenant-private way to automate approved communication, reminders, collections, and internal follow-up from exact current NorthStar facts. Automation remains under owner control: every policy is explicit, bounded, explainable, pausable, reversible where the underlying action permits it, and protected by a global stop mechanism. An event, prediction, learned recommendation, elapsed clock, or provider callback never creates action authority by itself.

The complete proposed structure is **14 serialized parts and 66 slices**. Counts become frozen planning boundaries only after founder approval. Any later change requires a written authority or acceptance reason, affected gates, and a revised total before implementation continues.

## Controlling mission boundaries

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
| Mission 29 | Later enterprise governance, custom roles, thresholds, SSO/MFA policy, and organization-scale administration | Pulling forward Mission 29's enterprise administration; Mission 28 implements only the fixed minimum capabilities needed to operate safely |
| Missions 30–33 | Later reviewed handoffs where explicitly compatible | OS-wide integration, public guided simulation, calculator ownership, or platform administration |

Mission 28 owns automation policy, evaluation, approval, scheduling, execution coordination, outbound communication evidence, suppression, recovery, and the owner-facing Automation Center. It may create its own internal automation tasks, approvals, run records, and delivery evidence. It may not mutate an upstream business fact merely because it communicated about that fact.

## Non-negotiable mission invariants

1. **Owner control is durable authority.** Each consequential action is covered by an exact current per-run approval or a versioned standing policy with explicit action, source class, audience, channel, timing, limits, and stop conditions.
2. **No source fact grants action authority.** A lead, appointment, completion, overdue invoice, prediction, or learned recommendation may make a policy eligible; it cannot activate, widen, or execute the policy.
3. **Currentness is checked twice.** The engine pins exact source versions during evaluation and revalidates every relevant source, policy, recipient, consent, limit, and suppression immediately before the external or consequential effect.
4. **Intent, execution, and evidence stay separate.** Eligibility, planned action, queued run, provider attempt, accepted delivery, acknowledgement, reply, failure, and business outcome are distinct append-only facts.
5. **Uncertainty fails closed.** Missing authority, unknown consent, ambiguous recipient, stale source, mixed tenant, unsupported channel, unknown provider outcome, exceeded limit, or conflicting state never becomes permission, success, zero, or a harmless default.
6. **Retries do not duplicate effects.** Every action has stable tenant-scoped idempotency, a bounded retry policy, explicit uncertain-outcome handling, and reconciliation before another provider attempt.
7. **Human activity wins.** A current reply, manual send, owner action, changed source, dispute, opt-out, pause, or cancellation suppresses or rebuilds affected pending automation rather than racing it.
8. **AI may prepare; it may not self-authorize.** Generated wording is a bounded draft based on approved facts and templates. It cannot invent claims, alter documents or amounts, widen recipients, bypass approval, or infer consent.
9. **Demo cannot escape.** Demo policies, recipients, queues, links, providers, callbacks, and evidence are physically and logically isolated, use fictional content, and can never create a paid-tenant or real outbound effect.
10. **Provider-neutral design is mandatory.** Channel adapters remain replaceable. Provider identifiers, credentials, payloads, or status labels never become business authority.
11. **Privacy is minimized throughout.** Logs, metrics, queues, idempotency keys, traces, screenshots, exports, and callbacks exclude message bodies, document contents, secrets, public tokens, and unnecessary customer data.
12. **Mission completion requires product proof.** Static contracts and APIs are insufficient. Accepted paid and isolated-demo journeys must prove owner control, currentness, suppression, failure, recovery, accessibility, and accurate state through mounted production modules.

## Part 1 — mission authority, inventory, risk model, and acceptance contract

| Slice | Scope |
| --- | --- |
| A | Ratify Mission 28 ownership, exclusions, terminology, dependencies, fourteen-part order, and the boundary between an upstream fact, an automation decision, an external effect, and evidence of that effect. |
| B | Inventory and classify every existing cron job, worker, queue, event listener, notification, email/SMS path, native share handoff, reminder, retry, collection label, webhook, template, provider adapter, demo action, and manual quick-send surface. Quarantine legacy, simulated, account-subscription, unsupported, or ambiguous paths before reuse. |
| C | Freeze the action and risk catalog: internal read/digest/task, owner approval request, customer communication, secure document delivery, financial reminder, collection escalation, and explicitly unsupported upstream mutation or money movement. Define abuse, privacy, confused-deputy, spam, harassment, replay, cross-tenant, stale-source, prompt/content injection, provider, and denial-of-service threats. |
| D | Freeze the first-supported launch matrix and acceptance ledger: source classes, action families, roles/capabilities, channels, recipient classes, countries/regions, consent bases, quiet hours, languages, providers/modes, limits, retention, legal/provider review, rollout flags, demo behavior, performance bounds, unavailable states, migration rules, audit independence, and release sequence. |

Part 1 exits only when every current automation-like surface has a disposition, every first-launch action has an owner and risk class, and unsupported combinations fail closed in executable contract tests. Professional legal, privacy, provider, and regulatory review remains a named launch dependency rather than an inferred product claim.

## Part 2 — canonical automation policy, run, and evidence model

| Slice | Scope |
| --- | --- |
| A | Canonical tenant-private policy definition with stable identity, append-only versions, exact trigger/action grammar, source classes, recipients, channels, schedules, limits, approvals, suppressions, expiry, rollout state, and canonical digest. |
| B | Separate immutable records for eligibility evaluation, proposed action, approval, scheduled run, action unit, provider attempt, provider acknowledgement, delivery state, reply/opt-out, internal task, suppression, cancellation, reconciliation, and terminal outcome. |
| C | Policy lifecycle for draft, validate, preview, activate, pause, resume, supersede, expire, retire, emergency stop, and bounded rollback. Historical runs remain bound to the exact policy and source snapshot that created them. |
| D | PostgreSQL authority, tenant RLS, exact timestamps/time zones, trusted-clock contract, deterministic canonicalization, digest/currentness rules, bounded fields, indexes, retention classes, additive migration/restart behavior, and zero legacy adoption without reviewed conversion. |

## Part 3 — owner control, capabilities, limits, and approvals

| Slice | Scope |
| --- | --- |
| A | Fixed capability matrix independent of display role names for viewing automation, drafting policies, approving a run, activating or changing standing authority, pausing, retrying, exporting evidence, managing channel availability, and operating the tenant-wide stop control. |
| B | Exact distinction between per-run approval and standing authorization. Both pin actor, session, recent-authentication state where required, policy/source/preview digests, intended recipients/effects, reason, expiry, and idempotency; neither can be reused after a material change. |
| C | Owner-defined frequency, recipient, channel, time-window, quiet-hour, action-count, invoice-value, aging-stage, campaign, daily/weekly volume, and provider-spend limits with fail-closed enforcement. Minimum mandatory constraints cannot be weakened by a tenant policy. |
| D | Pause, revoke, kill, drain, cancel, resume, dual-control where required, self-approval restrictions, break-glass evidence, and safe degraded defaults. Preserve the boundary that custom roles, enterprise threshold administration, SSO, and organization-scale governance remain Mission 29. |

## Part 4 — trigger ingestion, exact source binding, and correction propagation

| Slice | Scope |
| --- | --- |
| A | Closed trigger catalog over accepted facts from Missions 20–27, including lead/contact state, quote lifecycle, appointment/dispatch state, work progress/completion, invoice/due/payment/collection state, and advisory Mission 25/26 handoffs. Each trigger names grain, source authority, event time, observation time, currentness, and allowed action families. |
| B | Durable tenant-scoped ingestion and source snapshot that binds exact record identity, version/revision, canonical/source digest, actor or authenticated event provenance, availability, and correction lineage without copying upstream business authority into Mission 28. |
| C | Evaluation-time and immediately-pre-effect revalidation. Policy, sources, recipient, consent, channel, limits, prior effects, and suppressions must form one coherent current decision; mixed before/after snapshots and check-then-act races fail closed. |
| D | Deterministic handling of duplicate, replayed, late, reordered, corrected, tombstoned, reopened, reversed, replaced, and concurrently changing facts. Coalescing and precedence are explicit; cross-request, cross-tenant, stale-cache, alias, clone, and replay reuse cannot grant eligibility. |

## Part 5 — rule evaluation, collision control, preview, and dry run

| Slice | Scope |
| --- | --- |
| A | Bounded declarative rule grammar with typed conditions, supported comparisons, explicit unavailable/unknown values, approved action templates, no arbitrary code, no hidden provider logic, and no missing-as-zero behavior. |
| B | Deterministic evaluator with exact policy/source/output digest, reason codes, evidence quality, next evaluation time, and explainable eligible, ineligible, suppressed, unavailable, expired, or approval-required result. |
| C | Owner-readable preview stating what will happen, why, on which exact source, to whom, through which channel, with which document/message version, at what local time, under which limits, and what will stop it. Preview never creates the effect. |
| D | Collision and suppression engine for overlapping policies, recent manual activity, duplicate content, active conversations, opt-outs, provider uncertainty, source changes, higher-priority actions, and global/tenant/customer/document pauses. Dry-run and historical backtest use tenant-private accepted evidence, create no external effects, and cannot be presented as provider or outcome proof. |

## Part 6 — durable scheduling, execution, idempotency, and recovery

| Slice | Scope |
| --- | --- |
| A | Transactional outbox from an accepted current decision to bounded action units, with atomic policy/source/run identity and no queue publication before the authoritative transaction commits. |
| B | Durable scheduler using tenant time zone, explicit local schedule, UTC instant, daylight-saving gaps/folds, business calendars, quiet hours, holidays, expiration, and trusted-clock semantics. |
| C | Tenant-scoped leases, fencing, concurrency, ordering, fan-out bounds, idempotency receipts, and provider request identity that prevent double effects across workers, processes, restarts, deploys, regions, and uncertain acknowledgements. |
| D | Per-action retry and backoff with retryable/terminal classification, `Retry-After` bounds, jitter, attempt ceiling, provider timeout handling, reconciliation before resend, and a permanent stop for unknown or unsafe outcomes. |
| E | Cancel, pause, revoke, supersede, drain, resume, expire, dead-letter, owner-reviewed retry, and bulk-stop behavior with exact treatment of queued, leased, in-flight, uncertain, and completed actions. |
| F | Restart, migration, worker crash, database outage, provider outage, partial callback, deployment, and restore/reconciliation procedures with zero orphaned authority, bounded residue, complete run history, and an explicit disaster-restore evidence gap until separately exercised. |

## Part 7 — sender, recipient, content, channel, and reply safety

| Slice | Scope |
| --- | --- |
| A | Exact sender identity and recipient authority from current accepted business/customer/contact records; distinguish customer, authorized billing contact, lead, staff member, and unsupported recipient. No fuzzy match, free-form widening, or cross-customer reuse. |
| B | Versioned communication permission, channel preference, consent or other reviewed basis, opt-in/opt-out, do-not-contact, quiet hours, age/jurisdiction restrictions where applicable, and suppression. Unknown or conflicting permission blocks execution. |
| C | Approved templates with bounded variables, customer-safe projection, locale/language/version, preview, escaping, link/attachment selection, and adversarial stored-text handling. AI-assisted wording remains a labeled draft and cannot invent offers, threats, deadlines, amounts, legal claims, or authority. |
| D | Provider-neutral email and SMS delivery plus supported native app/share/composer handoff. Opening a native composer is recorded as a handoff, never as sent or delivered. Channel capability, fallback, cost, attachment, and recipient-prefill limitations are truthful. |
| E | High-entropy scoped links and customer-safe attachments with exact document version, expiry, revocation, rate limits, no-store/private behavior, no token/referrer/log leakage, and no third-party content that exposes customer access. |
| F | Bounces, blocks, complaints, delivery receipts, opens where lawfully and reliably supported, replies, customer questions, opt-outs, undeliverable contacts, and provider status corrections. Provider metadata is minimized, and a callback cannot bypass tenant/source/action validation. |

## Part 8 — approved document sending and revision-aware delivery

| Slice | Scope |
| --- | --- |
| A | Mission 24 estimate, proposal, and quote sending from one exact current approved customer-safe version, with recipient/document/message/channel preview, explicit approval or standing authority, expiration, customer response, and no price or scope mutation. |
| B | Mission 27 invoice, receipt, credit note, replacement, refund/dispute notice, and other supported financial-document delivery from one exact issued/current customer-safe version, with no charge, refund, write-off, accounting, or balance mutation. |
| C | Manual quick-send, native handoff, and policy-driven delivery share one version/currentness/idempotency contract. Revisions preserve every earlier sent snapshot and require a new preview and approval or matching standing policy before resend. |
| D | Delivery/view acknowledgement, duplicate prevention, revoke/resend/recovery, customer question/revision request, inaccurate-recipient correction, and exact status presentation. NorthStar never claims delivery from queueing, provider acceptance, or composer opening alone. |

## Part 9 — lead, estimate, and customer follow-up automation

| Slice | Scope |
| --- | --- |
| A | Owner-controlled acknowledgement and internal alert for a supported current inquiry or lead, using only accepted contact facts and business availability; no invented response-time promise, estimate, price, or booking. |
| B | Bounded contact-attempt and response-follow-up cadence with channel permission, frequency/quiet-hour limits, manual-activity collision handling, reply/opt-out suppression, and a clear owner worklist when automation stops. |
| C | Estimate/quote delivery follow-up for exact current sent/expiring/expired/accepted/declined/question/revision states. It may invite the supported customer action but cannot extend terms, change price/scope, fabricate urgency, or treat silence as acceptance. |
| D | Customer re-engagement and service follow-up only where the Part 1 launch matrix, reviewed communication basis, current customer relationship, policy, and suppression rules permit it. Marketing-like, referral, review-request, or long-dormant outreach remains unavailable until explicitly supported and reviewed. |

## Part 10 — appointment, dispatch, work, and completion communications

| Slice | Scope |
| --- | --- |
| A | Confirmation and reminder communication from one exact current Mission 22 appointment, with local time/time zone, location-safe wording, assigned contact, change/cancellation currentness, and no scheduling mutation. |
| B | Supported dispatch, on-the-way, delay, arrival-window, or cancellation communication from exact Mission 22 state and policy. Automation cannot infer travel/arrival, expose private worker data, or change route, assignment, or appointment. |
| C | Supported work-started, progress, blocked, ready-for-review, completed, reopened, or aftercare communication from exact Mission 23 customer-safe evidence. Internal notes, staff details, cost/margin, uncertain completion, and unsupported predictions stay private. |
| D | Customer confirmations, questions, reschedule/cancel requests, access updates, and completion concerns create bounded response evidence or owner/staff tasks through accepted handoffs. They do not directly rewrite Mission 22 or Mission 23 authority. Source corrections immediately cancel, stale, or rebuild affected pending communications. |

## Part 11 — invoice reminders and human-controlled collections automation

| Slice | Scope |
| --- | --- |
| A | Collection eligibility from one exact current Mission 27 issued invoice and separate balance, due/aging, delivery, dispute/refund, settlement, and accounting states. Drafts, unknown delivery, stale balances, void/replaced documents, and unsupported customer states are ineligible. |
| B | Owner-controlled pre-due, due, and overdue reminder policies with explicit cadence, local time, recipient, channel, wording, grace periods, frequency ceiling, approval class, and stop conditions. Aging is evidence, not permission. |
| C | Every reminder pins the exact current invoice/document, currency, amount due, secure payment destination, and customer-safe balance explanation. It cannot add a fee, change terms, initiate a charge, choose a payment method, or imply settled/earned/accounted status. |
| D | Immediate suppression or rebuild on full/partial payment, pending or uncertain payment, payment failure, refund, dispute, reversal, credit, void, replacement, reopening, customer question, correction, promised payment, manual contact, opt-out, or owner pause. |
| E | Graduated owner worklist and escalation for supported late stages, including approval request, call/manual task, final supported notice, and pause/review. External collection agencies, legal threats, credit reporting, liens, repossession, financing, unsupported fees, write-offs, and legal conclusions remain unavailable without separate authority and professional review. |
| F | Attempt, delivery, reply, promise, suppression, owner intervention, and Mission 27 collection-outcome reconciliation with exact lineage. Communication evidence never becomes payment, cash, revenue, accounting, or successful collection by inference. |

## Part 12 — internal action center and advisory handoffs

| Slice | Scope |
| --- | --- |
| A | Tenant-private owner/staff tasks, alerts, approval requests, failure work, and follow-up queues created from exact current sources with capability/record-scope visibility, assignee, due window, reason, priority, source link, and completion evidence. |
| B | Mission 25 recommendations and Mission 26 facts/predictions may create a supported attention item or approval request only through an accepted handoff and current policy. Evidence quality, uncertainty, horizon, and unavailable state remain visible; no learned or predicted action executes itself. |
| C | Deduplication, grouping, priority, digest, snooze, dismiss, assign/reassign, escalate, expire, reopen, and source-correction behavior that prevents alert storms and preserves unresolved consequential work. |
| D | Owner-facing explanation and drilldown from action to policy, source, decision, limits, prior attempts, current state, and next safe choice. Internal actions cannot bypass the separate external-send, schedule, work, estimate, financial, or enterprise authority required for that choice. |

## Part 13 — channel adapters, callbacks, observability, privacy, and lifecycle

| Slice | Scope |
| --- | --- |
| A | Provider-neutral adapter contract and capability discovery for supported outbound channels, callbacks, attachments, templates, limits, modes, costs, and status meanings. Every adapter starts disabled and unsupported capabilities stay unavailable. |
| B | Connection and credential boundary with tenant-bound provider/account identity, secret isolation, least privilege, livemode/testmode separation, connect/disconnect/revoke state, credential rotation, and no credential or private payload in browser, logs, evidence, or demo. Provider/account provisioning may remain an upstream integration dependency. |
| C | Authenticated callbacks and status reconciliation with signature/version/clock/replay protection, raw-evidence minimization, tenant/action binding, correction handling, and explicit distinction among accepted, sent, delivered, opened, replied, failed, complained, and unknown. |
| D | Provider outage, quota, throttling, template rejection, credential failure, degraded capability, circuit breaker, bounded fallback, and channel/provider switching. No fallback widens consent, changes content silently, or creates duplicates across providers. |
| E | Privacy-safe metrics and traces, immutable action audit, retention and deletion, legal/audit hold, customer erasure, tenant offboarding, policy/source revocation, export, cleanup, incident evidence, and recovery. Platform-wide cross-tenant analytics remain Mission 33 and require separate privacy authority. |

## Part 14 — Automation Center, isolated demo, complete validation, and release

| Slice | Scope |
| --- | --- |
| A | Paid Automation Center with concise status, policy templates and custom bounded setup, preview, approval inbox, active/paused/failed runs, customer/document timeline, owner work, limits, channel availability, stop controls, explanations, and progressive drilldown. No hidden automation or implementation jargon in primary flows. |
| B | Complete loading, empty, unavailable, stale, conflict, validation, approval, queued, in-flight, uncertain, suppressed, failed, paused, stopped, expired, completed, corrected, and recovery states with fail-closed clearing of sensitive or obsolete data. |
| C | Isolated paid-application demo parity using the same policy, evaluation, scheduler, suppression, rendering, and recovery engines with coherent fictional sources, virtualized controlled time where needed, deterministic provider simulation, reset, zero real recipients/providers/money, and no adoption into paid authority. Mission 31's later public guided simulation remains separate. |
| D | Exhaustive semantic and structural contract matrices across policies, sources, versions, digests, currentness, roles/capabilities, sessions, tenants, recipients, consent, paths, queries, bodies, framing, methods, CORS, templates, callbacks, idempotency, concurrency, corrections, retries, restarts, privacy, and zero unintended effects. |
| E | Fresh disposable PostgreSQL validation through every migration; mounted production modules; real session/CSRF/routes/database; queue/worker/restart/provider-fixture behavior; high-volume and degraded-path measurements without claiming production performance or an SLA. |
| F | Genuine paid and isolated-demo Chrome plus Playwright WebKit desktop/mobile acceptance for every rendered workflow: keyboard/focus, screen-reader semantics, responsive layouts, light/dark, direct/reload/back-forward/deep links, delayed/stale/error/recovery, reset, source changes, stop controls, and zero request/response interception or shortcuts. Physical Safari/devices and manual assistive-technology review remain unavailable unless actually performed. |
| G | Fresh independent whole-head audit reporting all P0–P3 findings, same-writer corrections and complete re-audit, exact clean frozen identity, one normal PR/merge, sole automatic deployment, startup/migration/health/root/demo verification, and post-deploy passive acceptance. Any live provider, real recipient, private-production, or live-money canary requires a separate explicit authorization with exact tenant, recipient, content, channel, provider, limit, stop, rollback, observation, privacy, and cleanup plan. Founder page-by-page visual approval remains a separate later verdict. |

## Complete acceptance standard

Mission 28 is complete only when all 66 slices are accepted in order and the released product proves all of the following:

- An owner can understand, preview, approve, activate, limit, pause, stop, inspect, recover, and retire every supported automation.
- Every effect is derived from exact current tenant-private authority and covered by exact current action authority.
- Corrections, replies, opt-outs, manual work, payments, disputes, schedule/work changes, policy changes, provider uncertainty, and global stops propagate before another unsafe effect.
- Supported document sending, lead/estimate follow-up, appointment/work communication, invoice reminders, collections escalation, and internal action handling operate through one consistent engine without blurring their source authorities.
- Delivery and outcome labels reflect evidence exactly; queued or provider-accepted work is never called delivered, answered, paid, collected, successful, or reconciled without the matching accepted fact.
- Paid and demo behavior share production logic while demo remains incapable of external or paid-tenant effects.
- No implementation claims unsupported legal compliance, provider availability, physical-device coverage, disaster restoration, production performance/SLA, private-production evidence, or live-money validation.

## Explicitly unavailable until separately evidenced or authorized

- Production provider accounts, credentials, sending domains/numbers, verified sender registrations, real callbacks, deliverability reputation, and provider-specific templates.
- Professional legal, privacy, communications-consent, collections, debt, consumer-protection, tax, accounting, and security review.
- External collection agencies, legal demands, credit reporting, liens, repossession, financing, automatic fees, write-offs, automatic charges, refunds, or other money movement.
- Private-production tenant/customer data, real recipients, real outbound messages, live provider mutation, and first-paying-customer live-money validation.
- Hosted CI/load evidence, exercised disaster restore, production performance/SLA, physical Safari/devices, manual assistive-technology review, and founder visual approval.

## Implementation order and release discipline

Implementation starts only after Mission 27 terminal release acceptance and an exact deployed-main/tree baseline is recorded. Work proceeds Part 1 through Part 14 in slice order using one writer and one independent auditor serially. Each slice begins with source and dependency reconciliation, smallest genuine missing behavior, explicit unavailable evidence, and front-loaded adversarial matrices. Expensive PostgreSQL and browser gates run only after semantic, structural, source, currentness, privacy, and no-effect gates are green. Each accepted release uses one reviewed branch, one normal merge, one automatic deployment, and read-only release verification before the next slice starts.
