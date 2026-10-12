# Mission 27 Part 3D — immutable handoff and revision history

Status: implementation candidate. This record closes original Part 3 and additive Q7 only. It does not begin Part 4, create an invoice, contact a customer, mutate work, publish learning, execute Mission 32 calculations, call a provider, or establish live-money evidence.

## Billable-source handoff receipt

A completed Part 3C single-control or dual-control review now produces one tenant-private `m27-billable-handoff-receipt-v1`. The database constructs it from the immutable accepted reviews and their actor, session, capability revision, purpose, policy, confirmation, source, exact-money and decision bindings. Callers cannot supply receipt fields. It names only the later `mission27.part4.invoice_draft_source.v1` contract and keeps `invoiceAuthorized`, `financialActionAuthorized`, provider calls and receiver mutations false.

The receipt is append-only and unique for one tenant, estimate and decision digest. Exact replay returns the same receipt identity and digest. The read boundary still reconstructs the current Mission 24 and Mission 23 sources before exposing it. A commercial correction, reopened work, changed completion evidence, revoked prepared handoff, entitlement loss or authorization change returns the existing named value-free source/currentness state and exposes no historical amount, source, approval or receipt value. Historical receipts remain immutable evidence; they do not remain current authority.

## Source original and human revisions

Migration 267 adds one source-original revision zero and one append-only row for every accepted human draft revision. The source original pins the exact source-owned Mission 24 estimate version, document digest, revision digest and accepted-delivery evidence. A later revocation is retained as historical evidence and never reclassified as current authority; this makes upgrades safe for valid stale Part 3C drafts while current reads remain value-free. Each human revision pins the same estimate, stable option and line identities, exact USD minor units, source and proposal digests, actor, reason, trusted time, option-lineage digest, unavailable signature evidence and the compatible Mission 32 adapter identity. The mutable current projection remains a convenience over these immutable rows and does not replace them.

The current route returns history only when revision zero matches the exact-current Mission 24 proposal, every integer human revision is present through the current draft revision, and the final immutable draft digest matches the current projection. A gap, cross-source substitution, source correction, conflicting replay or concurrent overwrite clears the draft, history, prices, grants and adapter controls behind a named value-free state. Existing optimistic revision and idempotency fences guarantee one winner; the append-only trigger runs in the same transaction as that winner.

Every authenticated history read validates a limit from 1 through 20 and an optional exclusive revision cursor. The database returns deterministic newest-first metadata only, plus the total count, next cursor and one digest chain that binds every immutable row; full snapshots remain private and are never aggregated into an unbounded response. The paid browser renders at most 20 human revisions plus the source summary and offers keyboard-operable earlier/latest controls without growing the DOM. It keeps full edit controls keyboard operable on the existing responsive light/dark surfaces. The account-free demo does not mount this paid journey, and no paid or demo state crosses the boundary.

## Mission 25 and Mission 32 boundaries

The frozen Mission 25 adapter `mission25.tenant_edit_observation.v1` is not currently available. Part 3D therefore returns `learning_permission_unavailable`, publishes no value, performs zero learning writes and does not automatically apply an edit or outcome. Raw photos, transcripts, signature artifacts, customer contacts, payment data and other-tenant data remain excluded.

The frozen `polaris.estimate_studio.adapter.v1` seam is a read-only compatibility manifest over the same estimate, revision, option, line and assumption identities and the immutable history digest. It permits no parallel estimate, duplicated accepted math, commercial approval, receiver execution or mutation. Mission 32 remains the later owner of deep field-calculation behavior.

## Storage, privileges and evidence boundaries

Both migration 267 tables enable and force row-level security with the database-owned owner-only policy. Runtime has no direct table access and cannot execute the receipt, history or trigger helpers. Its only entries remain the existing guarded Part 3C read and effect functions. Updates, deletes and truncation fail closed.

Candidate evidence covers focused contract and sealed regressions; a fresh disposable PostgreSQL 17 install through migration 267; mounted exact single/dual review, receipt replay and source invalidation; source-original and owner/member revision history; currentness, optimistic conflict, tenant privacy, direct-table denial and immutability; and Chrome plus Playwright WebKit across the frozen five layouts. Independent audit, PR, merge, deployment and production health remain later gates.

External signature legal review, the Mission 23 receiving adapter, the Mission 25 receiving adapter and purpose permission, Mission 32 execution, live compatible capacity/providers/private production, natural history, accuracy or calibration, real accounting/receiver behavior, hosted CI, production load/SLA, physical Safari/devices, manual assistive-technology review, disaster restore, professional opinions and founder visual approval remain unavailable. Live-money validation remains deferred until the first real paying customer.
