# Mission 25 external labor import authority

## Purpose

This package gives future manual, CSV and provider adapters one tenant-private contract for normalized labor and time evidence. It supports bounded historical backfill and continuous updates without treating imported records as verified NorthStar work facts.

## Authority and lifecycle

- Only a current owner or administrator can grant or revoke consent for a named source.
- Every batch requires the active consent revision and digest, explicit confirmation, schema version, mode, cursor transition, idempotency key, reason and no more than 100 normalized records.
- Historical and continuous modes have independent cursor chains. Historical backfill has one explicit terminal page. A stale cursor cannot skip or replace a page.
- The external record identity and version are source authority. The normalized digest decides whether a repeated version is an exact duplicate or a conflict. Newer versions are immutable corrections.
- A source tombstone stores no worker, job, category or interval details in its current row. It masks those details from current reads while retaining governed history for later retention/deletion authority.
- Revocation blocks writes, including replay of an earlier batch, and hides runs and current records from runtime reads. The runtime role has no table or projection-helper access.

## Consumption boundary

Worker and job references remain opaque. No automatic entity match is attempted. Imported records do not write `canonical_labor_intervals`, change payroll, update an estimate, alter a schedule, or become employee-performance conclusions. A later reviewed reconciliation must bind exact external identities to current tenant records before an outcome comparison can use them.

## Wording and interface disposition

The package adds API routes and no HTML, CSS or browser renderer. Its error messages use business wording for invalid input, stale cursors, conflicting source versions, unavailable service and restricted access. It creates no rendered frontend state, so there is no desktop/mobile/theme claim. The future owner import and reconciliation experience still requires the standing rendered wording, focus, responsive-layout and visual-review gates.

## Release evidence

Focused evidence covers contract normalization; exact consent; owner/worker and tenant isolation; bounded cursor progression; replay; dedupe; correction; tombstone masking; conflict rejection without partial writes; revocation; restricted-runtime direct calls; table/helper privilege withholding; immutable history; and exact migration checksum recording on disposable PostgreSQL.
