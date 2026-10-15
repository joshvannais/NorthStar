# Mission 27 Part 8A — authenticated provider-event receipt readiness

## Frozen authority

Original Part 8A owns authenticated raw provider-event receipt: exact signature
verification, bounded payload retention, provider-event uniqueness, provider
account and livemode checks, and replay-safe acknowledgement. A provider event is
evidence. It is never a human approver and never authorizes a new charge.
Normalization, invoice allocation, payment success, capture, settlement, payout
and accounting acknowledgement remain separately ordered Parts 8B–8D.

The immutable source is `mission27.launch.v1`, digest
`d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a`.
It fixes a 256 KiB provider-event limit, a 300-second webhook clock tolerance
and 30-day raw-provider-event retention baseline. That policy also keeps rollout
disabled and requires provider/security review before sandbox acceptance and
legal review before retention launch. Those reviews are currently unaccepted.

## Value-free receipt boundary

Released Part 7 proves no tenant provider account, server signing credential,
provider adapter runtime, current capability set, hosted checkout or accepted
sandbox exists. An incoming request therefore cannot be bound to one tenant and
provider account or have its signature verified. Part 8A must not mount a public
receipt route, accept a raw body, retain bytes, claim uniqueness, acknowledge an
event or create a provider-event table from caller-authored data.

`GET /api/v1/customer-financial/payment-provider/event-receipt` is a private
no-store readiness read for a current paid owner or administrator. It consumes
the exact released Part 7A boundary and exact Part 7B connection witness. The
response names all eight receipt prerequisites as unavailable, returns null for
every provider identity, signature scheme, event identity, payload, digest,
livemode and acknowledgement value, and reports zero receipt rows, provider
calls, provider/receiver mutations and live-money movements. Queries fail closed
before repository entry. No POST, public or demo receipt route exists.

This value-free boundary is the smallest genuine Part 8A behavior supported by
current authority. It prevents an unauthenticated synthetic payload from being
mistaken for provider evidence while giving later work one strict, versioned
contract to replace only when the required provider identity, credential,
verifier and retention authority exist.

## Acceptance evidence and unavailable gates

Acceptance requires strict policy/witness/response-shape tests and mounted fresh
PostgreSQL 17 evidence through migration 272. The campaign covers paid owner and
administrator reads, unauthenticated/member/query/subscription/method denial,
restart determinism, non-reflection of secret/account/mode-shaped input, no
provider-event table or migration 273, zero database residue and zero provider
transport. There is no rendered, public, customer or demo surface, so browser
evidence is not applicable to Part 8A.

Provider account/KYC/capability/credential/adapter runtime, signing and event
authenticity, approved retention launch, sandbox/private production, natural
provider retries, normalization, payment success, capture, settlement, payout,
reconciliation, legal/provider/security opinions, hosted CI/load, physical
Safari/devices, manual assistive-technology review, disaster restore, the
first-paying-customer live-money validation and founder visual approval remain
unavailable and unclaimed.
