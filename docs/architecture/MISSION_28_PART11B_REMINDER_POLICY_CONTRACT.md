# Mission 28 Part 11B — owner-controlled reminder-policy contract

Status: **implementation candidate only; owner-readable and no-effect**.

Part 11B freezes the definition and validation boundary for pre-due, due-today, and overdue reminder policies. It does not persist, validate into active authority, approve, activate, schedule, queue, deliver, or observe a reminder. The executable contract is [MISSION_28_PART11B_REMINDER_POLICY_CONTRACT.json](MISSION_28_PART11B_REMINDER_POLICY_CONTRACT.json).

## Exact source and policy separation

One projection binds one separately trusted Part 11A `eligible_for_owner_collection_review_only` resolution and the exact separate invoice, balance, due/aging, delivery, dispute/refund/correction, settlement, offline-payment, accounting, customer, source-set, and authoritative-head evidence behind it. Every identity, version, digest, currency, customer, source set, head, currentness marker, and observation is exact. A correction, replacement, tombstone, reversal, changed source set/head, stale or unavailable axis, or different tenant/customer/invoice/version invalidates the projection. Aging selects a policy phase; it never grants communication or collection authority.

The policy definition is separate from eligibility, approval, recipient permission, channel availability, wording, local-time/calendar authority, cadence evidence, scheduling, delivery, outcomes, and all financial/accounting truth. Candidate data cannot create any of those authorities. The current complete mounted Part 11A resolver and every external financial-reminder launch/permission/provider/effect boundary remain unavailable, so the only current result is a fixed owner-readable unavailable state.

## Closed reminder grammar

- `pre_due` uses only canonical `not_due` evidence and strictly ordered negative day offsets.
- `due_today` uses only canonical `due_today` evidence and the exact zero-day offset.
- `overdue` uses an ordered subset of `overdue_1_30`, `overdue_31_60`, `overdue_61_90`, and `overdue_91_plus`, with strictly ordered positive offsets after the explicit owner-selected grace period.

Every cadence uses a finite minimum interval of at least one day, no more than three attempts in a rolling seven days, and no more than six attempts for one invoice. Separately trusted attempt evidence is never inferred or missing-as-zero. A zero lifetime count requires no last attempt; a positive lifetime count with zero attempts in the rolling window requires the last attempt to be strictly older than that inclusive window; and a positive rolling count requires the last attempt inside or exactly on the window boundary. Policy phase, current aging bucket and days-past-due must agree exactly, while the independently defined cadence offsets need only satisfy that phase's sign, ordering, bounds and grace rules. A current day does not have to equal an offset and never creates schedule authority. Wording and phase agree exactly. The owner-readable projection returns the closed policy, rollout, recipient-review, permission, approval, frequency, and calendar states without turning any of them into runtime authority.

The tenant time zone is one exact separately trusted canonical IANA identifier shared by the policy and Part 6B calendar authority. The policy records one explicit local wall time but never infers UTC. A future schedule must still use Part 6B to deny daylight-saving gaps, require an explicit fold instant, honor exact current quiet hours and holidays, and use the trusted database clock. Alias, fallback, reroute, ambiguous, stale, missing, or candidate-supplied time authority fails closed.

The only recipient class is one exact reviewed `authorized_billing_contact` bound to the same customer. Email and SMS are policy channel identifiers only; provider mode remains `provider_disabled`, and Part 7B external permission remains unavailable or suppressed. The three wording entries are immutable fixed customer-safe catalog text. They contain no free text, amount, payment destination, fee, threat, fabricated urgency, deadline, link, legal claim, or dynamic substitution. Part 11C retains exact invoice amount/document/payment-destination reminder material.

The approval class is exactly `per_run_approval` or `standing_authorization`, but this slice creates and consumes no authorization. Every definition contains the complete ordered mandatory stop-condition catalog. It may not remove, rename, reorder, or weaken a stop. Part 11D retains immediate suppression/rebuild behavior after later financial, customer-response, manual-contact, or source changes.

## No-effect boundary

No policy, approval, schedule, worklist, task, notification, message, provider attempt, callback, delivery, reply, opt-out, payment, allocation, fee, write-off, charge, refund, settlement, accounting entry, balance change, external effect, upstream mutation, or money movement is created. Migration 287 remains latest and migration 288 is absent.

Real recipient/provider/live/private-production evidence, professional legal/privacy/communications-consent/collections/provider review, hosted load/SLA, restore, physical Safari/devices, manual assistive-technology review, and founder visual approval remain unavailable and unclaimed.
