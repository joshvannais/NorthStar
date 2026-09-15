# Mission 24 Part 8 Slice 2 — Estimate access and issuance correction

## Purpose

This corrective follow-up traces one current estimate through the mounted estimating authority that exists after Part 8 Slice 2. It validates recorded inputs, material and labor plans, equipment and travel allocations, composed direct costs, proposed pricing, pricing policy, commercial terms, owner approval, private Capella analysis, customer-safe preview, and immutable issue history.

This closes two Slice 2 gaps: estimate access was difficult to find, and an approved demo estimate could not be durably issued because the demo mutation ledger's operation field was too short. This package does not complete Part 8 or Part 9.

## Remaining Part 8 Slice 3

Slice 3 still owns the interactive estimate: secure public delivery for an exact issued version, link expiration and revocation, customer acceptance evidence, question routing, owner-visible status, replay and failure recovery. Static PDF and image downloads remain button-free. Mission 28 later owns broader approved communications and reminders; that later mission does not replace this estimate-specific Slice 3.

## Required journey

The same journey must run through both the paid route and the isolated demo route:

1. Read the current estimate identity and source pins.
2. Calculate, save, and deliberately adopt material and labor costs.
3. Calculate and save the equipment plan and its cost allocation, then deliberately adopt that allocation.
4. Calculate and save travel and logistics, then deliberately adopt the travel cost with explicit overlap coverage.
5. Prove that every visible direct-cost component adds exactly to the composed direct-cost total.
6. Calculate and save a proposed customer price and an applicable minimum/margin policy without silently changing the proposal.
7. Calculate and save customer charges, tax treatment, and payment timing, then require explicit owner approval.
8. Calculate a private Capella scenario and prove its cost, remaining-dollar, and policy arithmetic independently from the customer document.
9. Generate the customer-safe estimate from the approved server state, prove private economics are excluded, issue one immutable version, and read that version from history.
10. Compare paid and demo arithmetic and customer-output boundaries.

## Customer-card entry

Every loaded customer card exposes **Estimate** as the first primary action. Its compact status reads **Needs review**, **Ready**, or **Issued**. The action opens the next unfinished review step or the customer preview. The existing estimate panel remains the concise status and issue surface.

## Correction evidence and Part 9 preflight

- PostgreSQL 18.4 disposable database journey with exact paid/demo route parity.
- Exact arithmetic checks for material, labor, equipment, travel, direct-cost composition, pricing overhead, tax, customer total, Capella modeled cost, and remaining dollars.
- Explicit review and approval boundaries; advice and saved policy do not approve the price.
- Customer-output allowlist checks and immutable issued-version readback.
- Chrome and Playwright WebKit checks at desktop and mobile sizes, including the persistent customer-card estimate action, responsive preview, PDF/image output, focus containment, retry states, and no unsupported customer actions.
- Existing focused and retained Mission 24 regression suites remain release gates.
- The same mission-wide trace must run again after Slice 3 and include delivery, acceptance, questions, expiration/revocation and recovery before Part 9 can be accepted.

## Unavailable evidence

Physical Safari and physical mobile devices, private authenticated production data, live provider calls, delivery confirmation, customer acceptance, and the founder's visual verdict remain separate and unavailable in this local package.
