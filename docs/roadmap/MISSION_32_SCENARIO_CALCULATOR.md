# Mission 32 — Scenario Calculator

## Status

Future mission. This document records the authorized product concept only. Mission 32 must not begin until the preceding roadmap missions and their release gates are complete.

This mission must also satisfy `CROSS_INDUSTRY_ESTIMATING_AND_CAPELLA.md`. That additive roadmap defines the universal industry-pack, cost-intelligence, outcome-learning, Polaris, Capella, formal-estimate, and invoice boundaries on which this mission depends.

## Product outcome

Give a paying NorthStar customer a fast, explainable planning calculation when a prospective job is described informally—for example, in person, by phone, or before a formal site visit. An owner or authorized estimator manually records what they know, Polaris identifies what is missing, and NorthStar produces a non-binding planning range the contractor can understand, adjust, save, and revisit.

The feature name **Scenario Calculator** is provisional.

## Core workflow

1. Start a new calculation from the paid workspace.
2. Enter the known customer/contact context without silently creating a customer record.
3. Describe the requested work, job scope, measurements, constraints, urgency, desired timing, location, and supporting notes.
4. Choose or confirm the operating Business Profile, service area, crews, equipment, vehicles, materials, suppliers, labor assumptions, travel rules, taxes, overhead, margin policy, scheduling capacity, and other authorized inputs.
5. Resolve the exact enabled, reviewed industry-pack version. If the service is unsupported or material evidence is missing, stop in an honest research, site-verification, or unable-to-price state rather than inventing a result.
6. Polaris runs the applicable NorthStar pricing, financial, opportunity, scheduling, travel, workforce, asset, material, capacity, comparable-job, risk, confidence, and recommendation engines against one exact scenario version.
7. Show a live explainable range, confidence, missing inputs, assumptions, evidence, risk flags, resource requirements, and recommended next action.
8. When the user asks about risk, downside, confidence, or what could go wrong, show the Capella Risk Lens for the same exact scenario and price. Polaris may recommend opening it when material risk requires attention, but the second view is not silently invoked.
9. Let the user revise known inputs and compare alternatives without mutating a saved version.
10. Save the calculation as a durable draft in a searchable list.
11. Later convert the draft into an authorized lead, customer, formal Mission 24 estimate, appointment, or work record through an explicit reviewed action.

## Required intake groups

- Customer/contact information and preferred follow-up method
- Job address or approximate service location
- Service type, scope, dimensions, quantities, condition, and desired outcome
- Urgency, schedule constraints, access constraints, permits, hazards, and dependencies
- Photos, files, and notes when authorized by a later implementation phase
- Known materials, finish/quality preferences, equipment, crew skills, vehicles, and travel needs
- Commercial assumptions such as tax, overhead, margin, discounts, financing, and contingency
- Industry, service method, selected industry-pack version, and the pack's required conditional questions
- Explicit self-performed versus subcontracted work
- Equipment ownership, lease or payment allocation, utilization, mobilization, operator, fuel, maintenance, consumable, and downtime assumptions when relevant
- Evidence source, locality, effective date, freshness, applicability, and approval status for every material rate

The user may enter only what is known. Missing facts remain visibly unknown and may block a responsible result. A default, model completion, simulation, or value from another tenant must not silently fill the gap.

## Calculation output

- Planning range and central planning value
- Line-item material, labor, equipment, vehicle, travel, permit, tax, overhead, margin, and contingency breakdown
- Crew, skill, asset, inventory, supplier, and scheduling implications
- Evidence used, versioned assumptions, missing inputs, uncertainty, and confidence
- Polaris explanation and recommended next step
- Optional Capella downside, sensitivity, margin-at-risk, missing-fact, capacity, volatility, and dependency analysis using the same price and scenario version
- Estimate readiness state: ready for authorized review, provisional range, research required, site verification required, or unable to price responsibly
- Clear statement that the result is not a binding quote until reviewed and authorized

Polaris is the purple operational recommendation. Capella is the gold/amber Risk Lens shown beside it when requested. Polaris may offer Capella when it detects material risk. Capella does not produce a competing number or independently change price, scope, assumptions, or authority. Any later expansion of Capella beyond this Risk Lens requires separate roadmap authority.

The default result stays concise. Detailed assumptions, evidence, cost construction, comparables, risk, and revisions use progressive disclosure so an owner can reach and explain the important answer within minutes.

## Durable list

Saved calculations must support status, owner, created/updated time, customer or prospect label, service, location, planning range, confidence, next action, search, filters, revision history, duplication, archive, and explicit conversion to canonical operating records.

## Authority and safety boundaries

- A draft calculation is not a customer, lead, job, appointment, invoice, or binding estimate.
- No downstream record is created or changed without a deliberate role-authorized action.
- Every input and engine version used by a calculation is retained for reproducibility.
- Unknown values remain unknown; NorthStar must not invent measurements, availability, costs, taxes, permits, or provider results.
- A reviewed industry pack and applicable company-specific evidence must exist before NorthStar presents a result as ready for formal review.
- Business Profile, workforce, equipment, inventory, pricing, financial, travel, and scheduling data remain tenant-scoped and role-authorized.
- Polaris must distinguish customer-provided facts, contractor-provided facts, recognized Business Profile facts, calculated values, and assumptions.
- Tenant actuals and comparable completed jobs remain private. Cross-tenant learning is prohibited unless a later separately authorized and legally reviewed aggregate program exists.
- Changes to source records do not silently rewrite an accepted historical calculation; recalculation creates a new version.
- The UI must explain confidence and missing inputs before presenting a memorable number.
- Provider calls may assist bounded extraction, clarification, comparison, or explanation, but deterministic NorthStar calculations and accepted canonical evidence remain authoritative.
- The conversation and cards must present polished prose and native components, never raw JSON, JSON Schema, code, code fences, stack traces, internal identifiers or digests, provider bodies, prompts, or internal/provider error codes.
- Starting, recalculating, or saving a scenario cannot silently create or modify a lead, customer, job, appointment, formal estimate, quote, invoice, price book, knowledge version, schedule, or financial obligation.

## Conversion to a customer-ready estimate

Mission 32 does not itself turn a planning range into a binding customer document. An authorized user may explicitly send the exact reviewed scenario to Mission 24, where a formal estimate or proposal can use the company's approved logo and Business Profile identity, customer information, scope, options, exclusions, schedule assumptions, prices, taxes, terms, validity period, and acceptance workflow.

Internal costs, margin, evidence, uncertainty, and risk remain private unless a field is deliberately approved for the customer document. Mission 27 separately owns invoices and payment lifecycle.

## Acceptance gates

- Mounted production modules and durable PostgreSQL authority
- Concurrency, tenant-isolation, role-authorization, tamper, replay, and versioning tests
- Authentic multi-engine calculations using the complete authorized NorthStar engine set
- Versioned industry-pack applicability, unsupported-service, source/freshness, missing-evidence, and no-fabrication coverage
- Exact labor, material, equipment, travel, tax, overhead, margin, contingency, capacity, and cash reconciliation where applicable
- Comparable-job relevance, tenant isolation, recency, sample-size, outlier, actual-versus-estimate, and human-approved-learning coverage
- Polaris and Capella exact scenario/price/version agreement, no competing price, no hidden mutation, and professional presentation coverage
- At least one unfamiliar-industry case such as land surveying plus materially different industry packs proving the engine is not hard-coded to one trade
- Customer-document conversion, logo/identity/version pinning, internal-field exclusion, and preview/PDF/print parity coverage in Mission 24
- Desktop, tablet, and mobile interaction validation in Chrome and actual Playwright WebKit
- Independent security/release audit at an immutable ref
- Normal merge, exact automatic deployment, health, passive production acceptance, and final-ref seal

## Explicit non-goals

- Starting Mission 32 before the roadmap reaches it
- Replacing a site visit, professional judgment, code/permit review, or a contractor-approved quote
- Automatically contacting a prospect, booking work, ordering material, assigning crews, or creating financial obligations
- Treating incomplete inputs as facts
- Treating an unsupported industry as supported because a model can generate plausible prose
- Treating provider memory, unrestricted live research, simulations, or another tenant's work as canonical cost authority
- Presenting Capella as a second estimate or letting it change the canonical price
- Generating a formal customer estimate without explicit Mission 24 review
- Creating an invoice or payment obligation; that belongs to Mission 27
