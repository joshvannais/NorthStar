# Mission 27 Part 6A — customer-safe immutable invoice document

## Frozen scope

Part 6A owns the customer-safe immutable invoice document and accessible HTML/PDF
rendering boundary. A document may exist only for one exact issued invoice version.
Private source, cost, margin, staff, digest, and provider fields never enter the
customer projection. Part 6A does not issue an invoice, create a public token,
authorize a download, open a customer portal, send a message, mutate a receiver, or
perform a provider or money action. Parts 6B–6D own those later boundaries.

Released Part 5 is intentionally value-free. No final approval, issue receipt,
issued invoice version, or receivable exists because recent-auth/MFA, due-term,
delivery, exact amount-due, and professional-tax authority remain unavailable.
Part 6A therefore cannot truthfully render HTML or PDF bytes. Missing authority is
not treated as a zero-value invoice and a draft preview is not relabeled as an
issued customer document.

## Exact-current minimized projection

The paid read enters through the released `m27-invoice-part5-preview-bundle-v1`
repository. That database-owned chain revalidates the exact current tenant, actor,
subscription, commercial source, handoff, invoice draft, tax preparation, and every
Part 5 boundary. Part 6A strictly validates the bundle, then discards the entire
private preview and its revision/digest witness before returning
`m27-customer-invoice-document-v1`.

The returned contract is value-free and names the three absent requirements:

1. immutable invoice issue receipt;
2. exact issued document revision; and
3. customer-safe document projection.

HTML and PDF are each explicitly unavailable with null values. Rendering, download,
public access, and delivery authorization are false. The response contains no
customer, work, amount, currency, document number, due date, source, cost, margin,
staff, digest, receipt, or provider value. It is deterministic, `no-store`,
owner/admin-only, tenant-private, and performs zero provider or receiver effects.

The account-free demo rebuilds and strictly validates the released fictional Part 5
bundle from one immutable demo-workspace revision, discards it, and returns the same
value-free contract with `mode=demo` and `fictional=true`. It never queries paid
tenant data or falls back to a paid/provider path.

## Acceptance evidence

Part 6A acceptance requires strict contract/repository/route tests and mounted fresh
PostgreSQL 17 evidence through migration 272 for paid owner/admin access, role and
cross-tenant denial, exact-current Part 5 revalidation, deterministic replay,
privacy minimization, demo isolation, no mutation route, and zero database residue.
No migration 273 is required.

There is no positive rendered surface while the issued-document prerequisite is
unavailable, so Part 6A creates no browser or visual claim. Parts 6B–6D remain
unstarted. Private production, legal/accounting/tax opinions, external providers and
receivers, live money, hosted CI, physical Safari/devices, disaster restore, and
founder visual approval remain unavailable unless independently evidenced.
