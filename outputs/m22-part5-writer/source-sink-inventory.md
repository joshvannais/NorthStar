# Part 5 source-to-sink inventory

## Server authority sources

- `src/routes/canonicalPolaris.js` mounts Calendar compatibility state through
  existing signed-in/onboarded tenant context and includes current operator
  directory plus server scheduling overview. Role-ineligible employees receive
  403 before the broad compatibility payload is returned.
- `src/routes/commandCenter.js` mounts paid Command Center through existing
  account/session/tenant/subscription middleware, requires owner/admin or active
  dispatcher authority, and returns 403 for employees before broad scheduling
  records are returned. Demo keeps its separate server-owned contract.
- `src/scheduling/operatorDirectory.js` reads only current-tenant active
  memberships/users/workforce profiles/crews, caps each source at 100, and
  binds mutation availability to the current access role, operational role,
  onboarding, and existing subscription mutability policy.
- `src/scheduling/overviewRepository.js` rechecks current actor, durable session,
  membership, role, onboarding, and subscription inside a repeatable-read
  transaction; uses PostgreSQL `clock_timestamp()` and tenant IANA authority;
  and invokes the mounted Part 2 evaluator for scheduled records. It caps input
  at 100 and retries bounded serialization/deadlock failures.
- Category membership is server-owned: unassigned is current target state; due
  is start within 24 hours; overdue is end before current PostgreSQL time;
  at-risk is unassigned/review/warning/conflict/revoked-dispatch or within 48
  hours without dispatch; conflicting means at least one Part 2 hard conflict.
  Cancelled records are excluded from time-risk classes. `completed` remains
  compatibility metadata, not Mission 23 completion evidence.
- `src/commandCenter/workspace.js` includes the bounded server projections and
  their exact digests in the paid workspace digest. No client-local authority
  or category calculation is accepted.

## Browser sinks and human mutation flow

- `public/js/scheduling-approval-ui.js` creates all stored/customer/job/worker/
  crew/reason/warning/evidence nodes with `createElement`, `append`, and
  `textContent`; scoped review found no `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` sink.
- `public/js/calendar-engine.js` renders the detailed authority board from the
  mounted server projection. Visible assign/reassign/unassign/schedule/
  reschedule/dispatch controls and legacy edit/drag/resize/keyboard/touch paths
  all delegate to the shared dialog. The compatibility `updateEvent` returns
  preview-required and cannot issue PATCH.
- `public/js/command-center-page.js` renders server category counts and exact
  appointment IDs only; it never reclassifies records. Its actions call the
  same shared dialog and refresh the complete paid workspace after approval.
- `public/js/command-center-contract.js` structurally validates the paid
  operator and overview contract before the page renders it.
- `public/demo-dashboard.html` labels demo scheduling presentation explicitly
  non-authoritative/read-only. Demo does not receive the paid tenant overview or
  mutation directory.
- `public/css/scheduling-approval.css` provides light/dark, visible focus,
  dialog reflow, touch targets, color-independent states, and 400% zoom support.

## Part 4 request sinks

- Preview: `POST /api/v1/canonical/appointments/:id/mutation-previews` with
  exact revision/digest/time zone/action/target/schedule/status/reason and
  current same-origin session/CSRF authority. It grants no mutation and expires
  after 15 minutes.
- Approval: `POST /api/v1/canonical/appointments/:id/mutation-approvals` with
  exact preview ID/digest, exact warning/review acknowledgements, human reason,
  current session/CSRF, and one stable bounded idempotency key for safe retry.
- Direct appointment PATCH remains uniformly 428 preview-required. Browser
  matrices observed zero PATCH requests.
- Part 4 atomically rechecks current tenant/session/member/role/subscription,
  target, assignment, schedule, conflict, recommendation, expiry, replay, and
  idempotency authority. Part 5 adds no alternate mutation sink.

## Failure and accessibility sinks

- 401/403/409/410/422/428/5xx and transport failures render explicit no-change
  status through an aria-live region. No optimistic state is written.
- Stale and offline preview failure leaves approval unavailable and safely
  retains the proposal. Expired/stale approval exposes a return-to-proposal
  path. Hard conflicts keep approval disabled with no override.
- The dialog has semantic headings and definition lists, focus trap/restore,
  Escape/cancel, keyboard operation, touch targets, visible focus, and no hidden
  offscreen approval at mobile widths or 400% zoom.

## External/provider boundary

Provider credentials were omitted. The browser harness aborted and recorded
any non-loopback origin request; every final matrix observed zero. Part 3
recommendation evidence is presentation-only and grants no mutation.
