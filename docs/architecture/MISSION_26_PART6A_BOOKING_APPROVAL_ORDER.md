# Mission 26 Part 6A — booking approval source-order candidate

Migration 152 adds an immutable, private sidecar to new Mission 22 human
schedule approvals. Its tenant-scoped transaction lock orders committed
approvals without changing the Mission 22 approval, appointment, or assignment
contracts. Rolled-back sequence gaps do not represent missing approvals.
Earlier approvals are deliberately not backfilled into this order.

The sidecar is a prerequisite for a future guarded booking-event receipt, not
an accepted booking or booked-work baseline. An appointment may already have
been scheduled before the first observed human approval. Repeated assign,
dispatch, reschedule, and cancellation approvals need first-event and
correction interpretation from Mission 22 history. A matching opportunity ID
alone does not prove that a particular Mission 24 approved estimate was the
commercial agreement for that booking. The reviewed same-tenant link, price
effective and visible at booking, matching currency, complete source window,
and currentness checks remain unimplemented. No price is inferred from the
sidecar; missing linkage and pre-anchor history must remain unavailable.

Migration 153 corrects the deferred Mission 22 approval validator's execution
authority. That existing validator runs at commit, after the trusted approval
function returns, and could not call its deliberately private digest helper
under the ordinary runtime role. The forward-only correction makes that
read-only trigger function `SECURITY DEFINER`; its fixed search path and direct
runtime `EXECUTE` revocation remain. The same normal approval failure was
reproduced without migration 152 before this correction.

The candidate is local and unreleased. Its mounted disposable PostgreSQL test
uses the normal Mission 22 human preview/approval workflow and verifies order,
runtime privacy, and the validator privilege boundary. A wider Mission 22
regression suite still has six failures in this disposable test environment;
its exact result is not a full suite pass. This
candidate does not constitute full Part 6A acceptance or a forecast.
