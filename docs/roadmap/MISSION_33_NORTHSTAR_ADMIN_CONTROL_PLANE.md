# Mission 33 — NorthStar Platform Administration and Company Intelligence

## Status

Future mission. Mission 33 begins only after the platform emits trustworthy canonical account, subscription, financial, product-usage, reliability, support, security and administrative facts. Earlier missions may add compatible instrumentation, but they must not create a competing platform-admin authority.

## Product outcome

Create the private NorthStar-operator control plane for the founder and future explicitly authorized platform staff. It must give NorthStar the clearest possible understanding of company growth, customer health, revenue, costs, profitability, product use, intelligence quality, infrastructure, support, security and risk while preserving tenant privacy and exact source provenance.

Mission 33 is distinct from a contractor company's owner/admin workspace and from Mission 29's tenant enterprise-administration features. It analyzes and operates NorthStar itself.

## Experience model

The home view remains concise and decision-focused. It shows the most important outcomes, changes, active risks, anomalies, data freshness and required actions. Deeper information lives in dedicated workspaces with filters, cohorts, comparisons, saved views and progressive drill-down:

`NorthStar → segment → company → metric → canonical source`

The control plane must not become one enormous table or an unlimited hidden backdoor. Every metric has an owner, definition, grain, source, freshness state, coverage, calculation version and permitted drill-down.

## Required workspaces

### 1. Founder and executive overview

- Paying, trialing, past-due, canceled, expired and inactive organizations
- MRR, ARR, collected revenue, recognized revenue, gross margin and runway
- New accounts, activation, trial conversion, retention and churn
- Material risks, anomalies, incidents, customer impact and decision queues
- Actual-versus-plan and actual-versus-forecast summaries

### 2. Companies, accounts and lifecycle

- Company and account inventory, plans, industries, industry packs, locations and users
- Signup, verification, onboarding, activation, adoption, expansion, downgrade, cancellation and reactivation funnels
- Retention cohorts, churn reasons, account health, support status and authorized company-level drill-downs
- Trial age, time-to-value, conversion, lifecycle transitions and failed lifecycle operations

### 3. Revenue, billing and accounting intelligence

- Subscriptions, invoices, payments, refunds, disputes, credits and failed collections
- MRR, ARR, expansion, contraction, churned recurring revenue and average revenue per account
- Cash collection, deferred and recognized revenue, tax boundaries and jurisdictional reporting inputs
- Payment-provider reconciliation, webhook health and unresolved billing mismatches
- Actual, allocated, accrued, forecast and unknown states kept visibly distinct

### 4. Cost, profitability and company economics

- Provider, model, infrastructure, storage, database, queue, email, calling and payment-processing costs
- Payroll, contractors, software, insurance, legal, accounting, sales, marketing and other operating expenses
- Gross margin, contribution margin, customer acquisition cost, lifetime value, payback, burn and runway
- Cost and profitability by time period, plan, cohort, industry, feature, provider and company segment when evidence permits
- Investor-calculator-compatible cost taxonomy without allowing forecasts to overwrite actual history

### 5. Product, workflow and adoption analytics

- Usage and adoption across leads, customers, calls, estimates, quotes, scheduling, jobs, invoices, payments, communications, integrations and automation
- Funnel completion, time-to-value, feature retention, workflow abandonment and outcome measures
- Desktop and mobile usage, role-based usage and released-industry coverage
- Bounded tenant drill-downs for support and diagnosis only when role, purpose and audit requirements permit

### 6. Polaris and Capella intelligence analytics

- Volume, success, failure, latency and cost by capability and provider
- Evidence coverage, source freshness, uncertainty, human review and override rates
- Estimate-to-actual variance, recommendation adoption and quote conversion
- Model, prompt, contract and engine versions with safe performance comparisons
- No default access to raw tenant content, transcripts, prompts or customer documents

### 7. Platform, provider and integration health

- Database, queue, deployment, background-job, storage, email, calling and integration health
- Availability, error rates, latency, saturation, failed jobs, retries and recovery
- Provider incidents, degraded dependencies, affected companies and customer impact
- Data freshness, synchronization health, reconciliation failures and unresolved operational risks

### 8. Industry and knowledge operations

- Industry-pack coverage, versions, freshness, research status, evidence quality and release readiness
- Knowledge ingestion, review queues, conflicts, failures, usage, cost and downstream impact
- Pack adoption, company fit, unsupported requirements and expansion opportunities
- Exact boundaries between reusable shared knowledge and tenant-private operating data

### 9. Support, trust, security and privacy

- Support demand, response and resolution performance, issue categories and affected workflows
- Security events, privacy requests, consent state, data exports and deletion workflows
- Administrative access, sensitive-data views, impersonation or support-session controls and immutable audit evidence
- Incident timelines, containment, recovery, customer communication and post-incident actions

### 10. Reports, alerts and decisions

- Custom and standard reports with governed metric definitions
- Saved views, comparisons, cohorts, scheduled summaries and role-appropriate exports
- Anomaly alerts with thresholds, evidence, acknowledgement and resolution state
- Decision queues that link each recommended action to its source metrics and responsible role

## Roles and access

Mission 33 supports separate Founder/Platform Owner, Finance, Operations, Support, Security, Analyst and Read-only/Auditor workspaces. Access is least-privilege, purpose-bound, tenant-aware, recently authenticated where risk requires it, and fully audited. A tenant owner/admin role never grants NorthStar platform-administrator authority.

Sensitive company drill-downs require explicit authorization and must expose only the minimum necessary data. Raw tenant content is unavailable by default. Support access, exports, administrative actions and any controlled company-session capability require bounded scope, attribution, expiration and immutable audit evidence.

## Metric and evidence authority

- A canonical metric registry defines name, plain-language meaning, owner, formula, units, grain, filters, source authority, freshness, coverage and version.
- Dashboard projections are reproducible from durable PostgreSQL authority and authorized provider evidence.
- Estimates, forecasts and allocations are labeled and never overwrite actual history.
- Unknown, unavailable, stale, conflicting and partial states remain visible rather than becoming zero.
- Financial totals reconcile to their source systems and keep collected tax separate from NorthStar revenue.
- Cross-company aggregates prevent unauthorized disclosure of another company's records or commercially sensitive data.
- Every displayed result supports a bounded path back to the evidence a permitted user may inspect.

## Relationship to other missions

- Mission 26 predicts a contractor's business; Mission 33 analyzes NorthStar as a software company.
- Mission 29 governs advanced roles, locations and enterprise controls inside customer tenants.
- Mission 30 unifies the customer-facing NorthStar operating system and validates v1.0 readiness.
- Mission 31 demonstrates the product through isolated simulated businesses.
- Mission 32 provides the contractor-facing On-the-Fly Calculator.
- Mission 33 consumes accepted upstream authority and does not rebuild those systems.

## Acceptance gates

- Durable PostgreSQL authority and versioned canonical metric registry
- Exact reconciliation tests for subscriptions, payments, taxes, revenue, costs and headline KPIs
- Tenant isolation, least-privilege, sensitive-access, audit, export and deletion tests
- Freshness, missing-data, partial-data, correction, replay and provider-failure behavior
- Representative scale, latency, query-cost and bounded-export validation
- Desktop, tablet and mobile validation in Chrome and actual Playwright WebKit
- Role-specific usability review, accessibility review and founder visual verdict
- Independent security and release audit at an immutable ref
- Normal merge, exact automatic deployment, health, passive production acceptance and final-ref seal

## Explicit non-goals

- A customer-facing dashboard shared across unrelated businesses
- One universal administrator role with unrestricted hidden access
- Vanity metrics without definitions, sources or operating decisions
- Treating forecasts, allocations or estimates as actual accounting history
- Default inspection of raw tenant conversations, documents or private operating records
- Replacing finance, tax, legal, security or privacy professionals with dashboard output
- Starting Mission 33 before the platform supplies trustworthy source facts
