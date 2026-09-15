# Mission 24 Part 8 Slice 3 — Customer Estimate Delivery

## Result

Owners and administrators can issue an immutable customer estimate, create an expiring customer link, view its status, revoke it, and see customer acceptance or questions in NorthStar. The same workflow is available in the isolated demo with a 24-hour maximum link lifetime.

The customer page shows the exact issued document. It supports an explicit acceptance and a question form. PDF and image downloads contain only the estimate document; they omit the interactive controls.

## Customer-card hierarchy

The estimate action is the first full-width action on mobile:

- **Finish Estimate** opens the remaining owner review when the estimate is incomplete.
- **View Customer Estimate** opens the customer-facing preview when it is ready or the exact immutable version after issuance.
- **Issue Estimate** saves the reviewed version.
- **Share Customer Estimate** creates an expiring link after issuance.

Scope Details, Estimate Details, Schedule & Work, and Activity are closed initially and behave as a one-section-at-a-time accordion. Saved estimate history, plan sources, and customer questions remain available as secondary disclosures.

## Authority and evidence boundaries

- Paid links require an authenticated owner or administrator and bind to an immutable issued estimate version.
- Demo links require the active isolated demo session and bind to the exact issued demo document.
- Only a SHA-256 hash of the public bearer token is stored.
- Customer acceptance, questions, and owner revocation are append-only evidence events.
- Acceptance records the customer's name and explicit confirmation. It does not collect payment or schedule work.
- A question is stored for the owner in NorthStar. Sending it through an external email or text provider remains separate provider work.
- Public reads and writes stop after expiration or revocation.
- Network address and user-agent values are stored only as hashes.

## Verification

The slice includes PostgreSQL tests for tenant isolation, immutable evidence, exact-document reads, idempotent acceptance and questions, revocation, paid/demo parity, and denial of direct runtime table access. Chrome and Playwright WebKit browser journeys cover mobile and desktop layouts, issuance, sharing, acceptance, questions, PDF/image downloads, overflow, focus recovery, and transient export retry.
