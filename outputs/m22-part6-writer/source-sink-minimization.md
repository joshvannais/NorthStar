# Mission 22 Part 6 source-to-sink and minimization inventory

## Authority source and transaction

- `GET /api/v1/today` is the sole Part 6 data endpoint. It accepts no query,
  path, or body scope and has no POST/PUT/PATCH/DELETE sibling.
- Existing cookie-session tenant middleware and `dashboard:read` permission run
  first. `src/scheduling/todayRepository.js` then independently rechecks the
  exact auth-session binding/status/expiry, organization membership and role,
  active user, current workforce profile/operational role, and tenant IANA time
  zone in the same owned read-only repeatable-read PostgreSQL client/snapshot
  that returns the records.
- SQL uses schema-qualified names after fixed local
  `search_path=pg_catalog,public`, UTC, 15-second statement/idle-transaction
  timeouts, and a 2-second lock timeout. Every error rolls back and releases;
  recognized serialization/deadlock/lock/timeout races become typed 409 reload
  state. A request may finish from the coherent snapshot it opened before a
  concurrent authority change; the next request observes the committed change.
- Day bounds come from PostgreSQL transaction time and the current tenant IANA
  zone using explicit local-midnight `TIMESTAMP AT TIME ZONE` conversion. The
  browser time zone cannot change scope. Overlap includes overnight/multiday
  appointments and naturally produces 23/25-hour DST days.
- Direct scope is exact current workforce-profile equality. Crew scope is an
  `EXISTS` relation in the same tenant/snapshot. Removing that relation removes
  the crew record on the next request. Owners/admins/dispatchers receive no
  broader Today projection than their own direct/current-crew assignments.

## Allowlisted durable projection

The SQL selects only current assigned+scheduled canonical authority, the linked
job title/type, minimum current operational instructions, customer name/phone
and allowlisted service-address fields, direct/current-crew labels, active
current teammate names/crew roles, exact schedule/dispatch/review state,
revision/digest, and current approval pins. Cancelled, unassigned,
other-worker, removed-crew, cross-tenant, demo/simulation, and unrelated-day
records do not enter the projection.

If any selected assignment lacks an exact current legacy-import or human
approval revision/digest pin, the complete Today read fails closed before any
record byte is returned; the UI never reconstructs or presents an unapproved
current schedule.

The response caps work at 100 records, teammate presentation at 50, individual
instructions at 4 KiB, response JSON at 128 KiB, and uses deterministic ordering
by start/end/appointment ID and teammate name/profile ID. Counts are truthful;
the v1 collection never silently pages or truncates work.

The projection deliberately contains none of: estimate/final price/margin,
invoice/payment/payroll, subscription/billing/settings/configuration, broad
customer profile/history/communication/lead intelligence, transcript text,
other-worker directory/schedules, raw recommendation/audit/idempotency rows,
provider credential/configuration, or Mission 23 execution/completion state.
Appointment `completed` remains compatibility metadata only.

## Route and recommendation boundary

Part 3's current accepted recommendation authority explicitly records route
evidence unavailable without a separately authorized durable route source.
Today therefore returns provider-neutral `unavailable` or `needs_review`
uncertainty, null distance/duration/evidence digest, and `providerCalls: 0`.
It never treats a Polaris candidate/recommendation digest as route truth and
imports no provider SDK/configuration/credential or live map link.

## API-to-DOM sinks

- `public/js/today-page.js` structurally validates the read-only/version/day/
  count/route/revision/digest contract before rendering.
- All durable customer/job/crew/instruction/review/route bytes flow only through
  `createElement`, `appendChild`, `replaceChildren`, and `textContent`. Scoped
  review found no `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `eval`, or `new Function` sink.
- A non-ready state clears prior record DOM before showing loading, empty,
  error, offline, stale, or restricted state. Revoked sessions and removed crew
  membership cannot leave prior work visible or enumerable.
- The page issues only same-origin `GET /api/v1/today` plus existing telemetry;
  the mounted browser matrix asserts zero worker mutation requests and aborts/
  records every non-loopback request.
- Visible controls are real read-only controls: reload plus native disclosure
  of already returned instructions, route uncertainty, and current-crew
  context. No control implies arrive/en-route/start/progress/complete/cancel,
  time, equipment, material, inspection, photo, signature, note, incident, or
  proof-of-service mutation.

## Navigation, demo, and visual boundary

The shared paid navigation contract adds Today while the accepted nine-route
account-free demo contract remains unchanged. On Today, the shared navigation
is reduced to Today itself even for a broadly authorized owner/dispatcher, so
the employee surface does not enumerate broad directories, settings, or other
workers. Demo tokens/simulated controls are absent.

Today reuses Command Center theme and layout assets, page hierarchy, gutters,
cards, borders/radii/shadows, badges, footer, focus, light/dark, and mobile-nav
conventions. Part 6 adds only its page CSS and the exact shared route/navigation
classification required to mount the page; it makes no site-wide redesign.

## Manual security-diff conclusion

The complete base-to-working-tree diff was traced from session/tenant source
through PostgreSQL predicates, response keys, browser validation, DOM sinks,
navigation, and network behavior. No validated P0-P3 security issue remains in
the writer's bounded implementation review. This is not independent approval;
a different fresh exact-head auditor must repeat source-to-sink and mounted
adversarial review.
