# Mission 27 Part 12C — minimized downstream reporting readers

Status: implementation candidate. Parts 12A and 12B are released. This slice
adds one tenant-private, read-only, value-free boundary for the exact future
Mission 25, Mission 26 and Mission 33 readers. It publishes no observation,
forecast or platform metric and changes no operational or financial authority.

## Exact sources and currentness

`m27-downstream-reporting-readers-v1` consumes the exact released
`m27-invoice-receivable-reporting-v1` and
`m27-payment-cash-reporting-v1` projections. It validates both complete source
contracts, binds their exact digests and typed incomplete states, and reads the
pair again after projection. A malformed, substituted or changed source fails
closed. Missing or incomplete coverage never becomes zero, and zero emitted
records never proves zero financial activity.

Every future reader requires same-tenant provenance, exact source digests,
source currentness, complete coverage and a current purpose permission. Source
correction, revocation, tombstone or permission change invalidates the prior
projection. Corrections remain append-only evidence and never rewrite a prior
accepted fact.

## Three minimized readers

The ordered Mission 25 reader names the frozen
`mission25.tenant_edit_observation.v1` destination. It may later receive only
same-tenant provenance, accepted human edit deltas, accepted option identity,
Mission 24 acceptance outcome, Mission 23 work outcome, actual cost and actual
duration under current purpose permission. Raw photos or transcripts,
signatures, contacts, payment instruments, unreviewed drafts, other-tenant
content, cross-tenant training and automatic price or policy application are
prohibited. The receiving adapter and permission are unavailable, so the
reader emits no observation.

The ordered Mission 26 reader requires source-complete historical invoice,
receivable, payment and cash evidence plus accepted calibration before a
collection forecast can exist. It cannot infer earned revenue, convert missing
evidence to zero, present a forecast as fact or initiate a collection,
schedule or invoice action. Current source populations and calibration are
unavailable, so it emits no forecast.

The ordered Mission 33 reader permits only platform-level facts under separate
platform purpose and role authority, a canonical metric registry,
cross-company privacy controls and exact source reconciliation. A tenant owner
or administrator does not become a platform administrator. Raw tenant content,
tenant-detail inspection, cross-company disclosure and forecasts or
allocations presented as actual history are prohibited. Platform authority is
unavailable, so it emits no platform fact.

## Access, privacy and effects

Paid owners and administrators may read
`GET /api/v1/customer-financial/reporting/downstream-readers` with a current
tenant session and subscription. The private no-store route accepts no query
or body. A bounded case-insensitive path policy mirrors the exact Express mount,
optional trailing slash and one-or-two slash mount boundary. Body-bearing GETs
and every unsupported method are rejected with fixed nonreflective responses
before JSON parsing, authentication, throttling, source or repository access.
CORS advertises GET only. No customer, public or demo route exists; Part 12D
owns rendered whole-Part-12 acceptance.

The response exposes no tenant, customer, worker, invoice, payment, receipt,
accounting, amount, edit, outcome, capacity, risk, credential, permission or
platform-administrator identity. It performs no learning write, forecast,
platform fact publication, provider call, receiver mutation, accounting
mutation, financial mutation or money movement. It cannot change a price,
option, estimate, schedule, assignment, invoice, payment, collection or policy.

Focused evidence front-loads exact semantic and structural source/output
mutation matrices, including digests, currentness, corrections, permissions,
coverage, privacy and every prohibited effect, followed by the complete
protected path, method, query, body, framing and CORS composition. Fresh
disposable local PostgreSQL 17 evidence covers owner/admin reads, session,
role, tenant and subscription denial, before/after source revalidation,
restart, migration 272 remaining latest with no 273, zero durable residue and
zero external transport. Browser evidence is not applicable because Part 12C
adds no rendered, customer, public or demo surface.

Accepted source populations, Mission 25 receiving permission and adapter,
Mission 26 source-complete history and calibration, Mission 33 platform
authority and metric registry, private production, hosted CI/load, physical
devices, professional review and first-paying-customer live-money validation
remain unavailable. Founder visual approval remains a separate later verdict.
