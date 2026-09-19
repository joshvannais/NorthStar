# Mission 25 Part 12D external financial evidence operations

This authority accepts reviewed, provider-neutral invoice, payment, collection and accounting-entry evidence. It stages evidence for later reviewed reconciliation. It does not create or change NorthStar invoices, payments, collections, accounting records or operating records.

## Import rules

- An owner or administrator grants permission for one source before an import.
- Historical backfill and continuing updates keep separate cursors.
- A page contains one to 100 records and pins the current permission revision and digest.
- Every external identity and relationship reference must be a source-scoped, non-reversible `ref_` token. Every cursor must be a `cur_` token.
- Each record keeps its exact external version, event time, source update time, known IANA time zone, evidence class and evidence digest.
- Invoice, payment, collection and accounting evidence stay separate. One type never proves another.
- Amount evidence is either unavailable or an exact nonnegative decimal string, exact currency and allowed basis. No balance, tax, exchange rate, revenue, cost, profit or margin is calculated.
- A correction requires a higher external version. A removal retains only the token, version, removal state and update time.

## Permission and recovery

Revoking permission immediately hides that period and blocks new imports. Granting permission again creates a new empty cursor and record lineage. Earlier records never return automatically. The same provider version appears in the new period only after a new explicit import.

Refresh after a changed-permission, cursor or record response. A same-key retry with identical details returns the saved result. A same-key retry with different details is rejected.

## Access and boundaries

The runtime role can call four guarded entry functions and cannot read or write protected tables or helper functions. The source holds no provider credentials, provider account identity, customer contact details, bank or card details, memo, description, line items or message content.

All records remain unmatched until Part 12E. Native NorthStar billing and accounting records remain unavailable until Mission 27. This authority cannot edit customers, leads, jobs, appointments, estimates, schedules, dispatch, invoices, payments, collections, accounting records, provider records or company policy.
