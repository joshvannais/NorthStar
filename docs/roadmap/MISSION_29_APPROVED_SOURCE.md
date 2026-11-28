# Mission 29 Enterprise Platform — proposed complete part and slice plan

Status: PROPOSED FOR SCOPE REVIEW. This is a newly written breakdown of the existing eight-phase roadmap. It is not an approved frozen plan, implementation evidence, or permission to alter production. No Mission29 implementation branch, PR, writer, deployment, provider action, or production-data change has started.

Prepared: 2026-11-28.
Proposed structure: **8 serialized parts / 44 slices**.
Proposed exact order: **1A–1F, 2A–2G, 3A–3E, 4A–4E, 5A–5E, 6A–6D, 7A–7F, 8A–8F**.
First implementation slice after scope approval: **1A — authority, current inventory, and acceptance contract**.

## Authority and verified starting point

The retained authoritative roadmap defines Mission29 as Enterprise Platform, with the objective of scaling NorthStar into a multi-location enterprise platform. Its eight phases are Multi-Location Architecture; Permissions and Roles; Regional Intelligence; Franchise Support; Enterprise Reporting; White Label Support; Enterprise API; Validation. This proposal preserves those eight phases in that order.

Source direction was recovered from:
- C:/Users/joshv/.codex/memories/extensions/ad_hoc/notes/20260807-184816-northstar-missions-20-31-authoritative-roadmap.md, Mission29 section.
- C:/Users/joshv/.codex/memories/extensions/ad_hoc/notes/20260807-090332-northstar-workforce-assignment-tier-entitlements.md: individual accounts; intersection of plan entitlement, server-authoritative permission, and record scope; security is never premium-only; safe downgrade and data retention.
- C:/Users/joshv/.codex/memories/extensions/ad_hoc/notes/2026-08-05-enterprise-asset-integrations-polaris.md: Mission29 enterprise administration and integration governance, preserving the earlier missions' operational and integration authorities.

These retained notes establish product direction. They do not prove implementation, provider readiness, or production authorization.

Fresh read-only checks found:
- Canonical GitHub main: 94781a2e77e129a1383479ff97e334c399d28b92.
- Mission28 final PR614 is merged and its complete 14-part/66-slice release is accepted within its stated scope.
- Mission28 source has 285 migrations through289; no Mission29 migration is proposed by this document.
- No Mission29 plan file was found in the accepted source, current planning directories, or targeted local filename search.
- No matching Mission29 implementation branch or PR was found in the targeted remote checks.
- The historical canonical executor is readable but is an old Mission19 record; its old snapshot is not the current release authority.
- Agent inventory showed only root active. No writer or auditor was started.

Repository authority to preserve includes the accepted Mission28 roadmap and ledger, the fixed capability matrix, and the Mission21–28, Mission30 and Mission33 boundaries. Mission29 governs enterprise administration inside customer tenants. Mission33 governs NorthStar's own operator administration. Mission30 integrates the OS; Mission31 owns the separate public guided simulation.

## Mission-wide invariants

1. Extend accepted canonical authorities additively. Preserve history, immutable migration bytes, and existing individual-tenant behavior. Do not rewrite earlier mission ownership for convenience.
2. Organization, tenant/company, location, region, franchise network, actor, session, membership, role version, capability, and record scope are distinct authorities. A display label, parent relationship, brand, API credential, report, or franchise relationship does not confer access.
3. Resolve access on the server from exact current identity, membership, entitlement, permission and record scope. Missing, ambiguous, stale, revoked, cross-tenant, wildcard or conflicting authority denies. UI visibility cannot authorize an API request.
4. Keep individual accounts and core permission separation safe in every paid tier. Do not invent prices, seat limits, plan names, automatic billing changes or provider entitlements.
5. Shared ownership, corporate structure or a franchise relationship never implies permission to read another company's private records, customer data, worker data, financial facts or learning evidence.
6. Read models retain source identity, version, freshness, coverage, units, currency and time-zone semantics. Missing coverage remains unknown or partial; an unavailable value is not zero. Never combine incompatible financial quantities silently.
7. Preserve current scheduling, work, estimating, learning, forecasting, financial and automation authorities. Enterprise administration cannot execute their consequential operations by bypassing their existing approval, stop, idempotency or currentness gates.
8. Make location, role, membership and integration changes versioned and attributable, with explicit effective state, revocation, concurrency and recovery behavior. Historical records retain their original scope and provenance.
9. Do not copy private paid records into a demo or create parallel demo calculations. Existing isolated demos consume the shared engines where applicable; Mission31's new guided experience remains separate.
10. No real recipient or message, provider sandbox/live call, live money, automatic financial effect, destructive production data change, TLS weakening, exposed secret, legal conclusion or automated founder visual approval is authorized by this proposal.
11. Actual identity-provider setup, external enterprise connectors, domain/DNS/certificate provisioning, production credentials and provider account changes require their own exact authorization and evidence. A local fixture or adapter contract does not prove those integrations live.
12. Any newly discovered material product decision is documented with concrete alternatives before the dependent implementation proceeds. Routine reversible implementation choices follow the accepted scope without repeated permission requests.

## Part 1 — Multi-Location Architecture (6 slices)

Purpose: establish enterprise context and location boundaries without weakening existing tenant isolation or duplicating Business Profile identity.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 1A | **Authority, current inventory and acceptance contract.** Audit exact live main and the mounted organization, tenant, location, workforce, membership, entitlement and operational consumers. Record existing behavior, gaps, protected paths and source-linked evidence. Publish the complete approved Mission29 plan and acceptance ledger through the normal source lane. No runtime change in this slice. |
| 1B | **Canonical organization/location identity contracts.** Define immutable identities, explicit relationships, duplicate/unknown handling and provenance while preserving Mission20's company and Business Profile authorities. Any additive persistence includes complete compatibility, migration and rollback disposition. No automatic adoption or reassignment of old records. |
| 1C | **Authenticated enterprise context.** Resolve exact active actor/session/membership and selectable location context on the server. Test foreign actors, forged locations, stale context, revoked membership, omitted scope and simultaneous sessions. Existing single-location accounts retain their established behavior. |
| 1D | **Location lifecycle and historical scope.** Define reviewed creation, activation, deactivation, naming and correction behavior with optimistic concurrency and immutable history. Record relocation/transfer as an explicit governed transition; do not silently move historical jobs, customers or financial ownership. |
| 1E | **Mounted location selection and navigation.** Add a coherent accessible location context to relevant existing company surfaces. Show current scope, loading, unavailable, empty and recovery states. Scope switching cannot leak cached records or alter an unrelated active workflow. |
| 1F | **Architecture persistence and boundary validation.** Prove repository reload, restart, concurrent changes, forced tenant/location isolation, rollback and upgrade compatibility with actual disposable PostgreSQL and mounted HTTP consumers. Reconcile every applicable existing consumer before Part2. |

## Part 2 — Permissions and Roles (7 slices)

Purpose: add enterprise governance while keeping entitlements, permissions, authentication assurance and record scope distinct.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 2A | **Versioned enterprise capability contract.** Inventory exact accepted operations and define explicit capability/operation/scope mappings. Preserve earlier fixed matrices and vocabulary; no fuzzy aliases, wildcard grants or silent elevation of an existing role. |
| 2B | **Custom-role definitions and lifecycle.** Persist versioned bounded role definitions, review state and active/revoked state. Prevent unknown capabilities, privilege escalation, self-elevation and role-definition races; previous versions remain attributable. |
| 2C | **Scoped assignment and membership resolution.** Implement actor-specific role assignments and location/region/record scopes with exact current membership checks. Test grant, expiry, revocation, cross-session and concurrent assignment behavior. Delegated assignments never expand their granting authority. |
| 2D | **Delegation and approval governance.** Define explicit bounded delegation, approval thresholds, separation of duties and self-approval restrictions for operations whose existing contracts support them. A threshold or enterprise role cannot waive an upstream approval or effect gate. Unsupported combinations deny. |
| 2E | **SSO/MFA assurance policy and adapter boundary.** Implement provider-independent assurance requirements, exact session evidence, expiry, step-up and local controlled adapter tests. Preserve existing safe access and recovery. Actual identity-provider account setup or live federation remains separately authorized and unclaimed until demonstrated. |
| 2F | **Revocation, ownership recovery and audit.** Make grants, revocations, ownership-sensitive changes and bounded recovery attributable and concurrency-safe. Define stale-session and in-flight-operation behavior; never claim cancellation or external effect reversal without evidence. |
| 2G | **Permissions administration experience and complete gate.** Provide accessible role/assignment/policy review with clear consequences, denied states, evidence and recovery. Validate actual mounted enforcement, real SQL isolation and negative capability matrices across the whole Part2 scope. |

## Part 3 — Regional Intelligence (5 slices)

Purpose: provide permission-filtered regional oversight from canonical company/location evidence.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 3A | **Region definitions and authorized membership.** Version region/location mappings with explicit effective state, overlap rules and authorized visibility. A regional grouping is not a new tenant or access grant. |
| 3B | **Canonical regional read model.** Aggregate only records the actor may read. Pin source versions and expose coverage, partial/unavailable states, time zones, units, currencies and cutoff rules. Avoid double counting overlapping regions or repeated source records. |
| 3C | **Regional explanations and comparisons.** Reuse Mission25/26 learning and forecasting evidence without recalculating or asserting unsupported causality. Separate actuals, forecasts, assumptions and stale/insufficient evidence; retain authorized location drilldown. |
| 3D | **Regional workspace and navigation.** Render accessible comparison, filters, source explanations and location handoffs with honest loading, empty, partial, denied, stale and recovery states. Never reveal inaccessible locations through counts or errors. |
| 3E | **Regional correctness and isolation gate.** Execute independent aggregation counterexamples, overlap/missing-data cases, time-zone boundaries, permission revocation, mounted HTTP and actual PostgreSQL checks. No cross-company learning or data pooling is implied. |

## Part 4 — Franchise Support (5 slices)

Purpose: support explicit franchise administration while preserving each company's data and operating authority.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 4A | **Franchise relationship and authority model.** Define network, franchisor, franchisee, company and location relationships as explicit versioned records. Do not infer legal ownership, contractual rights or access from a business relationship or brand. |
| 4B | **Participation and delegated visibility.** Implement exact governed participation, membership and capability scopes. Each company's authorization remains required for its records; absence or revocation denies reads, reports and operations. |
| 4C | **Shared configuration proposals and adoption.** Permit bounded authorized templates or policy proposals with provenance, version pinning and explicit local adoption. A network proposal never silently changes a franchisee's pricing, finance, workforce, automation or communications. |
| 4D | **Change, revocation and offboarding.** Preserve historical evidence and isolate current access when participation or delegation changes. Test stale sessions, partial revocation, concurrent administration and safe recovery without destructive data transfer or deletion. |
| 4E | **Franchise administration and whole-part gate.** Provide company-scoped administration, explanations and audit history. Validate all boundaries through mounted consumers, actual SQL and adversarial multi-company fixtures; no network-wide private-data access by default. |

## Part 5 — Enterprise Reporting (5 slices)

Purpose: deliver source-backed reporting at exactly the actor's authorized scope.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 5A | **Reporting definitions and evidence contract.** Inventory canonical measures and define scope, coverage, date/cutoff, time zone, currency, freshness, lineage and uncertainty for each report. Preserve Mission24–27 calculation and financial truth. |
| 5B | **Bounded report queries and comparisons.** Implement permission-filtered queries, grouping, pagination and location/region comparisons with deterministic limits. Prove duplicate suppression, partial coverage and stable source identity under concurrent updates. |
| 5C | **Saved report definitions.** Version authorized report settings and scope references without persisting a broad access grant or treating an old snapshot as current. Re-evaluate permissions whenever a saved report is opened. |
| 5D | **Explicit exports and disclosure controls.** Add bounded user-requested exports with exact scope, attribution and current permission checks. Preserve spreadsheet/content safety and sensitive-data minimization. No automatic external email, scheduled recipient or provider delivery is introduced. |
| 5E | **Enterprise reporting experience and gate.** Provide accessible reports, source drilldown and export feedback with partial/unavailable/denied/recovery states. Independently verify calculations, real SQL, mounted HTTP, cache isolation and readable output across authorized roles. |

## Part 6 — White Label Support (4 slices)

Purpose: support bounded company branding without changing the operating product's identity, security or evidence.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 6A | **Scoped branding configuration and assets.** Persist versioned authorized display branding and validate uploaded/referenced assets with safe type, size, URL and rendering boundaries. Never allow script/style injection, foreign-tenant assets or credential-bearing URLs. |
| 6B | **Shared branded rendering and fallback.** Apply branding consistently through the shared shell and applicable existing surfaces. Preserve accessible contrast, responsive layouts, system/error states, safe fallback and canonical tenant context; no parallel product logic. |
| 6C | **Domain and communications identity boundaries.** Define explicit domain/brand claims, verification state, account recovery and disclosure ownership. Domain/DNS/certificate provisioning and sender/provider changes remain separately authorized operations; unverified branding cannot authorize a domain or recipient identity. |
| 6D | **White-label acceptance and recovery gate.** Verify cross-tenant isolation, unsafe content denial, cache/version transitions, branding rollback and full light/dark desktop/mobile renders. Legal/disclosure content and founder visual approval remain separate. |

## Part 7 — Enterprise API (6 slices)

Purpose: expose bounded enterprise access through canonical operations and exact authorization.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 7A | **Versioned API and capability inventory.** Define the exact initial API surface from accepted enterprise use cases and canonical resources. Record methods, schemas, errors, pagination, versioning, scope and exclusions. Do not invent new operational effects merely to fill an API catalogue. |
| 7B | **Principal, credential and session authority.** Define bounded machine/user principals and locally test issuance/rotation/revocation semantics without exposing secrets or creating production credentials. Enforce exact tenant, actor, grant, audience, expiry and capability scope; possession alone cannot broaden access. |
| 7C | **Authorized read and report endpoints.** Mount bounded canonical read/report operations with pagination, current permission checks, cache controls, error minimization and deterministic limits. Test field-level and record-level disclosure, foreign identifiers and scope omission. |
| 7D | **Explicit mutation handoffs and idempotency.** Expose only already-authorized canonical mutations whose existing acceptance contracts are satisfied. Preserve actor attribution, currentness, approval, concurrency, idempotency and recovery. External provider, money and destructive effects remain unavailable without separate authority. |
| 7E | **Integration governance and extension contracts.** Govern connector identity, granted scope, source mapping, provenance, freshness, revocation and observed outcomes. Local controlled adapters prove contracts only; no real connector/provider calls, background synchronization or outbound webhook delivery is enabled by this slice. |
| 7F | **API documentation and whole-part acceptance.** Deliver exact examples, schemas and failure/recovery semantics plus actual mounted HTTP/SQL tests, adversarial authorization, bounded-load and compatibility checks. Publish provider-readiness gaps truthfully rather than describing adapters as live integrations. |

## Part 8 — Validation (6 slices)

Purpose: prove the complete accepted enterprise scope and release it without confusing automated evidence with separate human/provider approval.

| Slice | Deliverable and acceptance boundary |
| --- | --- |
| 8A | **Complete authority and inventory reconciliation.** Reconcile all44 planned slice identities, accepted sources, migrations, mounted consumers, documentation and unclaimed gates against exact main. Identify every unfinished or inconsistent accepted requirement. |
| 8B | **Actual PostgreSQL, isolation and concurrency campaign.** Run the complete applicable enterprise and retained regression corpus in fresh disposable role-separated databases. Prove persistence/restart, RLS, role revocation, shared-scope denial, optimistic concurrency, idempotency and recovery with non-vacuous adversarials. |
| 8C | **Mounted journeys, failure and recovery.** Exercise end-to-end company/location/role/region/franchise/report/branding/API journeys through actual consumers, including partial evidence, stale authority, outages, denied actions and recovery. No private production writes are used as test fixtures. |
| 8D | **Shared rendering, accessibility and demo parity.** Validate genuine Chrome and Playwright WebKit, desktop/mobile, light/dark, keyboard/focus and native pointer/touch behavior where relevant. Use shared engines with isolated fictional sources; retain Mission31's separate public guided-simulation scope. Physical devices/manual AT/founder approval remain distinct. |
| 8E | **Security, bounded performance and operational readiness.** Audit sensitive-data exposure, privilege boundaries, resource limits, migration compatibility, operational observability and documented recovery. Report exact environment and limits; local load tests are not production SLA or disaster-restore evidence. |
| 8F | **Final independent audit and release ledger.** Complete a fresh isolated full-history whole-scope exact-head audit with zero P0–P3, same-writer additive corrections and full new audit after any SHA change. Complete normal exact-head GitHub review, guarded normal merge, required fresh backup/standing rotation, one automatic deployment, exact commit/image/startup and authorized read-only production reconciliation/health/render checks. Publish the truthful final source-linked ledger and all separate unavailable evidence. |

## Serialized implementation and acceptance discipline

The table order is the proposed execution order. Each accepted slice extends the previously accepted live main; do not overlap writers, branches, audits, test campaigns, PRs or deployments.

Use one implementation writer and a separate independent auditor/release owner. Writer assertions and green tests never substitute for independent review. Existing agent inventory contained no active writer; the writer lane must be explicitly established under the accepted operating model before a product change. Do not reuse historical Mission19 instructions or create competing implementation agents.

For every slice:
- Freeze the complete intended scope, exact clean source/base/tree and protected-path ledger.
- Use additive commits and a normal PR. No force push, hidden history rewrite, bypassed review, unreviewed merge or manual Railway redeploy.
- Audit every cumulative affected path and applicable retained contract. Classify every finding P0–P3; route corrections to the same writer, then perform an entirely new independent exact-head whole-scope audit.
- Execute meaningful actual persistence/HTTP/browser checks appropriate to the change; never substitute string assertions or mocks for a real authority path. Record all skipped or unavailable checks honestly.
- Any migration requires source/applied checksum compatibility, schema and data safety, rollout/rollback disposition, and the required confirmed production backup. Never modify historical migration bytes or perform destructive production changes.
- Require the normal exact-head review and all accepted release gates before normal guarded merge. Observe exactly one automatic deployment for an accepted release; bind exact merged commit, image and instance. Never manufacture green hosted CI when lists are empty.
- Production verification remains bounded and read-only, with no real recipient/provider/money effects. Any authorized temporary task SSH key is removed immediately, with remote and both local files/directory cleanup verified even on failure.
- Confirm a new required backup's exact ID and external snapshot identity before deleting older backups, retaining one newest confirmed copy under the user's standing automatic rotation rule. Never delete the last backup or resize a volume from this plan.
- Reconcile the source-linked ledger with earned release facts. Preserve historical failures, superseded findings and separate founder/provider/live/private-production/physical/manual/professional/restore gates.

A slice is not accepted merely because its document exists, a writer reports success, an automated screenshot looks correct, or one test passed. Mission29 is not complete until every accepted requirement is evidenced within the approved scope and the final8F release is terminally accepted.

## Scope decisions this proposal does not silently make

- Exact organization/franchise ownership and disclosure rules must be derived from current canonical authorities and explicitly reviewed product decisions, not assumptions about legal relationships.
- Actual SSO provider/protocol choices and provider configuration remain unsettled until current approved requirements and official contracts are available.
- Plan names, prices, allowances, seat/location limits and commercial upgrade/downgrade terms remain separate; basic security cannot depend on buying a premium tier.
- Custom-domain ownership/provisioning, mail/SMS identity, external enterprise connectors and real webhook delivery remain separate provider/production actions.
- Enterprise API resource expansion must follow accepted use cases and capability contracts; this plan does not authorize a general-purpose cross-tenant administration API.
- Mission33 operator administration and cross-customer analytics remain outside Mission29.
- The 8-part/44-slice count is proposed, not retroactively attributed to an earlier user approval. Changes to this count or order require an explicit recorded scope decision.

## Requested scope disposition

Approve or revise this complete **8-part/44-slice** proposal before it becomes the frozen implementation authority. The user's instruction to start when the parts and slices are defined is already recorded; approval of this newly written scope would satisfy that missing condition and make **1A** the next slice. No second routine start-permission request is intended.

Until that disposition, preserve the accepted Mission28 release, leave production unchanged, and describe Mission29 accurately as planning prepared / implementation not started.

