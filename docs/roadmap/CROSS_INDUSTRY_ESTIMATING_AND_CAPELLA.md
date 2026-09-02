# NorthStar Cross-Industry Estimating Intelligence and Capella Roadmap

## Status and authority

This is an additive future-roadmap authority. It records the founder-directed requirements for cross-industry estimating intelligence, outcome learning, the Capella Risk Lens, customer-ready estimates, and the Mission 32 Scenario Calculator.

It does not authorize early implementation, reopen an accepted mission, change the serialized release order, enable a provider, or make an AI/provider response canonical. Each capability begins only in its owning mission after the preceding release gates are accepted.

## Product principle

NorthStar must eventually be able to support any legitimate company or industry that can be represented by reviewed business, work, cost, capacity, and outcome facts. It must not pretend to be an expert in every industry without those facts.

For every proposed price, NorthStar must be able to answer:

- What work is included?
- Which facts, measurements, rates, and assumptions produced the result?
- Which material, labor, equipment, subcontractor, travel, permit, tax, overhead, risk, and margin inputs were used?
- Which inputs came from the company, its completed work, a verified source, a dated external reference, or an unverified assumption?
- How local, current, and applicable is the evidence?
- What is missing, uncertain, stale, conflicting, or still subject to a site visit or professional judgment?
- What would make the estimate materially higher or lower?

NorthStar must never fill an unsupported industry or cost gap with confident-sounding invented information.

## Roadmap ownership and sequence

The requirements are intentionally split across the existing mission order:

1. **Mission 20 — Business Profile:** remains the canonical company identity and operating-policy authority. Later additive estimating fields may reference approved branding, service area, taxes, overhead, margin policy, labor policy, equipment policy, suppliers, and customer-document identity without rewriting accepted Mission 20 history.
2. **Mission 21 — Knowledge Architecture:** provides the versioned, tenant-scoped, provenance-bound publication and retrieval foundation. Later missions extend it additively for industry packs and cost knowledge; they do not make provider output authoritative or reopen accepted Mission 21 work.
3. **Mission 23 — Operations:** captures the real work records needed for later learning, including authorized job scope, time, material, equipment, schedule, change, completion, and outcome facts.
4. **Mission 24 — Estimating:** owns the canonical estimate engine, formal owner/estimator review, customer-ready estimate/proposal generation, and the first authorized Capella Risk Lens experience.
5. **Mission 25 — Polaris Learning:** owns tenant-private comparison of estimated and actual outcomes, comparable-job retrieval, drift detection, and founder-approved recommendations. It never silently changes pricing authority.
6. **Mission 26 — Predictive Intelligence:** may use accepted historical evidence for aggregate forecasting, uncertainty, and capacity or margin signals without turning a prediction into an approved estimate.
7. **Mission 27 — Customer Lifecycle:** owns the later quote, acceptance, invoice, refund, payment, and collection lifecycle. An invoice is not created by Polaris, Capella, or Mission 32 alone.
8. **Mission 28 — Automation:** may deliver approved estimates, reminders, or follow-up only through explicit role-authorized policies. Analysis never authorizes an external action.
9. **Mission 32 — Scenario Calculator:** adds the rapid, in-person, manually entered, non-binding planning workspace that uses the already accepted engines. It can explicitly hand an approved scenario to Mission 24, but it does not replace Mission 24 or create an invoice.

## Universal estimating architecture

### Common work-and-cost ontology

Every industry pack maps its specialized terminology into a shared structure:

- service, outcome, scope, exclusions, units, measurements, quantities, condition, complexity, quality, urgency, location, access, hazards, dependencies, and schedule;
- labor role, skill, crew composition, productive hours, burden, overtime, travel, setup, supervision, rework, and utilization;
- material quantity, unit, grade, waste, freight, tax, supplier, price, effective date, and availability;
- equipment ownership or lease allocation, financing or payment burden when entered, depreciation policy, utilization, operator time, fuel, maintenance, mobilization, transport, consumables, and downtime;
- subcontractors, permits, inspections, disposal, lodging, insurance allocations, payment fees, contingency, warranty, overhead, and target margin;
- customer-facing price, internal expected cost, confidence range, evidence, assumptions, unknowns, and approval state.

Industry-specific formulas and questions belong in versioned **Industry Packs**. The shared ontology makes the engines reusable; an industry pack supplies the trade-specific method.

### Versioned industry packs

Each pack must declare:

- supported services and explicit unsupported services;
- required, optional, and conditionally required intake questions;
- units, formulas, production-rate logic, crew and equipment needs, risk factors, exclusions, and document language;
- regional and time-sensitive inputs;
- source, source date, retrieval date, jurisdiction or geography, applicability, license or usage restrictions, evidence note, owner/approver, and expiry or review date;
- test cases, expected ranges, known limitations, and the exact pack version.

Only the current approved market or industry pack is enabled by default. Future packs remain disabled until researched, reviewed, tested, and explicitly activated. If a company selects an unsupported industry, NorthStar starts a guided research/review workflow or states that it cannot price responsibly; it does not improvise a quote.

### Authority order

When applicable and internally consistent, estimating evidence is ranked in this order:

1. locked actual facts from the tenant's completed comparable work;
2. current tenant-approved price book, labor policy, equipment policy, supplier quote, contract, or invoice;
3. current verified local or official source approved into the tenant's knowledge version;
4. reviewed versioned industry-pack reference;
5. explicit founder/administrator assumption;
6. AI-generated suggestion, which remains visibly unverified until a human approves it.

Conflicting higher-authority facts fail into review. A provider completion, model memory, simulation, or another tenant's data never becomes cost authority.

## Research and provider-use policy

NorthStar should not perform unrestricted internet research for every estimate, and it should not rely on a model having memorized every trade.

- Stable methods, definitions, formulas, and reviewed references are researched once, licensed or usage-checked where needed, source-dated, approved, versioned, and reused from canonical knowledge.
- Volatile local costs may be refreshed through an explicitly authorized on-demand or scheduled import from approved sources. The refresh produces a reviewable candidate version; it does not overwrite an accepted estimate or price book.
- Tenant quotes, invoices, catalogues, rate sheets, and completed-job records may be imported only with authorization, provenance, parsing review, and tenant isolation.
- The deterministic NorthStar calculation engine owns arithmetic, rounding, reconciliation, taxes, overhead, margin, and version replay.
- Polaris may use an approved bounded model call for extraction, clarification, comparison, explanation, or uncertainty analysis. Provider usage, budget, storage, logging, and fallback remain policy-bound. Reusing accepted canonical facts reduces repeated provider calls.
- If live research, a provider, or current evidence is unavailable, the result remains provisional or blocked instead of silently using stale or invented data.

## Tenant-private outcome learning

NorthStar becomes more useful by learning from authorized past and future jobs, not by copying other customers.

For every completed job, preserve the immutable relationship among:

- original scenario and estimate versions;
- approved customer price and change orders;
- expected versus actual labor, material, equipment, subcontractor, travel, permit, tax, schedule, revenue, cost, and margin;
- stated reasons for material variance;
- customer outcome, rework, warranty, cancellation, and payment result when authorized.

Comparable-job retrieval must combine structured filters and semantic similarity. It must consider tenant, industry, service, geography, scope, units, size, condition, complexity, crew, equipment, season, recency, and outcome. Sample size, distance from the current job, outliers, and evidence age must remain visible.

Mission 25 may recommend revised production rates, waste factors, labor assumptions, risk allowances, questions, or ranges. A human must approve a new version before it becomes estimating authority. Historical estimates and actuals remain immutable. Cross-tenant learning is prohibited unless a later separately authorized, privacy-preserving, legally reviewed aggregate program is defined.

## Required reasoning for unfamiliar industries

The system must reason from industry method plus job facts. For example, a land-surveying pack cannot merely ask for acreage and guess. Depending on service, it may need parcel and boundary complexity, deed and record research, monuments, terrain, vegetation, access, travel, control requirements, field crew time, GNSS or total-station use, drone eligibility, drafting, certification, filing, local requirements, schedule, risk, and company equipment economics.

That example is an acceptance case, not a land-surveying-only design. The same architecture must support a future reviewed pack for construction, repair, cleaning, professional services, field services, property operations, or another industry without placing trade-specific assumptions in the universal engine.

## Estimate readiness states

Every scenario or estimate must resolve to an honest state:

- **Ready for authorized review** — required evidence is present and validation passes.
- **Provisional range** — useful assumptions remain, with their effect visible.
- **Research required** — a material local, technical, supplier, regulatory, or market fact is missing or stale.
- **Site verification required** — remote information cannot responsibly establish scope or price.
- **Unable to price responsibly** — required capability, authority, or evidence is unavailable.

Confidence is not a decorative score. It derives from evidence coverage, comparable-job quality, input completeness, source age, applicability, and sensitivity. It must never conceal an unknown.

## Polaris and Capella

Polaris and Capella use one exact versioned scenario or estimate and have different jobs:

- **Polaris Recommendation:** the purple operational-intelligence view. It explains expected scope, price construction, resources, scheduling, opportunities, assumptions, evidence, unknowns, confidence, and recommended next action.
- **Capella Risk Lens:** the gold/amber downside-and-sensitivity view. When an authorized user asks about risk, downside, confidence, or what could go wrong, Polaris chat may place a native Capella card beside the Polaris recommendation. Polaris may offer that view when it detects material risk, but it does not silently open or run Capella as a second authority.

Capella must show material uncertainty, margin at risk, missing facts, downside range, cost or schedule sensitivity, capacity constraints, volatility, dependencies, and the facts that would change the answer. It uses the same canonical price and version as Polaris. It never presents a competing estimate, silently changes inputs, creates an obligation, or becomes an independent pricing authority.

Every conversation and card must look like a finished NorthStar product: concise professional prose, progressive disclosure, accessible native components, clear provenance and approval state, and no raw JSON, JSON Schema, code, code fences, stack traces, internal IDs or digests, provider bodies, prompts, or internal/provider error codes. Friendly failure states must still tell the user what is missing and what to do next.

## Customer-ready estimate and proposal boundary

Mission 24 must let an authorized owner or estimator turn a reviewed calculation into a polished formal estimate or proposal within minutes. The document may use the tenant's approved logo, business identity, contact details, license information when applicable, customer information, scope, options, exclusions, schedule assumptions, pricing, taxes, validity period, terms, and signature or acceptance workflow.

Internal cost, margin, risk, evidence, and model diagnostics remain private unless a specific field is deliberately approved for the customer document. Document generation pins the exact estimate, Business Profile, terms, template, and asset versions. Preview, PDF, print, and authorized delivery must agree. A later edit creates a new version.

Mission 27 separately owns invoices and payment lifecycle. A preliminary scenario, Polaris answer, or Capella card never creates an invoice or binding commitment.

## Mission 32 relationship

Mission 32 is the fast manual front door for an in-person, phone, or office conversation. An owner or authorized estimator can enter only what is known, ask follow-up questions, compare options, and get a non-binding explainable range. The scenario may invoke Polaris and, on explicit request, the Capella Risk Lens. Polaris may recommend opening Capella when material risk exists. Conversion to a formal Mission 24 estimate is always explicit and reviewed.

The detailed Mission 32 authority remains in `MISSION_32_SCENARIO_CALCULATOR.md` and must be read with this roadmap.

## Minimum acceptance evidence

Before these capabilities are called complete, require at least:

- exact-version replay and deterministic financial reconciliation;
- strict tenant, membership, role, field, and document-audience isolation;
- industry-pack schema, applicability, unsupported-service, source, age, conflict, and rollback tests;
- material, labor, equipment, financing/allocation, travel, tax, overhead, margin, contingency, and capacity reconciliation;
- comparable-job relevance, sample-size, recency, outlier, drift, approval, and immutable-history tests;
- explicit no-fabrication tests for unsupported industries, missing local rates, incomplete scope, unavailable research, and provider failure;
- one unfamiliar-industry proof such as land surveying and multiple materially different industry packs proving that the universal engine contains no hidden home-services-only assumptions;
- Polaris and Capella same-estimate/same-version tests, no competing price, no hidden mutation, and professional presentation across every display-bearing field;
- manual Scenario Calculator save, revision, duplicate, archive, conversion, and no-silent-record-creation tests;
- customer-document logo/identity/version, internal-field exclusion, preview/PDF/print parity, hostile-content, and explicit-delivery tests;
- mounted production modules, disposable PostgreSQL, concurrency, restart, replay, tamper, bounded-provider interception, full regression, Chrome, actual Playwright WebKit, narrow widths, reflow, keyboard, focus, semantics, themes, and reduced-motion evidence;
- a fresh independent exact-head audit, normal serialized release, exact deployment acceptance, and separate founder visual approval.

## Non-goals and hard boundaries

- No promise that NorthStar knows every industry before a reviewed pack exists.
- No real-time web or provider call as a mandatory hidden dependency for every estimate.
- No provider/model memory as canonical evidence.
- No cross-tenant leakage or unapproved pooled learning.
- No silent research import, assumption change, price-book mutation, or automatic recalibration.
- No replacement for a licensed professional, code or permit review, site visit, supplier confirmation, or contractor judgment where required.
- No automatic customer contact, scheduling, crew assignment, material order, contract, invoice, payment, or other external commitment from analysis alone.
- No retroactive rewrite of an accepted scenario, estimate, quote, invoice, or actual result.
