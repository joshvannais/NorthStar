# Mission 27 Part 7B — provider connection and credential lifecycle boundary

## Frozen authority

Part 7B implements the owner-controlled lifecycle boundary selected by the
immutable `mission27.launch.v1` policy. The supported policy operations are
`connect`, `disconnect`, `rotate`, and `revoke` in test mode. A reconnect is a
new explicit `connect` operation after an exact verified disconnected
predecessor; automatic reconnect is forbidden. Live lifecycle operations need
two different current humans, separate live authorization, and the accepted
live-canary plan, so live mode remains disabled.

Role alone never authorizes an operation. This capability is owner-only and
requires a current `customer_financial.provider.connect` grant, a server-owned
recent-authentication fact, an accepted recent MFA ceremony, fresh
confirmation, a bounded reason, and an exact same-tenant provider account,
mode, and provider capability set. Administrators and members cannot acquire
the capability from their role or from the legacy integration catalogue.

## Mounted value-free boundary

`GET /api/v1/customer-financial/payment-provider/connection` gives a current
paid owner a private, no-store projection of the exact prerequisites and four
policy operations. `POST .../actions` accepts only one exact operation, an
explicit confirmation, and a printable bounded reason after the normal
PostgreSQL-backed session, tenant, subscription, owner-role, CSRF, and rate
boundaries. Every action query is rejected before repository entry, and the
body reason must already be trimmed, nonblank, printable, and bounded. The
payload cannot carry a provider account, mode, capability set,
credential, secret, instrument, or live-enable claim.

No accepted tenant provider-account identity, provider capability set, MFA
ceremony, provider-scoped capability grant, or server-side credential authority
currently exists. Every action therefore returns the named value-free
`provider_connection_prerequisites_unavailable` state before any provider or
credential effect. The denied intent is not a durable provider action or an
idempotency receipt, and it cannot satisfy Part 7C payment authority.

The credential contract is server-side secret-reference only. Raw secret input
is rejected; a raw credential is never stored or returned to a browser. Rotation
and revocation stay unavailable until an accepted credential authority exists.
NorthStar stores no raw card or bank credential, no saved instrument, and no
provider object in this slice. No generic `integration_credentials`, Stripe
subscription identity, Retell/Jobber connection, demo fixture, request field, or
environment variable is accepted as customer-payment connection evidence.

## Evidence and exclusions

Acceptance requires strict policy/contract and payload-shape tests plus a fresh
mounted PostgreSQL 17 campaign through migration 272. The campaign covers paid
owner read, administrator/member/unauthenticated/query/subscription denial,
real CSRF rejection, all four exact action intents, live/reconnect/account/secret
injection rejection, deterministic restart, zero database residue, and zero
provider transport. Part 7B adds no migration 273 and no rendered surface, so
browser and visual evidence are not applicable.

Provider account/KYC, accepted MFA, capability grant issuance, hosted onboarding,
credential storage/rotation/revocation, provider sandbox/private production,
events, fees, legal/provider/security opinions, payment initiation, settlement,
payout, reconciliation and live money remain unavailable. Live-money validation
stays deferred until the first real paying customer, and founder visual approval
remains separate. Part 7B is released; Part 7C was released through PR #506,
and Part 7D is the current implementation candidate.
