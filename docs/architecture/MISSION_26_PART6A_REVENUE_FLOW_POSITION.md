# Mission 26 Part 6A — revenue-flow calculation boundary

This is an unmounted, bounded calculation contract for two historical event
flows. It is not a revenue forecast or a source-certified baseline. The
caller supplies at most 256 distinct same-organization estimate records, an
exact UTC interval `[startsAt, endsAt)`, a currency, an as-of instant, and a
claimed complete source snapshot. The calculator does not obtain or authenticate
that snapshot. Its result explicitly says `sourceAuthenticated: false` and
`forecastIssued: false` even when it can describe the supplied records.

`approvedPriceFlow` sums each estimate's first human-approved commercial price
whose decision occurred in the interval. `bookedWorkValue` sums the approved
price effective and already recorded at each first accepted booking in the
interval. A reviewed price decision may be an amendment before booking; this
changes booked value without changing the first-approval flow. A later approval
or amendment cannot retroactively price a booking. An unresolved link or price,
an unknown event state, a currency mismatch in the relevant interval, or
incomplete coverage makes the affected position unavailable rather than zero.
The values are neither earned revenue nor collected cash.

The caller must establish from Mission 24 that a decision really is the first
approved price, that amendments and withdrawals have the authorized lineage,
and that the decision price was effective at booking. Mission 22 must establish
that a booking really is the first accepted booking. A guarded adapter must
prove the reviewed same-tenant estimate-to-booking link, exact receipt-time
visibility, currency, correction policy, complete source coverage and stable
as-of snapshot. A digest and a `complete` claim supplied by a caller do not
prove those properties. No route or dashboard currently calls this module.
This work therefore does not close Part 6A's source acceptance gate, certify
the empty-history zero as a real production observation, or unblock an issued
revenue forecast. Part 6B additionally owns forecast and pipeline treatment;
Mission 27 owns native earned, invoice, payment and collection evidence.

The focused synthetic tests exercise first approval versus effective booking
price, amendment timing, absence of approval, link uncertainty, currency,
coverage, strict input shape and bounded records. Before numerical promotion,
an independent exact-head audit and source-integrated tests must establish
first-event semantics, same-tenant visibility, amendments and withdrawals,
backdated/corrected events, partial pagination, and the no-retroactive-rewrite
rule. No live Retell history or legal-document review is needed for this
synthetic calculation step.
