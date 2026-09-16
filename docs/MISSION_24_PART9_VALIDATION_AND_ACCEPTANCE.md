# Mission 24 Part 9 — Validation and acceptance

Status: release candidate. Mission 24 is complete only after a different reviewer approves the frozen commit, the approved head merges normally, the automatic deployment succeeds, and production health is observed.

## Accepted trace

The Part 9 trace follows one estimate through the shared paid and isolated-demo engines:

1. recorded scope and source pins;
2. material, labor, equipment, travel and composed direct costs;
3. human pricing and policy choices;
4. commercial terms, tax treatment and approval;
5. private Polaris and Capella arithmetic;
6. customer-safe draft preview and downloads;
7. immutable issue history;
8. expiring customer delivery links;
9. customer acceptance or question handoff;
10. owner-visible status, revocation and expiration.

Arithmetic and evidence credibility remain separate. The trace proves deterministic calculations and exact paid/demo parity. It does not turn an inferred, stale or missing input into verified evidence, and it does not expose internal cost, margin, provenance or risk details in the customer document.

Drafts remain viewable and downloadable before final approval. The primary Estimate action opens that draft. A separate review action opens the editable estimate controls. Issuance still requires an explicit owner confirmation and pins the exact approved version.

## Capacity correction found by validation

The complete demo trace now occupies about 1.2 MiB because the isolated session retains the full estimate and delivery history. The historical 512 KiB database constraint rejected an otherwise valid workflow as a generic service failure.

Migration `082_demo_estimate_state_capacity.sql` raises the bounded session ceiling to 2 MiB. The repository measures every proposed state mutation using PostgreSQL's JSONB text representation before writing it. A state above the limit returns the existing clear demo-capacity response, while the database constraint independently rejects an oversized direct write and preserves the last valid snapshot.

The migration uses local five-second lock and twenty-second statement caps, an explicit table lock, and a validated check constraint. It changes no paid-tenant estimate authority and does not remove the finite-demo boundary.

## Evidence

- Full paid/demo estimate, delivery, expiry and capacity trace: 11 cases passed on disposable PostgreSQL 17.
- Focused customer delivery API: 7 cases passed.
- Chromium presentation and delivery journey: 7 cases passed.
- Playwright WebKit presentation and delivery journey: 7 cases passed.
- Customer-estimate and canonical-entry unit suites: 18 tests passed.
- Estimate review wording checks: 2 tests passed.
- Fresh schema startup applied migrations 001 through 082 exactly once.
- Oversized state produced PostgreSQL check violation `23514`; transaction rollback retained the prior state and revision.

## Evidence boundaries

- Physical Safari, physical mobile devices and manual assistive-technology review were unavailable.
- Private authenticated production data and production database inspection were unavailable.
- Live supplier, tax, mapping, communications, payment and delivery providers were not called.
- Hosted CI availability is a separate repository-provider result.
- Founder visual approval remains a separate verdict.

## Mission transition

This is the final original Mission 24 phase. If the frozen candidate receives independent exact-head approval and the released production checks pass, Mission 24 may close and Mission 25 may begin. Mission 25 owns tenant-private learning from authorized estimates, approvals, actual work and outcomes. It must preserve provenance, tenant isolation, source permission, reversibility and explicit aggregate-learning authority.
