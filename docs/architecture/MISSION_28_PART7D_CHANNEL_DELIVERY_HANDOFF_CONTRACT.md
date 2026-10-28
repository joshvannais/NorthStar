# Mission 28 Part 7D — provider-neutral channel and native-handoff truth

Status: **implementation candidate only**. This slice records an owner-only, tenant-private, no-effect channel disposition for one exact current Part 7C preview. It does not mount a channel consumer, provider adapter, callback, operating-system handoff, recipient-message path, or external effect.

## Exact boundary

- `in_app_passive` is the only current ready cell. It remains authenticated internal UI evidence with `provider_disabled`, no provider request identity, no fallback, no recipient prefill, no attachment and no message effect.
- `email` and `sms` are named through provider-neutral transport classes, but remain unavailable. No provider, sender, credential, cost, callback, deliverability, consent, jurisdiction, legal-review or external-effect authority exists.
- `native_manual_handoff` remains the Part 1D manual-excluded surface. No mounted platform event can prove that an app, share sheet or composer opened, so Part 7D records `unavailable_manual_handoff_not_opened` rather than fabricating success.
- A future trusted composer-open event would remain a handoff only. It would never mean attempted, sent, provider accepted, delivered, replied, opted out or successful.
- Channel fallback is never implicit. An unavailable channel stays unavailable; it is not silently replaced by in-app, native, email, SMS, another provider or a later attempt.
- Email, phone, address, message body, document content, token, link and attachment values are neither accepted nor persisted. Only exact immutable identities and digests cross this boundary.

## Durable authority

Migration 284 adds one immutable forced-RLS channel-resolution table and one owner-only, public-revoked storage function. A new resolution must bind one exact action unit, current sender-recipient authority, latest clear internal permission and immutable content preview. The function re-reads and locks those authoritative records before storing its deterministic result. Exact replay returns historical evidence; clone, conflict, cross-tenant reuse, stale source or superseded permission fails closed.

The table records no provider request, handoff-open, attempt, send, delivery, reply, outcome, upstream mutation, accounting mutation or money effect. There is no mounted runtime consumer.

## Evidence limits

Provider sandbox/live evidence, private-production customer evidence, real recipients/messages, mounted native-composer evidence, professional legal/privacy/provider review, hosted load/SLA, exercised restore, physical Safari/devices, manual assistive technology and founder visual approval remain unavailable and unclaimed.
