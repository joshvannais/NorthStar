# Source-to-sink and bounded review

Source is hostile unbroken durable customer/job text already rendered through
DOM creation and `textContent`. The correction changes only the CSS layout sink:
intrinsic grid/flex sizing and line breaking. All bytes remain visible; no HTML
interpretation, truncation, clipping, hidden overflow, or source transformation
was introduced.

The complete correction diff was reviewed after testing. Runtime JavaScript,
server/API/PostgreSQL state, tenant/session/role/subscription boundaries,
preview/approval/idempotency, and provider behavior are unchanged. The new
geometry code lives only in the mounted browser test and reads semantic layout;
it cannot affect the production bundle. No alternate CSS selector leaves the
Calendar list, state chips, or action row with the audited max-content minimum.

The optional security scanner remained unavailable and was not invoked. Manual
source-to-sink review found no authority or security regression.
