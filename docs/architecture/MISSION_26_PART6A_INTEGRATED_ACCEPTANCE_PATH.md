# Mission 26 Part 6A integrated commercial baseline

Status: single-package implementation candidate. Part 6A becomes scoped-accepted only after this same branch passes a fresh independent exact-head audit, merges normally, and its sole automatic deployment is verified. There is no separate documentation gate, second pull request, or second deployment. This package adds no customer-facing UI.

## Result

Migration 234 composes three current NorthStar commercial baselines in one immutable tenant-private position:

- authorized issued-estimate value before tax;
- current approved-price value before tax; and
- owner-confirmed booked-work value before tax.

The position retains separate issued, stale-issued, approved, withdrawn, reviewed-unconfirmed, corrected, confirmed, and cancelled counts. It never relabels an estimate as booked work, a booking as earned revenue, or earned revenue as collected cash. `earnedRevenueMeasured`, `collectedCashMeasured`, `forecastIssued`, and `automaticActionAuthorized` remain false.

Part 6A composes existing authorities. Mission 24 remains the authority for estimate versions and approved-price decisions. Mission 22 remains the authority for accepted scheduling evidence. The explicit NorthStar commercial review and owner-confirmed booking remain the booked-work authorities. Mission 27 still owns invoices, earned revenue, payments, collections, and cash. Mission 28 still owns later automation.

## Source-complete capture-time equivalent

The frozen scope permits an eligible source-complete, source-ordered observation period or a rigorously documented equivalent supported-source method. This package uses the second path. It does not claim that a natural calendar observation period has been verified.

Migration 234 drains existing writers with `SHARE ROW EXCLUSIVE` locks before installing `BEFORE INSERT FOR EACH ROW` source fences on issued estimate versions and booked-work confirmations. An old `READ COMMITTED` transaction that began before installation still encounters the committed production trigger when it later inserts. Each insert then takes the tenant commercial-source advisory lock. Capture and read take the same commercial lock before the profile-effective and price-decision locks, recheck paid access after waits, and scan the complete bounded supported ledgers in deterministic order.

The current approved-price population reuses migrations 211 through 213: the complete epoch, gap check, immutable current-source rows, and genuine price decision order. Issued-estimate currentness is validated against those current-source rows, while the complete issued-version history is separately bounded and digested. Current commercial reviews are selected by immutable review order. Every non-cancelled current review must pass its owning currentness reader before it can be classified. Each confirmation is checked through its owning currentness reader, and two current confirmations for the same opportunity make the whole position unavailable rather than double counting one sale. The complete confirmation history is separately bounded and digested.

Each source lane accepts at most 1,000 rows and a 262,144-byte private manifest. Capture refuses the whole position at the first exact `+1` or oversized boundary. Missing epochs, gaps, stale lineages, mixed currency, incomplete review evidence, duplicate current opportunities, unsafe amounts, or changed sources remain unavailable. A complete authenticated empty population returns exact `0.00` values and zero status counts; it is distinct from missing coverage. Currency for a complete zero comes from the separately verified future origin rather than an absent commercial row.

The resulting private digest binds the exact tenant, currency, source scope, approved-price coverage boundary and high-water order, commercial orders, current cohorts, and complete histories. Replay returns the original immutable row only when the full request and current source digest still match. Same-key changed input conflicts, concurrent same-key capture creates at most one row, and a correction, cancellation, profile change, method change, or source change makes the saved position unavailable without rewriting it.

`naturalObservationPeriodVerified` remains false. The captured position says only that the complete supported current source state was proven at its capture boundary. It does not establish natural history, calibration, trend, probability, whole-business coverage, or off-platform revenue.

## Genuine future approved-price baseline

The future baseline is an already saved and separately activated `revenue.approved_price_flow` origin. Part 6A does not create or alter that origin. It verifies:

- the exact current source receipt and source snapshot;
- the target, point-value unit, currency, one-day horizon, and calculation version;
- a committed pre-horizon activation proof whose digest is intact;
- the exact prospective Business Profile and UTC calendar witness, anchor, activation, and absence of a later profile change;
- the sealed v1 deterministic semantic registration;
- the v2 governance lineage and dependency-closure digest; and
- the new immutable Part 6A registration that binds those identities to the current live closure.

The sealed v1 closure's historical false-current result remains unchanged. Migration 234 does not reinterpret or mutate that evidence. Its additive registration records the exact legacy semantic identity, v2 governance identity, and live closure digest used by this integrated position. Those private digests are persisted and revalidated but are not returned over HTTP.

The existing activation receipt proves that the already committed origin was observed before its horizon. The Part 6A wrapper makes no new claim about its own transaction commit time. Immediately before inserting the integrated position it separately checks that capture time is still strictly earlier than the pinned future horizon start; otherwise it returns unavailable and writes no row.

## Guarded HTTP boundary

The mounted endpoints are:

- `POST /api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines`
- `GET /api/v1/forecast/booking-reviews/booked-work/integrated-commercial-baselines/:positionId`

Capture requires a current paid owner or administrator, tenant-bound session, CSRF, a 16-to-128-character idempotency key, exact confirmation, the fixed confirmation version, one future-origin UUID, and a bounded reason. Read requires the same paid owner/admin tenant authority. Anonymous, viewer, dispatcher, technician, suspended membership, revoked session, past-due subscription, invalid CSRF, malformed input, and cross-tenant-looking records fail closed. Cross-tenant read uses generic absence.

The public projection contains the three commercial amounts, safe status counts, capture time, currency, supported-source scope, coverage timestamp, future target/version/calculation/calendar/horizon and pre-horizon verification, plus explicit false boundary flags. It constructs every nested object field by field. Private source high-water values, receipt IDs, run IDs, profile anchors, internal decision identities, source manifests, and every digest stay in PostgreSQL.

Runtime may execute only the guarded capture and read entries. `PUBLIC` and runtime cannot read or mutate the immutable position or registration tables and cannot execute the private source, future-origin, bounds, fence, or immutability helpers. Startup verifies exact ordinary nonpartitioned relation topology, no inheritance in either direction, exact index key order, exact trigger timing/events/level/function with no predicate or trigger arguments, immutable registration identity, function security/search path, and runtime/`PUBLIC` privileges. Altered topology or authority stops startup.

## Evidence

The writer package exercises migration 001 through 234 and the rolling 233-to-234 upgrade on disposable PostgreSQL. The focused proof covers positive PostgreSQL-to-HTTP capture/read for one current booked opportunity, authenticated zero, mixed currency, missing issued and confirmation sources, duplicate-opportunity refusal, revoked lineage, correction and cancellation staleness, profile and method staleness, exact 1,000 and `+1` bounds in every new source lane, same-key concurrency, exact replay and changed replay, invalid digest, role/session/subscription/CSRF/tenant denial, direct helper/table denial, install-time writer draining, an old transaction using the newly installed production trigger, retry after migration lock timeout, and transactional startup poison/recovery.

Route-unit evidence rejects unknown nested or contradictory database shapes, strips unlisted top-level data, and rejects hostile nested fields, invalid timestamps and source orders, arbitrary unavailable reasons, missing replay/read markers, malformed inputs, and private-field reflection. The package also retains the owning Part 3B future-origin lifecycle and existing commercial-review compatibility proof.

Because Part 6A adds no customer-facing UI, the existing Command Center received a fresh backend-compatibility smoke in both paid and isolated-demo modes: Chrome passed 8 of 8 cases and Playwright WebKit passed 8 of 8 cases across desktop/mobile, light/dark, daylight/standard-time presentation, no page errors, and no browser writes.

CI, private-production tenant data, live providers or credentials, physical Safari or devices, complete accessibility certification, natural production history, off-platform and whole-business completeness, empirical accuracy, calibration, drift, confidence, earned revenue, collections, cash, and a production forecast remain unavailable and are not claimed. Playwright WebKit is not physical Safari.
