# Mission 27 Part 12A — source-backed invoice and receivable reporting

Status: original Part 12A implementation candidate. This slice starts from released Part 11D and complete Part 11 at accepted head `6bc7d5d1a1a1f19798069222e8ba08db2f5fa0f9`, tree `878f997bb4c6b8991f90d09618cc9735c02471c0`, PR #525 and exact deployed main `4178102e64ae902ad462597c7a3f49a522609639`. It adds one tenant-private, owner/administrator, no-store `GET /api/v1/customer-financial/reporting/invoice-receivables` read. It creates no report row, invoice, receivable, payment, accounting record, downstream observation or external effect.

## Exact source and fact contract

The read consumes and revalidates the released Part 10A `m27-receivable-aging-v1` source before and after projection. Part 11 accounting contracts do not become invoice or receivable truth merely because they are later in the release order. The source witness carries the exact source contract, typed state and reason, digest, request-context currentness and receivable-projection currentness. A changed or malformed source fails closed.

Part 12A preserves five ordered facts separately:

1. issued amount;
2. outstanding amount;
3. aging;
4. disputed amount; and
5. invoice lifecycle counts.

Every fact has its own coverage indicator. Coverage pins the exact source contract and digest, source population and state, source as-of value, source record count, emitted record count and completeness rules. Missing records or values never become zero, and partial population cannot be presented as complete. The current immutable issued-receivable population is unavailable, so every fact remains `unavailable`, every value and currency remains null, all five coverage indicators remain `incomplete`, the source total remains null and the emitted report-row count remains zero. Zero emitted rows does not claim zero invoices, receivables, disputes or financial activity.

## Money, aging and lifecycle meanings

Issued, outstanding and disputed amounts remain separate exact USD minor-unit facts. A dispute does not rewrite an issued or outstanding amount. Every sum or comparison requires one complete population and one matching currency. Browser arithmetic, a legacy KPI, a draft, an accounting acknowledgement or a missing value cannot supply a reporting fact.

Aging preserves the released Part 10A buckets and requires an exact issued due date plus trusted server clock. A missing balance or due date enters no bucket, and an overdue state authorizes no reminder, fee, collection action or charge.

Invoice lifecycle counts preserve the released Part 5C orthogonal axes: document revision, delivery, payment balance, due/aging, dispute/refund, settlement and accounting handoff. One display status cannot replace those axes. Every count requires complete issued-invoice population coverage; current counts remain null.

## Access, privacy and effects

Only a current paid owner or administrator with a current tenant session and subscription may read the projection. The route accepts no query or body fields. HEAD, OPTIONS and every other non-GET method fail closed before source access. CORS advertises only GET. There is no demo, customer or public route; Part 12D owns rendered paid/demo reporting acceptance.

The response exposes no tenant, customer, invoice, receivable, amount, due date, dispute, recipient, actor, provider, accounting or credential identity. It creates no provider call or mutation, receiver mutation, accounting mutation, downstream-reader mutation or money movement. Part 12B owns payment and cash facts. Part 12C owns minimized Mission 25/26/33 readers. Part 12D owns reporting surfaces, drilldowns, paid/demo parity, legacy-zero fallback removal and whole-Part-12 acceptance.

Focused unit/static evidence uses a table-driven adversarial matrix over every semantic leaf plus missing, widened, duplicated, reordered and renamed source/fact shapes. Fresh disposable local PostgreSQL 17 evidence must cover owner/admin reads, session/role/query/method/CORS/tenant/subscription denial, restart, exact source revalidation, migration 272 remaining latest with no 273, zero protected residue and zero external transport. Browser evidence is not applicable because Part 12A creates no rendered or demo surface.
