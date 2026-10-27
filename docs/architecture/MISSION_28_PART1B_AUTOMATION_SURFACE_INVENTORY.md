# Mission 28 Part 1B — automation-surface inventory and quarantine

Status: **Implementation candidate only.** This inventory is writer-produced evidence. It is not independently accepted and grants no runtime or provider authority.

The executable inventory is [MISSION_28_PART1B_SURFACE_INVENTORY.json](MISSION_28_PART1B_SURFACE_INVENTORY.json). It is bound to deployed baseline `21ca719e24382443bbf3f52e460f3c16b016c4ad` / tree `0cfdc4f0e8dc28c790893edff7bbebe0b31a5d10` and to the released Part 1A authority. Every record names its current owner, exact source anchors, disposition, and effect boundary. A source file containing an adapter, queue, label, retry, template, or button is evidence that the surface exists; it is never evidence that Mission 28 may use it.

## What was inventoried

The source review found 49 automation-like surface families. The family boundary is intentional: one surface represents one current authority/effect boundary and may list every exact route, concrete provider implementation, event producer, durable write, and active consumer it owns. It does not collapse different owners or dispositions.

| Disposition | Count | Meaning in Part 1B |
| --- | ---: | --- |
| `mission28_owned_reusable_after_later_authority` | 2 | The upstream source explicitly reserves a handoff for Mission 28, but no current receiver or external action is authorized. A later slice must still establish policy, currentness, recipient, provider, approval, execution, and evidence. |
| `upstream_or_subscription_owned_excluded` | 19 | The surface is active only inside another mission or account/subscription workflow. Mission 28 may not borrow its facts, credentials, recipients, retries, or effects. |
| `simulated_or_demo_only` | 8 | The surface is isolated fictional/demo behavior. It may support a later demo only after exact parity acceptance and may never escape into paid/private/provider state. |
| `legacy_unsupported_or_quarantined` | 14 | Code exists, but its authority chain is incomplete, retired, global, client-held, or otherwise unsupported for reuse. It remains fail-closed. |
| `manual_handoff` | 3 | NorthStar opens or creates a user-controlled native/file handoff. The handoff is not sent, delivered, answered, or successful evidence. |
| `ambiguous_fail_closed` | 3 | A label, preference, or conditional adapter exists without enough authority to classify it as an executable Mission 28 path. It stays unavailable. |

The inventory tags every required Part 1B facet: cron job, worker, queue, event listener, notification, email/SMS path, native share/composer handoff, reminder, retry, collection label, webhook, template, provider adapter, demo action, and manual quick-send. These tags overlap because a single real surface can be both a queue and a retrying email path.

## Key inventory findings that remain quarantined

- `node-cron` is installed but no NorthStar source imports it or registers an executable cron job. Dependency presence is not a scheduler.
- The authenticated legacy `/api/leads/simulate` route can append to Google Sheets and fan out through legacy email/SMS adapters. Its “simulate” name does not make those external effects fictional; the complete path is quarantined.
- Browser `CommunicationsEngine` and `RetellProvider` modules can register client-side providers and expose call/SMS methods. Browser state and browser-held configuration are not tenant provider authority.
- The legacy simulator is loaded on four paid dashboard pages. It generates a fictional call, mutates browser-local AppStore lead state, emits `call:generated`, and the main paid dashboard can POST that synthetic input through the authenticated/idempotent canonical PostgreSQL graph pipeline. The committed record has explicit simulation provenance; it is not a real lead or Mission 28 effect authority.
- `canonical-intelligence.js` emits local `canonical:loaded` and `canonical:rejected` events for server-owned projections. Those events remain presentation/currentness signals, not automation decisions or effect evidence.
- The legacy file-backed Polaris workflow engine implements reminders, follow-ups, appointments, and workflow records through the legacy communications/store modules. It is not mounted tenant-private scheduling or delivery authority and remains quarantined.
- Three unmounted legacy voice engines expose Retell-compatible lead/tool mutations, a call-ended follow-up/session-persistence pipeline, and automatic human-escalation state. Their file-era writes, fictional appointment confirmation, action labels, and in-memory escalation claims are unsupported and quarantined; none proves an appointment, message, call transfer, or human receipt.
- Current PostgreSQL-backed account notification preferences and destination fields are tenant input facts. Even where the separate quarantined lead-simulation route consumes them, they are not recipient consent, sender/channel authority, or delivery evidence.
- The mounted knowledge-management publication action can enqueue synchronization only after the current Mission 21 approval/publication authority succeeds. A worker can project it only through an explicitly installed, tenant-owned transport. Publication, outbox, retry, and projection remain Mission 21 authority—not a Mission 28 trigger, customer communication, recipient decision, or effect grant.
- Legacy nodemailer, Twilio, Google Sheets, Google Calendar, Jobber, Retell, OpenAI, tax-acquisition, equipment-extraction, and knowledge-projection code retain their existing upstream or unsupported boundaries. The inventory binds the concrete transports and their active consumers rather than treating a factory or route label as the adapter. Nothing in Part 1B invokes them.
- Mission 21 Retell knowledge projection, Mission 24 public tax-source acquisition, Mission 26 inbound-call reconciliation, canonical voice-session creation, and the homepage Retell Web client remain five distinct owner/effect boundaries. Sharing a Retell client or provider name does not collapse their authority.
- Canonical voice-call creation binds the Retell provider effect to tenant-scoped durable session identity and requested/started/failed event evidence. Every direct consumer of that voice-session authority is source-linked to its existing owner, including demo lifecycle, Retell ingestion, and connected-call guidance. The mounted handoff/cancel routes separately require a same-process runtime handle; no production source registers one, so they fail closed before writing `human_handoff` or `call_cancelled`. Provider effect, durable evidence, and runtime action remain distinct boundaries.
- Signed Retell webhook ingress binds the mounted route to the voice handler and its durable PostgreSQL replay authority. The 60-second claim lease, 24-hour retention, 10,000-entry saturation boundary, and claim/release/finalize writes are upstream ingress mechanics; they are not Mission 28 retry, recipient, provider, action, or effect authority.
- Mission 27's mounted owner/admin tenant-private collection-review and reviewed-handoff GET chain is deliberately labeled for Mission 28, but its current receiving adapter is unavailable. Due, aging, promise, review, retry, and handoff labels do not authorize reminders, resend, charges, fees, legal escalation, external collection, or any receiver effect.
- Mission 27's complete mounted payment-provider namespace—connection, lifecycle health/retention/recovery/acceptance, event receipt/normalization, and the base boundary—remains frozen provider-disabled. Queue, backpressure, retry, failover, alert, provider-event, checkout, settlement, refund, reconciliation, and accounting labels remain unavailable evidence boundaries only.
- `tel:`, `mailto:`, the contact-page email composer, and ICS export/import are manual handoffs. NorthStar receives no delivery evidence from opening them.
- No source invokes `navigator.share`. This absence is recorded so a later implementation cannot be mistaken for a pre-existing accepted capability.

## Quarantine contract

Part 1B performs no runtime mutation. For this slice, quarantine means all of the following:

1. The inventory cannot describe an excluded, legacy, demo, manual, or ambiguous surface as reusable Mission 28 authority.
2. No inventory disposition enables a worker, queue, event subscription, route, template, credential, provider, webhook, retry, reminder, recipient, native composer, or demo action.
3. `mission28_owned_reusable_after_later_authority` means only that an upstream handoff is deliberately shaped for later Mission 28 work. It still has no accepted receiving adapter or effect authority now.
4. A queued record, provider response, webhook, toast, label, native composer, file download, or simulated result cannot advance the Part 1A authority chain from upstream fact through decision, effect, and effect evidence by inference.
5. New or changed source patterns fail the executable completeness tests until an intentional disposition with exact anchors is added and independently reviewed.

## Executable completeness boundary

The Part 1B test suite verifies that:

- the JSON contract has exactly one entry per surface ID, only the six allowed dispositions, and coverage for all fifteen required facets;
- every source path exists and every anchor remains present;
- all eight server worker classes remain represented;
- source-wide browser event-producer, event-listener, and simulator script-consumer discovery resolve to the exact inventoried files, so an active AppStore write, EventBus producer, or presentation listener cannot disappear behind a hand-maintained event list;
- the paid simulation endpoint clients, route mount, deterministic pipeline and canonical graph commit are discovered as one complete synthetic-write boundary;
- legacy workflow/reminder engines and current notification preference/destination authorities are source-discovered and separately classified;
- name-bounded discovery binds the mounted knowledge-management publish route through the publication repository, outbox producer, synchronization repository/worker, conditional transport startup, and exact server mount;
- source-wide provider-implementation signals and their relative-import consumers resolve to the exact inventoried source set, including concrete tax, Retell knowledge, call-reconciliation, canonical-voice, and homepage browser transports;
- the dependency-injected OpenAI Polaris chain is separately discovered from production runtime construction through paid, fictional-demo, connected-call, usage-ledger, and execution consumers, so injection cannot hide an active provider consumer;
- source-wide dependency and registration discovery binds the Retell client through canonical session creation, durable voice-session/event authority, mounted call/handoff/cancel routes, and the exact server mount while proving that no production runtime-handle registrar currently owns handoff/cancel execution;
- the paid and fictional-demo secure-estimate creation/copy/open/revoke flow, its shared contract/repository/body boundary, and the public read/accept/question boundary are one source-linked manual handoff; none is classified as automatic delivery;
- source-wide legacy voice automation discovery binds the unmounted Retell tool registry, call-completion pipeline, and human-handoff trigger state to separate quarantined surfaces;
- source-wide dependency discovery binds the signed Retell route to the voice webhook and its directly imported durable replay authority, including exact lease, retention, capacity, replay, saturation, release, and finalize boundaries;
- name-bounded discovery and exact server mount assertions bind the complete collection-review contract/repository/route into the reviewed-handoff contract/repository/route without treating upstream receivable facts or acceptance-only witnesses as a Mission 28 effect surface;
- name-bounded source discovery and exact server mount assertions bind all 33 files in the mounted Mission 27 payment-provider lifecycle, including its unavailable queue/retry/failover/alert and webhook projections;
- the known business-event sources, external provider paths, webhook boundaries, manual handoffs, collection labels, and demo mutation route files remain represented;
- all exact demo command-center mutation entry points in the inventory still occur in the mounted demo router, including dynamically registered path families;
- `node-cron` remains unimported and `navigator.share` remains absent;
- Part 1A is recorded as released, Part 1B is the sole implementation candidate, and Parts 1C–14G remain planned/unimplemented;
- migrations remain at 272 with no 273; and
- production/runtime source does not import this inventory.

The tests are drift detection, not an independent audit and not permission to execute any surface.

## Explicitly unavailable evidence

No provider account, credential, sender, template approval, callback, sandbox, private-production data, real recipient/message, delivery evidence, money or financial effect, hosted load/SLA, disaster restore, physical Safari/device, manual assistive-technology review, professional legal/privacy/communications-consent/collections/provider/security opinion, first-paying-customer live-money validation, or founder visual verdict was used or claimed. Part 1C risk classification and Part 1D launch support remain entirely unimplemented.
