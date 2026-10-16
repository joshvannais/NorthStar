# Mission 27 Part 11A — provider-neutral accounting export contract

Status: released original Part 11A at accepted head `976a06188b174b1ce2c1f3130637a0ccfb76b627`, tree `8b65129ba0a6af0a24e9aa5aaec7449eaf60b9ee`, PR #522, exact deployed main `1b567594c340b393c4313ac9ca667c23d68bb835` and sole deployment `8830cfa8-d549-42b8-b139-d91b5845a9da` SUCCESS. This slice adds one owner/administrator, tenant-private, read-only `GET /api/v1/customer-financial/editable-estimates/:estimateId/accounting-export-contract` boundary. It does not select an accounting destination, map an account, preview or transmit a batch, record an acknowledgement, reconcile an external record, create a journal or tax fact, or expose a demo, customer or public route. Part 11B is released; Part 11C is the current implementation candidate and Part 11D owns acceptance.

## Exact source and record contract

The route requires the exact current paid Part 10 bundle, including the released Part 9 financial lifecycle and current Part 10 receivable and collection witnesses, and revalidates it around projection. The provider-neutral record version is `m27-accounting-export-record-v1`. Every eventual record must carry one exact fact type and state, source authority and source-contract version, source record identity, immutable revision and digest, source occurrence and recording timestamps, one ISO currency, exact integer minor units, and the same complete source lineage. Missing amounts, currency, timestamps, revision, digest or authority never become zero, current time or arrival order.

The ordered export fact classes are issued invoices, payments, offline cash, offline checks, credits, refunds, write-offs, disputes, provider fees and settlements. Provider payment states reuse the released provider-normalization vocabulary. Offline checks preserve the exact `offline_received`, `check_clearance_unknown`, `check_cleared`, `check_returned`, and `offline_reversed` vocabulary. Cash receipt approval never implies provider settlement; an accounting acknowledgement never supplies bank clearance; missing check-clearance authority remains exactly `check_clearance_authority_unavailable`.

No accepted source fact currently exists. Every class is therefore `unavailable`, every fact value, identity, amount, currency, timestamp and lineage is null, and the export-record count is zero. Zero emitted records does not claim zero financial activity.

## Authority and accounting boundary

The frozen launch policy names `quickbooks_online.accounting_export.v1` in sandbox mode, but its runtime and current receiving-adapter authority are unavailable. Role alone never authorizes export. The `customer_financial.accounting.export` capability uses conditional dual control and exact current record-count and absolute-minor-unit bounds; missing counts, amounts, adapter evidence or required control denies the action. Part 11A creates no action route or capability grant.

NorthStar may later hand off accepted customer-financial facts. It cannot invent a chart of accounts, destination mapping, journal classification, recognition policy, tax filing, books-close event, provider evidence or check clearance. Accounting acknowledgement cannot rewrite a NorthStar source fact or act as a human approval.

## Access, privacy and effects

Only a current paid owner or administrator with a current tenant session and subscription may read the value-free contract. The request accepts exactly the current handoff receipt identity and digest. Cross-tenant, missing-session, member/viewer, widened-query and non-GET requests fail closed before projection. The response is private and no-store and exposes no tenant, customer, invoice, payment, provider, accounting-account, credential or source amount identity.

The read creates no export batch, preview, transmission, acknowledgement, reconciliation, accounting mutation, provider call, receiver mutation or money movement. Part 11B owns destination selection, mapping, preview, idempotent transmission, acknowledgement and partial failure. Part 11C owns bidirectional reconciliation. Part 11D owns tax/accounting review, holds, adapter lifecycle, paid/demo UI and whole-Part-11 acceptance.

Focused unit/static and fresh disposable local PostgreSQL 17 evidence cover the exact ordered contract, record shape, lifecycle and offline semantics, strict malformed/contradictory/leaked rejection, before-and-after source revalidation, owner/admin access, tenant/subscription/query/method denial, restart, zero protected residue, migration 272 remaining latest with no 273, and zero external transport. Browser evidence is not applicable because Part 11A adds no rendered or demo surface.
