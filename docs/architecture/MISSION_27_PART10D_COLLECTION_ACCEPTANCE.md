# Mission 27 Part 10D — collection acceptance

## Frozen authority

Original Part 10D owns failure, retry and revocation semantics; tenant, role
and privacy enforcement; paid/demo rendering; accessibility and responsive
review; and independent whole-Part-10 acceptance. It does not create a
receivable, review row, promise to pay, reminder, resend, customer link,
provider session, delivery receipt, fee, escalation, accounting entry or
money movement.

The released Part 1D launch policy and released Parts 10A–10C remain
controlling. A retry must revalidate the exact current sources and requires a
human-reviewed request. Missing cooldown, receiver or delivery evidence
denies the path. An old provider session or request receipt cannot be reused,
and an automatic reminder, retry or charge is unsupported. Revocation of an
issued document, scoped customer session, reviewed recipient, delivery
authority, provider checkout session, collection capability, Mission 28
receiver or idempotency receipt clears rendered private collection state and
cannot be bypassed by role or retry.

## Atomic value-free bundle

`GET /api/v1/customer-financial/editable-estimates/:estimateId/collection-part10-acceptance`
is a private no-store paid owner/administrator read with one exact handoff
receipt identity and digest. The repository revalidates the complete released
Part 9 bundle before and after reading Parts 10A–10C. Each source is strictly
validated against its preceding source witness before one
`m27-collection-part10-preview-bundle-v1` response is returned. A changed,
missing or contradictory source fails closed rather than mixing revisions.

The Part 10 acceptance contract is
`m27-collection-part10-acceptance-v1`. It exposes three exact value-free source
witnesses, seven ordered failure states, eight ordered revocation axes, and
strict access, privacy and acceptance boundaries. Every receivable, review,
promise, handoff, resend, outbound-message and external-effect count remains
zero. Role alone never grants collection action, staff access cannot
substitute for a scoped customer session, and paid/demo or tenant crossing is
forbidden.

`GET /api/demo/customer-financial/invoice-drafts/:estimateId/part10-acceptance`
returns the same semantic contract over the isolated fictional demo graph. It
never calls a paid route or adopts paid state. No POST, public or customer
route, database table or migration is added.

## Rendered acceptance and clearing

The mounted invoice preview consumes only the atomic Part 10 bundle. Before
rendering, the client validates the complete exact ordered server-owned
contract, including policy identity, Part 9 witness, all source digests,
failure and retry rules, revocation axes, access and privacy semantics,
acceptance flags and zero-effect counts. Missing, reordered, renamed,
malformed, contradictory, leaked or widened data is rejected.

The paid and demo surfaces render the three source boundaries, failure and
human-review retry rules, revocation axes, privacy and zero-effect truth
without exposing private financial values or consequential controls. Source
mismatch, request rejection, collapse, stale mount generation, demo reset and
delayed response clear preview values, private prices, action context and
Parts 5, 6, 7, 9 and 10 state and DOM before recovery. Paid data never falls
back to demo.

## Acceptance evidence and unavailable gates

Local candidate evidence includes focused policy, source-lineage, contract,
repository, route, client and static checks; a fresh disposable PostgreSQL 17
journey through migration 272 with no 273; and genuine mounted paid/demo
Chrome and Playwright WebKit campaigns across five layouts. The browser
campaigns use real session, CSRF, routes and database state with zero mocked
responses, request interception, response interception, paid calls from demo,
provider calls, receiver mutations or money movement. They cover exact
contract rejection and recovery, keyboard, responsive light/dark layouts,
currentness, collapse/reopen, demo reset and database-delayed stale-response
suppression.

Independent whole-head audit and release remain pending. Complete immutable
receivable population, exact issued balances and due dates, reviewed customer
contactability and recipient, accepted collection capability and assurance,
Mission 28 receiver, delivery authority and evidence, private-production
evidence, hosted CI/load, physical Safari/devices, manual assistive-technology
review, disaster restore, professional opinions, first-paying-customer
live-money validation and founder visual approval remain unavailable and
unclaimed. Founder visual approval is separate from functional mounted
browser acceptance.
