# Mission 32 — On-the-Fly Calculator

## Status

Future mission. This document records the authorized product concept only. Mission 32 must not begin until the preceding roadmap missions and their release gates are complete.

On 2026-09-21, the founder assigned **execution planning** to Mission 32. This is future authority for the on-site calculator and rapid Estimate Studio to construct and revise a job-specific method of work. It does not reopen sealed Mission 24 or broaden Mission 25's remaining acceptance scope. This authority decision does not itself start Mission 32 implementation.

## Product outcome

Give an authorized owner or estimator a fast, explainable calculation while a prospective job is being discussed or immediately afterward. The user records what is known through a concise manual, conversational, or mobile-friendly intake. NorthStar pre-fills recognized Business Profile, workforce, asset, inventory, travel, tax, overhead, margin, scheduling, knowledge, and learned-company facts; Polaris identifies what remains unknown and produces a non-binding planning range the contractor can remember, compare, save, and revisit.

The product name is **On-the-Fly Calculator**. It may also be presented as the rapid Estimate Studio when the workflow expands into a reviewed customer estimate, but it remains distinct from the investor calculator and from autonomous pricing.

## Execution-planning authority

Mission 32 owns the smallest additive, versioned representation needed to connect a customer scope to a proposed method of execution. Where existing Mission 24 scope, estimate revisions, component plans, stages, resources, dependencies, provenance and cost-coverage contracts suffice, consume them. Introduce a bounded operation or execution-plan contract only for a demonstrated gap, such as repeated onsite material transfer, operation inputs and outputs, conditioned production rates, equipment operating states, or multi-phase resource dependencies. It must remain linked to canonical estimate identity and revisions, not become a second estimating or pricing engine.

Polaris may propose operations, conditional follow-up questions, feasible method alternatives and consequential assumptions. Authorized domain calculators determine quantities, cycles, utilization, duration and costs from explicit inputs; Capella challenges evidence, feasibility, sensitivity and downside. An inferred site condition, nominal asset specification, researched price or customer statement must not silently become a measurement, supplier quote, suitability approval or human decision. Unknown consequential inputs remain visible and actionable.

The field workflow starts from an existing lead, customer, call-derived scope, Prepared Estimate and authorized Business Profile facts where available. An estimator can confirm, correct, reject or add observations onsite; consequential changes invalidate dependent assumptions for review and create a traceable version. Repeated operations should be represented by a validated pattern and count rather than thousands of individual records. The default view remains concise; detailed operations and calculations are inspectable on demand. Customer output continues through Mission 24's customer-safe, human-approved boundary.

Mission 25's accepted tenant-private actuals and learning may supply authorized historical evidence without changing Mission 25's scope. Mission 26 owns statistically calibrated distributions only when sufficient trustworthy outcomes exist. Mission 23 owns field actuals; Mission 22 owns scheduling and dispatch decisions; Mission 27 owns billing and payments; Mission 33 owns NorthStar platform administration rather than contractor estimate decisions. Provider adapters remain replaceable and tenant-private. Any execution-planning capability that cannot fit these boundaries must be brought back for founder review before implementation.

## Core workflow

1. Start a new on-the-fly calculation from the paid workspace.
2. Enter the known customer/contact context without silently creating a customer record.
3. Describe the requested work, job scope, measurements, constraints, urgency, desired timing, location, and supporting notes.
4. Choose or confirm the operating Business Profile, service area, crews, equipment, vehicles, materials, suppliers, labor assumptions, travel rules, taxes, overhead, margin policy, scheduling capacity, and other authorized inputs.
5. Polaris runs the applicable NorthStar pricing, financial, opportunity, scheduling, travel, workforce, asset, material, risk, confidence, and recommendation engines.
6. Show a live explainable range, confidence, missing inputs, assumptions, risk flags, resource requirements, and recommended next action.
7. Save the calculation as a durable draft in a searchable list.
8. Later convert the draft into an authorized lead, customer, estimate, appointment, or work record through an explicit reviewed action.

The calculator must remain useful with limited early information while clearly separating recorded facts, recognized company facts, calculated values, assumptions, and unknowns. It must not force an owner to re-enter information already present in an authorized, current NorthStar source.

## Required intake groups

- Customer/contact information and preferred follow-up method
- Job address or approximate service location
- Service type, scope, dimensions, quantities, condition, and desired outcome
- Urgency, schedule constraints, access constraints, permits, hazards, and dependencies
- Photos, files, and notes when authorized by a later implementation phase
- Known materials, finish/quality preferences, equipment, crew skills, vehicles, and travel needs
- Commercial assumptions such as tax, overhead, margin, discounts, financing, and contingency

## Calculation output

- Planning range and central planning value
- Line-item material, labor, equipment, vehicle, travel, permit, tax, overhead, margin, and contingency breakdown
- Crew, skill, asset, inventory, supplier, and scheduling implications
- Evidence used, versioned assumptions, missing inputs, uncertainty, and confidence
- Polaris explanation and recommended next step
- Clear statement that the result is not a binding quote until reviewed and authorized

## Durable list

Saved calculations must support status, owner, created/updated time, customer or prospect label, service, location, planning range, confidence, next action, search, filters, revision history, duplication, archive, and explicit conversion to canonical operating records.

## Authority and safety boundaries

- A draft calculation is not a customer, lead, job, appointment, invoice, or binding estimate.
- No downstream record is created or changed without a deliberate role-authorized action.
- Every input and engine version used by a calculation is retained for reproducibility.
- Unknown values remain unknown; NorthStar must not invent measurements, availability, costs, taxes, permits, or provider results.
- Business Profile, workforce, equipment, inventory, pricing, financial, travel, and scheduling data remain tenant-scoped and role-authorized.
- Polaris must distinguish customer-provided facts, contractor-provided facts, recognized Business Profile facts, calculated values, and assumptions.
- Changes to source records do not silently rewrite an accepted historical calculation; recalculation creates a new version.
- The UI must explain confidence and missing inputs before presenting a memorable number.

## Acceptance gates

- Mounted production modules and durable PostgreSQL authority
- Concurrency, tenant-isolation, role-authorization, tamper, replay, and versioning tests
- Authentic multi-engine calculations using the complete authorized NorthStar engine set
- Component-level validation of scope, quantities, feasible methods, material flow, production, crew and equipment utilization, internal and external logistics, dependency-constrained duration, sourced costs, overlap protection, uncertainty, provenance, revisions, human approval and customer-safe output
- A synthetic long, restricted-access job whose repeated onsite movements are derived from quantities, payload, routes and cycle times; and a small service job that remains fast and simple
- Desktop, tablet, and mobile interaction validation in Chrome and actual Playwright WebKit
- Independent security/release audit at an immutable ref
- Normal merge, exact automatic deployment, health, passive production acceptance, and final-ref seal

## Explicit non-goals

- Starting Mission 32 before the roadmap reaches it
- Replacing a site visit, professional judgment, code/permit review, or a contractor-approved quote
- Automatically contacting a prospect, booking work, ordering material, assigning crews, or creating financial obligations
- Treating incomplete inputs as facts
