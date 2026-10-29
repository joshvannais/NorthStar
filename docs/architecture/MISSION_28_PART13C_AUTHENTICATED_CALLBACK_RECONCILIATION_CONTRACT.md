# Mission 28 Part 13C — Authenticated callbacks and status reconciliation

Part 13C freezes a provider-neutral authenticated-callback and exact status-reconciliation boundary. It does not mount callback ingress or accept a callback. Every Part 13A adapter remains disabled, and Part 13B provider accounts, connections, credentials, callback endpoints, signature keys and modes remain unavailable. The only current result is `unavailable_no_authenticated_callback_authority`.

## Exact authority and release baseline

The executable source is [MISSION_28_PART13C_AUTHENTICATED_CALLBACK_RECONCILIATION_CONTRACT.json](./MISSION_28_PART13C_AUTHENTICATED_CALLBACK_RECONCILIATION_CONTRACT.json). It binds the released Parts 1C, 3B, 4D, 6C, 6D, 7A, 7B, 7D, 7F, 13A and 13B contracts by normalized-LF digest. Part 13B was independently accepted at source `3ded5a7292e69332d37dfd61017303fe1a41e49c`, normally released through PR #604 and live main `398b0ba45e3e2c150df29c2cf96d1780f76285c7`, and verified by the exact deployment, instance, image, startup, health and rendered identities recorded in the executable contract. Direct applied production migration history remains unavailable and unclaimed.

## Authentication, clock and replay

A future callback is acceptable only after one separately trusted adapter verifies the exact endpoint, tenant-bound provider account and connection, signature scheme, signature-key version, callback version, canonical signed bytes, signature timestamp and replay identity. Candidate data and provider payload fields cannot assert successful verification. Raw signatures, secrets, headers and provider identifiers are not retained.

The signature timestamp must remain inside the fixed future-skew and authentication-latency bounds. Trusted receipt, authentication and observation times are ordered. Provider event time may be late within its bounded age but cannot be too far in the future. None of those times establishes status precedence. The durable callback-event identity and normalized evidence digest establish replay: exact replay creates nothing; conflicting reuse and semantic clone reuse fail closed.

## Exact tenant and action binding

Normalized evidence binds one exact tenant, adapter family, test/live environment, provider-account identity, connection, callback endpoint, Part 6C stable provider-request identity and receipt, transaction, run, unit, outbox, Part 6D attempt, sender/recipient resolution, permission resolution, channel resolution and separately reviewed status capability. A callback cannot create, change or substitute any of them. It also cannot authorize retry, resend, recipient contact, a provider call, or an effect.

## Status meanings and correction lineage

The closed owner-readable status vocabulary is `accepted`, `sent`, `delivered`, `opened`, `replied`, `failed`, `complained` and `unknown`. They remain distinct:

- accepted is not sent or delivered;
- sent is not delivered, opened or replied;
- delivered is not opened, replied or a business outcome;
- opened requires separately reviewed reliable capability for the exact provider/channel/region/recipient class;
- replied requires exact authenticated recipient and outbound-action identity and retains no message body;
- failed grants no retry or resend authority;
- complained is separate recipient-protection evidence and requires separate suppression authority before later eligibility;
- unknown is a reconciliation resolution derived from missing, conflicting, unmapped, ambiguous or unavailable evidence; it is never accepted as a provider-supplied or directly mapped callback status and requires reconciliation with no resend.

No status implies payment, collection, cash, revenue, accounting, settlement, customer satisfaction, business success or a legal outcome.

Every normalized evidence event is immutable, sequence-plus-one and exact-predecessor bound. A correction is a separately authenticated append-only event that identifies the exact prior evidence identity and digest, materially changes normalized status evidence, and keeps all tenant/account/connection/action/attempt/recipient/permission/channel/capability bindings exact. Event, receipt, authentication and observation times never override lineage. Late, reordered or conflicting evidence remains append-only and resolves to unknown until exact reconciliation; history is never rewritten.

## Raw-evidence minimization and current boundary

Only closed normalized states, reasons, internal identity digests and exact times may be retained later. Raw payload, headers, signatures, provider identifiers, free-text status, message/document content, recipient contact values, IP addresses and user agents are retained at zero and never appear in browser, logs, metrics, traces, exports, evidence or demo.

The fixed label is `Authenticated provider callbacks are unavailable.` Part 13C adds no migration, table, function, route, UI, worker, queue, callback, adapter or resolver. It accepts no real callback, reads no secret, creates no evidence, message, provider attempt, recipient contact, external effect, upstream mutation, financial effect or money movement.

Provider outage, quotas, throttling, template rejection, credential failure, degradation, circuit breaking, fallback and switching belong to Part 13D. Observability, retention, deletion, legal/audit hold, erasure, offboarding, export, cleanup and incident lifecycle belong to Part 13E. Parts 14A–14G remain unimplemented. Provider/private-production/live-recipient/live-money/legal/privacy/regulatory/security and founder visual evidence remain unavailable and unclaimed.
