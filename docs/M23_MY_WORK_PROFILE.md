# Mission 23 Part 9 — My Work Profile (M23-01)

## Authority

Employee claims extend the existing tenant workforce_profiles identity; they
never change its operational role, account role, owner-assigned skills, crews,
scheduling or dispatch. Only a current active member can submit their own
professional profile or availability. Viewers can read their own profile.
Owner/admin accounts review other employees through Team; they cannot author
employee claims or approve their own profile. Every entry point reloads the
durable cookie session, tenant membership, CSRF and mutation eligibility.

Migration 055 adds canonical_work_profile_events, an append-only ledger with
independent profile/availability revisions, retained predecessor identity,
actor/session provenance, request digest, idempotency key and timestamps.
The application runtime cannot read or write this table directly. Guarded
functions own reads/mutations; helpers and table permissions are withheld and
verified by the migration runner. Old migrations remain unchanged.

## Lifecycle

- Submit: creates a pending version, replacing the current review status,
  without deleting earlier versions.
- Approve: owner/admin attests to the exact pending version and optionally
  records which certification references were checked.
- Reject: requests changes with a durable reason. Employee resubmission creates
  a new pending version.
- Revoke: withdraws an approved version with a durable reason.
- Availability: a separate, self-authored update ending within seven days;
  expired updates are not current and never become scheduling authority.

Concurrent changes must match the current stream revision. Exact same-key
retries return the original event, including after availability expires, but
still require current session/role/tenant authority. A newer submission resets
certification verification. Expired or revoked evidence is not currently
verified. Dates are date-only certification expiries evaluated in UTC; an
expiration date remains valid through that date. No expiry date is displayed
as unspecified, not as evidence of perpetual validity.

## Documents and verification

Certification document references are bounded record identifiers only (letters,
digits, dot, underscore and hyphen). They are rendered as inert text. There is
no file upload, document fetch, external link, issuer API or external verification.
“Verified by your organization” identifies an explicit owner/admin decision
about an existing record reference, not a provider attestation, legal
qualification, license entitlement or job authorization.

## Surfaces

- /dashboard/my-work-profile: Today-shell employee self-service, durable role
  summary, capabilities, certification status, short-lived availability, and
  paginated history.
- /dashboard/work-profile-reviews: canonical dashboard shell, employee
  directory and explicit owner/admin review.
- /api/work-profiles/me, /reviews, /reviews/:profileId: no-store,
  cookie-authenticated, server-scoped reads and narrow mutations.

Client state is memory-only except the pre-existing theme preference. Conflict
and uncertain-result states preserve a draft or exact retry request. They never
claim a successful write before the server confirms it. Historical verification
choices and review feedback remain available. All profile text uses text DOM
nodes; no employee HTML is interpreted.

## Local verification

Use the repository's exact locked dependencies. Set the existing disposable
PostgreSQL harness identity variables (M19_PG_ADMIN_URL,
M19_EXPECTED_PG_DATA_DIR, M19_EXPECTED_PG_PORT, M19_TEST_RUN_ID) to a fresh,
verified loopback PostgreSQL 18.4 cluster, never production.

Run tests/unit/m23-my-work-profile.test.js and
tests/integration/m23-my-work-profile-postgres.test.js through Jest.
Run tests/browser/m23-my-work-profile.js --browser=chrome --output=<new-path>
and --browser=webkit; --hostile --profile=320 gives separately labeled
long-text/markup-looking fixtures. These mount production modules and use real
disposable PostgreSQL. Browser transport failures/conflicts are explicitly
intercepted local fixtures; no provider traffic is permitted.

Playwright WebKit is not physical Safari. Reflow viewports are not native OS
zoom. Founder personal visual approval, physical devices, manual assistive
technology, hosted CI, and private production evidence remain independent
gates, not inferred from these tests.
