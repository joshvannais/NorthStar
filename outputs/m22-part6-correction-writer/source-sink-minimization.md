# Mission 22 Part 6 correction source-to-sink and minimization record

## M22-P6-AUD-001 — employee bootstrap boundary

The vulnerable path was:

`/dashboard/today` -> shared `NavComponent` -> shared `/api/auth/me` -> broad
operator route contract plus account, tenant, subscription, onboarding, email,
and phone bytes -> client-side DOM filtering.

The invariant is that a signed-in Today request must receive only the current
personal/current-crew work projection plus the minimal shell/authentication
truth needed to render Today and sign out. Client-side hiding is not an
authorization or minimization boundary.

The correction removes `auth-session.js`, `nav-component.js`, and
`command-center-contract.js` from Today only. `today-shell.js` builds one Today
navigation destination and a real same-origin CSRF-protected logout control by
DOM creation/`textContent`; it does not call `/api/auth/me`. `theme.js` skips
the broad operator telemetry bundle only for `body.today-page`. Other accepted
pages retain the shared bootstrap and theme behavior unchanged. Current minimal
display identity still comes from the existing `/api/v1/today` same-snapshot
repository response with exactly `displayName` and `operationalRole`; no new
authentication authority or server role system was created.

Mounted real-cookie and real-browser coverage inventories every same-origin
employee destination and every inspectable response body. The allowed network
set is exactly the Today document, `/api/v1/today`, the minimized Today/theme
scripts, the existing style sheets, and the logo. It asserts no `/api/auth/me`,
operator route, telemetry, subscription/onboarding/organization bootstrap, or
private account email/phone bytes, and scans JSON/static bodies for hostile and
withheld fixture values. The visible logout control performs the real POST,
revokes its durable PostgreSQL session, redirects to login, and leaves no cached
work card.

## M22-P6-AUD-003 — screenshot truth

The browser harness now computes `expectedVisible` and `expectedWithheld` from
the actual state. Loading, error, offline, stale, restricted, and empty rows do
not claim job/customer/assignment truth is visible and explicitly state that
all private work is absent or cleared. Loading names the delayed real request;
network error names `route.abort`; offline names `context.setOffline`; stale
names `route.fulfill`. Each synthetic row states that the injected condition is
not durable authority. Revocation and crew removal remain real PostgreSQL
authority mutations inside disposable test tenants.

The aggregate validator rejects false non-ready private-field claims, missing
absence statements, synthetic-state provenance omissions, wrong exact
revision/tree, missing IANA fixture identity, or screenshot hash divergence.
DOM/API/network assertions, rather than screenshots alone, continue to prove
the absence of financial, billing/settings, broad customer history,
other-worker schedule, owner-only Polaris cost intelligence, provider secret,
and Mission 23 bytes.

## M22-P6-AUD-004 — wall-clock-independent fixture

`m22-part6-browser-fixture-time.js` evaluates a fixed bounded set of real IANA
tenant zones against the current real instant, selects a civil day with enough
remaining horizon, and resolves every appointment through the production
scheduling-time contract. It neither forges browser/server time nor introduces
a test endpoint. Every matrix records the selected timezone and reference
instant. The focused test exercises all 24 representative UTC hours plus US DST
gap/fold boundaries, while the dedicated New York mounted schedule/DST tests
remain unchanged.

## Unchanged authority and exclusions

`src/scheduling/todayRepository.js`, `/api/v1/today`, the bounded repeatable-read
snapshot, tenant/session/member/user/workforce/crew rules, route evidence,
Mission 23 exclusions, and migrations are unchanged. Migrations 001–035 remain
protected; migration 036 does not exist. No provider call, production access,
new mutation capability, Part 7 behavior, or site-wide visual redesign is part
of this correction.
