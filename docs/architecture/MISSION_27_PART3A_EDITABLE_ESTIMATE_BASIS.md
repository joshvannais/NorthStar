# Mission 27 Part 3A — current Mission 24 editable-estimate basis

Status: implementation candidate. This record defines only original Part 3A and its additive Q4 gate. It does not accept the candidate, open Part 3B, authorize editing, or claim a phone/photo extraction runtime.

## Mounted private read

`GET /api/v1/customer-financial/editable-estimates/:estimateId/basis` reads one exact current Mission 24 commercial version for a paid tenant. The database resolves the tenant, current owner or administrator session, current subscription, exact `customer_financial.estimate.edit_draft` capability revision, business purpose `customer_financial.editable_estimate_basis`, frozen `mission27.launch.v1` policy, and target estimate. The browser supplies none of those authority values. No grant, an inactive or superseded grant, expired entitlement, tenant mismatch, role mismatch, absent source, ambiguous source, or stale lineage fails closed.

The read requires one current owner-reviewed Mission 26 booking review and its exact Mission 24 estimate, opportunity, customer, approved decision, commercial terms, commercial approval, issued customer estimate version, acceptance, and current Mission 22 schedule assignment. It reuses the accepted commercial-review currentness boundary and rejects a later decision, terms record, approval, issued version, revoked acceptance, or changed schedule. A failed currentness check returns a named value-free state and exposes no old amount or document.

The read uses the released commercial writer lock order, pins entitlement and the exact selected source rows through commit, and serializes all estimate-scoped capability grant identities through one logical grant fence. A concurrent commercial or scheduling change therefore either completes first and makes the read unavailable, or waits for the coherent read to commit; a concurrent distinct grant cannot create an unobserved ambiguity.

## Shared editable-record projection

The server projects contract `m27-polaris-editable-estimate-v1` from the source-owned records. It carries stable estimate/customer/opportunity identities, the exact issued revision and digests, one accepted option, ordered stable line identities, exact currency and decimal/minor-unit money, customer acceptance evidence, Mission 24 authority pins, booking pins, and source provenance. Quantity, unit, and unit price remain explicit missing evidence when the accepted source does not contain them. Exact zero is distinct from unavailable.

The projection is a read basis for later editing. Part 3C still owns human edits, options, signatures, and reviewed accepted-estimate-to-work handoff. Part 3D still owns immutable original-versus-human revision history, replay/concurrency acceptance, minimized Mission 25 observations, and the complete adapter lifecycle. The Part 3A read creates no estimate revision, option, proposal, signature, appointment, assignment, reservation, dispatch, execution, invoice, payment, learning observation, provider request, or receiver mutation.

## Source and adapter boundaries

The frozen launch contract names `retell.inbound.completed.v1`, `northstar.quoted_job_photo.v1`, and `openai.responses.structured.v1`, but their current runtime availability is false. Part 3A therefore emits explicit value-free phone, photo, and extraction slots and makes zero provider calls. It does not infer facts from a transcript, image, estimate status, price, caller claim, or demo record.

The projection exposes adapter seam `polaris.estimate_studio.adapter.v1`, compatible version 1, over the same canonical estimate and revision identities. The seam remains unavailable until Mission 32. It cannot create a parallel estimate, duplicate accepted mathematics, approve commerce, or schedule work. Mission 24 remains estimate, price, proposal, option, signature and acceptance authority; Mission 22 scheduling and dispatch; Mission 23 execution and work evidence; Mission 25 tenant-private learning.

## Storage, runtime privileges, and evidence

Migration 264 appends immutable capability-grant history and an exact revision head. Runtime has no direct access to those tables or helper functions and can execute only the guarded read entry. The source commercial, schedule, estimate, customer and opportunity rows remain owned by their existing migrations. Part 3A stores no copied commercial record and performs no browser arithmetic.

Candidate evidence covers the projection and exact-money contract, named unavailable states, frozen-policy ratification, fresh disposable PostgreSQL 17 through migration 264, the real mounted Mission 24 issue/accept/schedule/review chain, capability and entitlement currentness, deterministic reread, role and tenant isolation, distinct-grant and approved-reschedule interleavings, source staling, restart-safe source reads, and runtime privilege withholding. Independent whole-head audit, PR, deployment and production health remain later gates.

Phone/photo/extraction providers, private production, natural customer history, live money, Mission 32 execution, hosted CI, physical Safari/devices, disaster restore, professional legal/tax/accounting/security opinions, and founder visual approval remain unavailable. Live-money validation remains deferred until the first real paying customer.
