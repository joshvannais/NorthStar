# Mission 25 Part 12D candidate acceptance

Base: `8a238ba1f0f95fbcee44ae9cedcaabe6d8edbe2a`

## Implemented scope

- Separate source permission and immutable historical or continuing import runs.
- Provider-neutral invoice, payment, collection and accounting-entry evidence.
- Exact source-scoped opaque references, bounded records, known time zones, exact amounts and currencies, higher-version corrections and detail-free tombstones.
- Current-period masking, non-revival after regrant, deterministic replay, tenant isolation and owner or administrator access.
- Guarded runtime entry functions with protected tables and helpers withheld.
- Explicit unmatched state and native Mission 27 financial-record boundary.

## Required executable evidence

- Fresh PostgreSQL 17 migration chain through migration 116.
- Mounted API journey for all four evidence classes, 100-record page, concurrency replay, tenant and role separation, correction, conflict, removal, revoke and regrant.
- Node, guarded PostgreSQL and direct-table adversaries for raw identifiers, unknown time zones, cross-type relationships, negative or ambiguous amounts, unsupported bases and extra content.
- Runtime denial for protected tables and time-zone storage, helper denial, guarded entry availability, immutability and migration checksum verification.
- Focused contract and ratification tests plus mounted Part 12A-C compatibility.
- Diff proof that no rendered path changed; plain-language review of API responses and operating documentation.

## Corrected candidate evidence — 2026-09-17

- Fresh disposable PostgreSQL 17 applied migrations 001-116 and passed the corrected mounted Slice D journey. The 100-record, two-time-zone request completed in 95 ms under the unchanged five-second statement timeout.
- Mounted Part 12A, 12B and 12C compatibility journeys each passed against the migration chain through 116.
- Eight focused unit and ratification suites passed 88 tests. Node syntax checks and `git diff --check` passed.
- The migration-owner adversaries proved that each required active field rejects SQL `NULL`; scalar, array, missing-key, extra-key and wrong-type amount claims fail closed; invalid record types, record states, evidence classes and digests fail closed; and exact valid active and detail-free tombstone controls remain accepted.
- The mounted adversaries also verified owner and administrator access, member and viewer denial, tenant isolation, deterministic concurrent replay, strict reference and amount validation, stale and conflicting record behavior, correction, detail-free removal, permission revocation, no revival after regrant, runtime ACL denial, immutable history and exact migration checksum.
- Core customer, opportunity, appointment, estimate and field-execution counts were identical before and after the financial import journey.
- The candidate changes no `public/` file and adds no rendered route. API messages and operating guidance were reviewed for plain business language.

## Unavailable evidence

No provider connection, credentials, provider account, private business evidence, production database, deployment, native Mission 27 financial record, physical-device review, manual assistive-technology review or founder visual verdict is available in this candidate. The slice does not claim any of those results.
