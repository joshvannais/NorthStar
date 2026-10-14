# Mission 27 Part 7A — payment-provider contract boundary

## Frozen scope

Part 7A mounts the provider-neutral contract that separates NorthStar software
from a contractor's customer-payment account. The contractor business is merchant
of record. NorthStar never takes custody or control of customer funds and provides
no balance, escrow, pooled funds, split transfer, or stored payment instrument.
The launch-selected adapter is Stripe Connect with a tenant-bound contractor
account, provider-hosted onboarding, provider-hosted direct charges, and settlement
to the contractor connected account. Those selections remain policy; they do not
prove a connected provider account or authorize an onboarding or payment action.

The exact immutable source is `mission27.launch.v1`, digest
`d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a`.
Part 7A refuses any widened or substituted policy under that identity. It projects
the frozen US/USD/card/test-mode envelope, live mode disabled, rollout disabled and
tenant flag off. Partial provider payments, multi-invoice provider payments, saved
payment methods, automatic collection, customer surcharges, foreign exchange, and
raw payment-instrument storage stay unsupported.

## Mounted value-free projection

`GET /api/v1/customer-financial/payment-provider` is a private no-store read for a
current onboarded paid owner or administrator. The PostgreSQL-backed account
middleware reloads the exact current session, membership, role, tenant and
subscription before the projection is constructed. The response never returns
the organization, user, session, secret, credential or provider-object identity.

Part 7B has not yet established a tenant provider-account identity, hosted
onboarding lifecycle, server-side credential authority or current
`customer_financial.provider.connect` grant. The account identity, active mode,
test-mode availability, onboarding status and capability grant therefore remain
named and value-free. Provider fee disclosure is also unavailable and cannot be
treated as zero. The customer-surcharge policy is separately unsupported. No
connection, onboarding, payment, event, settlement, receiver, credential or money
mutation route is mounted.

The contract reports one launch-supported method (`card`) and currency (`USD`)
without claiming runtime availability. It records zero provider calls, receiver
mutations and live-money movements. It cannot infer a payment connection from the
generic integrations credential table or any Retell, Jobber, accounting,
subscription-billing, demo or caller-authored value. The account-free demo exposes
no payment-provider endpoint in this slice; Part 7D and final Part 14 acceptance own
the isolated sandbox/demo journey.

## Acceptance evidence and boundaries

Acceptance requires strict policy/digest and response-shape tests plus a mounted
fresh PostgreSQL 17 route campaign proving owner/admin access, unauthenticated and
member denial, current subscription enforcement, query rejection, deterministic
restart, no database residue and zero provider transport. The implementation uses
migrations through 272 and adds no migration 273. There is no rendered surface, so
browser and visual evidence are not applicable to Part 7A.

Part 7B connection and credential lifecycle, Part 7C payment initiation and Part 7D
sandbox/rollback acceptance remain unstarted. Provider sandbox, real provider
account/KYC, fees, legal/provider/security opinions, private production, live money,
settlement, payout, reconciliation, hosted CI, production load, physical
Safari/devices, manual assistive-technology review, disaster restore and founder
visual approval remain unavailable.
