# Mission 27 Part 4A — immutable invoice-draft origin

Part 4A creates one immutable, customer-safe composition origin from one exact-current Part 3 reviewed handoff. It does not create an invoice, receivable, tax result, amount due, number, approval, issue, delivery, payment, provider request, work mutation, or downstream receiver mutation.

## Authority and source

The only supported source is `mission27.part4.invoice_draft_source.v1`, the immutable Part 3D handoff receipt. PostgreSQL reconstructs current Mission 24 commercial authority and current Mission 23 evidence through the released Part 3 functions, then requires the current decision, source identity and digest, source-authority identity and digest, commercial-basis digest, handoff receipt ID and receipt digest to match exactly. Caller-provided lines, amounts, customer identifiers, source identities, or digests never become authority.

The action requires a current owner/admin `customer_financial.invoice.edit_draft` grant from immutable `mission27.launch.v1`, exact tenant, actor, membership, estimate, session, purpose and policy bindings, a current paid entitlement, CSRF, an idempotency key, explicit confirmation and a bounded reason. Grant revision changes serialize with the capture effect. Every accepted request key receives a durable minimized receipt; changed reuse conflicts and replay first revalidates the exact current source.

## Composition

For final balance, each accepted Mission 24 customer-safe charge becomes one invoice composition line. `quantity=1 customer_safe_charge` means one accepted commercial charge and explicitly does not claim a field quantity. Unit amount equals line amount, and every additive line must reconcile exactly in minor units to the reviewed handoff amount. Informational Mission 24 adjustments are not added again. Mission 24 tax evidence is not treated as invoice-date tax authority.

For an accepted pre-work deposit, the only supported line is the one exact accepted Mission 24 deposit-schedule obligation, with the reviewed handoff amount. Missing, ambiguous, invalid or out-of-bound source evidence returns a named value-free unavailable result. Exact zero remains an explicit arithmetic value and never substitutes for missing evidence.

Every origin pins the customer, estimate, accepted issued-version revision and digests, commercial approval, acceptance, reviewed handoff, decision, commercial basis, exact lines, exact subtotal and authorization evidence. The row and its request receipts are immutable and tenant private. Direct runtime table access and private helpers are denied; runtime may call only the guarded read and capture entry points.

## Deferred boundaries

Part 4B owns human wording/grouping/allocation revisions. Part 4C owns amount-changing commercial revisions and payment/credit components. Part 4D owns invoice-date tax review. Part 4E owns amount-due reconciliation, preview, paid/demo parity and Part 4 acceptance. Part 5 owns approval, number assignment, immutable issue and receivable creation. These states are explicit unavailable values in Part 4A.

Live money remains deferred until the first real paying customer. External signature legal review, Mission 23/25 receivers, live capacity/providers/private production, natural history, accuracy/calibration, accounting behavior, hosted CI, production load/SLA, physical Safari/devices, manual acceptance testing, disaster restore, professional opinions and founder visual approval remain unavailable. Part 4A performs zero provider, receiver, operational or live-money mutation.

Part 4A adds no rendered interface. Its accepted evidence is the guarded mounted API and database boundary: twelve authority/static unit suites with 92 tests and a fresh disposable PostgreSQL 17 run of five mounted tests through migration 268, repeated after database restart. Independent whole-head audit found no P0–P3; PR #490 merged normally and deployment `e1cfc4f0-16a1-4ad5-a883-5922c42d5fbe` applied migration 268 with health, root, and demo HTTP 200. Part 4E retains browser, accessibility, paid/demo parity and visual acceptance ownership.
