# Mission 28 Part 6B — durable time-zone-aware scheduler

## Authority

Part 6B stores one immutable tenant-private schedule for one already accepted Part 6A action unit and outbox row. It binds the exact transaction, run, unit, outbox, policy, source set, tenant time zone, explicit local date/time, exact UTC instant, business calendar, quiet windows, holidays, expiration and PostgreSQL trusted-clock rule. It does not publish the outbox row, start a timer, claim work, lease work, retry, contact a provider or recipient, mutate an upstream record, create an accounting fact or move money.

Part 6A is released at source `af2b777a3d146f24e95052add626784186d4b0df`, PR #569, main `41b509e493cf6489aeed32c3c729b1493264df5c`, Railway deployment `62521b53-9b1b-44c8-af98-97b91f256138` `SUCCESS/RUNNING`, image `sha256:0f9e9e1a6119bc647e58c9f13dca4b746ae677c89ca080fa7cefeeda77cd804f`, and production migrations 271/271 through 275 with no 276. The Part 6A outbox remains `committed_unpublished`; Part 6B adds schedule evidence without changing it.

## Exact schedule and calendar

The candidate and a separately trusted server resolution must agree on the complete schedule material. The time-zone identifier is the exact current tenant/limit-authority IANA identifier and must match the calendar. Migration 276 freezes the complete 419-identifier catalog produced by exact Node 22.23.3 `Intl.supportedValuesOf('timeZone')` plus `UTC`; PostgreSQL storage requires membership in that catalog and availability in its own time-zone data. The explicit local date and local time must round-trip from the exact UTC instant in that zone. Abbreviations, fixed offsets, aliases, case variants, unknown zones and candidate-supplied fallback zones fail closed.

The UTC candidate search is fixed at 2,881 minute-aligned instants centered on the supplied UTC instant. A daylight-saving gap has no match and is denied. An ordinary local instant has exactly one match and requires `not_ambiguous`. A fold has exactly two matches and requires the explicit `earlier` or `later` choice to equal the corresponding UTC instant. More than two matches or unresolved transformations fail closed.

The calendar contains one to 32 allowed weekly half-open windows, zero to 32 quiet weekly half-open windows and zero to 64 strictly increasing unique local holiday dates. Windows are same-day, strictly ordered, nonoverlapping and bounded to ISO weekday 1–7 and minutes 0–1440. A schedule must fall in an allowed window, outside every quiet window and outside holidays. Calendar, quiet-hour or holiday evidence can suppress a schedule; it can never reroute, broaden or create authority.

## Trusted time, replay and durability

New schedule admission uses PostgreSQL `statement_timestamp()` with the transaction time zone fixed to UTC. The scheduled UTC instant must be strictly future, no more than 366 days away, and earlier than an expiration no more than 367 days away. No caller time is trusted. Exact stored replay is returned before volatile policy, source, calendar or clock reevaluation, so later time cannot rewrite historical schedule evidence. Any material change requires a new accepted Part 6A decision, action unit and schedule.

Migration 276 adds one forced-RLS immutable schedule table and an owner-only store function with no application execute grant. New schedules revalidate the exact active policy, latest source heads and existing Part 6A transaction/unit/outbox bindings. The unit and outbox each admit at most one schedule. Any failure rolls back with zero schedule residue and cannot mutate Part 6A rows.

## Deliberately unavailable behavior

There is no mounted schedule resolver, route, UI, timer, queue publisher, consumer, worker, claim, lease, fencing token, provider request, recipient message, delivery, reply, outcome, upstream mutation, accounting mutation or money effect. Parts 6C–6F and Parts 7+ retain those later authorities. Independent acceptance, PR, merge, deployment, private-production evidence, provider/live evidence, hosted performance/SLA, restore, physical Safari/devices, manual assistive technology, professional review and founder visual approval remain unavailable and unclaimed.
