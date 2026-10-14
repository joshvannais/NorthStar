# Mission 27 Part 5E — invoice lifecycle acceptance

## Frozen scope

Part 5E accepts the complete Part 5 boundary for concurrent issue, source correction,
reopening, cancellation, replay, role/tenant/ACL, restart, and rendered paid/demo
behavior. It does not add an approval, issue, delivery, reminder, fee, collection,
charge, correction, invoice, receivable, provider, receiver, or live-money action.

Released Parts 5A–5D are presently value-free by design:

- final approval is blocked by unavailable recent-auth/MFA, due-term, delivery, and
  reconciled amount-due authority;
- number assignment and issue are blocked by the missing immutable final approval;
- all seven lifecycle axes remain independently unavailable without an issued
  document and receipt;
- credit, debit, replacement, and void remain explicit append-only record classes
  with no authorized record and no mutation of an issued version.

Part 5E must render those exact facts. It must not bypass them to create an
apparently complete invoice.

## Server-owned composition

`m27-invoice-part5-acceptance-v1` contains the strict released 5A final-review,
5B issue-readiness, 5C lifecycle, and 5D correction contracts. The paid repository
enters through the Part 5D read, whose chain revalidates the exact Part 4 preview and
every prior Part 5 boundary against the current tenant, actor, subscription, source,
handoff receipt, draft, tax preparation, and database authority. The response is
minimized: it exposes no customer, work, amount, currency, invoice number, due date,
private digest, receipt identifier, or provider value.

The account-free demo rebuilds and validates its current fictional Part 4 preview
from the isolated demo workspace before returning the same Part 5 shape with
`mode=demo` and `fictional=true`. It never queries a paid tenant or provider.

Both reads are `no-store`, deterministic, effect-free, and reject malformed or
extra query input. There is no corresponding mutation route and no migration 273.

## Rendered behavior and stale clearing

The mounted invoice panel fetches Part 5 only after the guarded current Part 4
preview succeeds. It validates exact contract versions, all seven lifecycle axes,
all four correction classes, false action flags, and zero provider/receiver counts
before rendering. The panel shows one bounded, responsive summary and no action
button for an unavailable capability.

The existing per-mount and per-request generations cover the Part 5 read as part of
the same journey. Collapse clears every preview, price, action, and lifecycle value.
Reopen performs the whole guarded read chain. A failed or malformed Part 5 response
clears the preview and lifecycle together, focuses an alert, and permits a fresh
retry. A delayed response from an older load cannot replace newer mounted state.

## Acceptance evidence

Acceptance requires:

- strict contract/repository/route and zero-mutation unit evidence;
- fresh PostgreSQL 17 mounted paid and demo reads through migration 272, including
  deterministic replay, tenant/role/ACL denial, source correction/reopening,
  rollback/restart, and zero financial residue;
- genuine Chrome and Playwright WebKit runs against the actual `/dashboard` and
  `/demo` surfaces, real session/CSRF behavior, real mounted routes, and disposable
  PostgreSQL across the frozen five-layout matrix;
- keyboard, focus, responsive/light-dark, collapse/reopen, rejection/recovery,
  delayed-response, paid/demo isolation, and zero external-call evidence.

Live money remains deferred until the first paying customer. Private production,
provider timing, external receiver behavior, professional tax authority, immutable
invoice/PDF, hosted CI, physical Safari/devices, disaster restore, legal/accounting
opinions, and founder visual approval remain unavailable unless separately evidenced.
