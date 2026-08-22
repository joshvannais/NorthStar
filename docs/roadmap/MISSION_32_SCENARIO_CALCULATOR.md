# Mission 32 — Scenario Calculator

## Status

Future mission. This document records the authorized product concept only. Mission 32 must not begin until the preceding roadmap missions and their release gates are complete.

## Product outcome

Give a paying NorthStar customer a fast, explainable planning calculation when a prospective job is described informally—for example, by word of mouth before a formal site visit. The contractor records what they know, Polaris identifies what is missing, and NorthStar produces a non-binding planning range the contractor can remember and revisit.

The feature name **Scenario Calculator** is provisional.

## Core workflow

1. Start a new calculation from the paid workspace.
2. Enter the known customer/contact context without silently creating a customer record.
3. Describe the requested work, job scope, measurements, constraints, urgency, desired timing, location, and supporting notes.
4. Choose or confirm the operating Business Profile, service area, crews, equipment, vehicles, materials, suppliers, labor assumptions, travel rules, taxes, overhead, margin policy, scheduling capacity, and other authorized inputs.
5. Polaris runs the applicable NorthStar pricing, financial, opportunity, scheduling, travel, workforce, asset, material, risk, confidence, and recommendation engines.
6. Show a live explainable range, confidence, missing inputs, assumptions, risk flags, resource requirements, and recommended next action.
7. Save the calculation as a durable draft in a searchable list.
8. Later convert the draft into an authorized lead, customer, estimate, appointment, or work record through an explicit reviewed action.

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
- Desktop, tablet, and mobile interaction validation in Chrome and actual Playwright WebKit
- Independent security/release audit at an immutable ref
- Normal merge, exact automatic deployment, health, passive production acceptance, and final-ref seal

## Explicit non-goals

- Starting Mission 32 before the roadmap reaches it
- Replacing a site visit, professional judgment, code/permit review, or a contractor-approved quote
- Automatically contacting a prospect, booking work, ordering material, assigning crews, or creating financial obligations
- Treating incomplete inputs as facts
