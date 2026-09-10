# Mission24 existing estimate writer and consumer inventory

Baseline: released commit `29c4ce9f9438141a0113f73f457693c6a105d2b0`. This is a source inventory of the canonical estimate authority and reachable adapters, not a runtime coverage claim or a declaration that legacy estimating code does not exist. Paths refer to this baseline; line numbers are locator aids. No executable files changed in this package.

## Persistent write and direct read ownership

| Source | Role and boundary |
| --- | --- |
| [canonicalGraphService.js](../../src/services/canonicalGraphService.js) 316–464 | Sole production SQL insertion of `canonical_estimates`, at398; calculates at328, inserts associated snapshot at428. `executeCanonicalGraph` at464 is wrapped by simulation/demo/Retell/voice/lead ingestion exports. Stored `customer_price` is calculated output, not evidence of human quote approval. |
| [canonicalPolarisCalculation.js](../../src/services/canonicalPolarisCalculation.js) 356 | Canonical calculator, not persistence. Only production direct callers found are graph service and public homepage calculation. Material lookup142–146 uses service/material reference; version6 is `m19-part3-canonical-v2`. |
| [simulations.js](../../src/routes/simulations.js) 117; [canonicalLeads.js](../../src/routes/canonicalLeads.js) 69 | Authorized simulation and lead-ingestion adapters call the graph writer. Lead listing also consumes canonical graph reads. |
| [canonicalRetellIngestion.js](../../src/services/canonicalRetellIngestion.js) 182/308; [voice/webhook.js](../../src/voice/webhook.js) 494 | Retell/voice ingestion chooses canonical wrapper; provider availability and delivery are not established by this inventory. `ingestDemo` exists as an exported wrapper but no production caller was found. |
| [canonicalPolaris.js](../../src/routes/canonicalPolaris.js) 203,223–282,420–462 | Direct estimate join; checks persisted snapshot and scheduling agreement; graph list/page/detail read authority and projections. |
| [repository.js](../../src/persistence/v2/repository.js) 218–257 | `getGraphByOperationId` joins estimate identity and snapshot for a graph receipt. Export retained; no production invocation found in the searched source. Not a second writer. |
| [demoVoiceLifecycle.js](../../src/services/demoVoiceLifecycle.js) 33 | Reads operation result and canonical snapshot for demo voice lifecycle. Indirect estimate-output consumer; does not insert estimates. |
| [004 migration](../../migrations/004_canonical_persistence_v2.sql), [005 migration](../../migrations/005_canonical_organization_authority.sql), [007 migration](../../migrations/007_canonical_tax_authority.sql) | Schema/immutability, profile authority and tax constraints respectively. Test seed INSERTs are fixtures, not production ingestion. No migration changes authorized. |

## HTTP and server projection consumers

[server.js](../../src/server.js) 253–283 mounts canonical routes at `/api/v1/canonical`; compatibility routes precede older routers at both `/api/v1` and `/api`. Inspect mount order when changing authority; a similarly named legacy handler is not automatically active.

| Consumer family | Current paths / function | Meaning |
| --- | --- | --- |
| Canonical graph | `GET /graphs`, `/graphs/:id`, `/snapshots/:id`; `listCanonicalGraphPage`, `listCanonicalGraphs`, `getCanonicalGraph` | Persisted graph/snapshot values. |
| Shared surfaces | `GET /surfaces/:surface`, `/compat/:surface` | Eight allowed projections: customer-detail, leads, communications, calendar, command-center, polaris, executive, estimates. |
| Aggregate | `GET /dashboard`, `/analytics` | Aggregates persisted graph output; estimated revenue is not collected revenue or approved quote value. |
| Assistant | `/polaris/assistant/status`, `/context`, `/messages`; [assistantContract.js](../../src/polaris/assistantContract.js) 345–393 | Minimized authorized context pins graph/snapshot/digest and missing calculation data. Chat does not establish quote approval. |
| Command center | [commandCenter.js](../../src/routes/commandCenter.js) 88/135 | Canonical page/detail readers; presentation/workspace adapters consume graph output. |
| Scheduling | Canonical overview/operator-overview, availability/conflicts/recommendations/previews/approvals and appointment mutation routes | Graph-related scheduling consumers; appointment approval does not approve an estimate price. |
| Compatibility records | `/customers`, `/customers/:id`, `/communications`, `/communications/:id`, `/opportunities`, `/opportunities/pipeline`, `/opportunities/:id`, `/leads`, `/leads/:id`, `/leads/:id/intelligence`, `/calls`, `/appointments` | Shared canonical record shapes; details include estimate-derived values through the graph. |
| Compatibility estimating | `/financial/estimates`, `/financial/estimates/:id`, `/financial/metrics`, `/polaris/estimates`, `/polaris/intelligence`, `/polaris/recommendations`, `/polaris/learning`, `/polaris/pipeline`, `/polaris/retell-context`, `/polaris/business-context`, `/polaris/unified-context` | Read projections only; names such as learning do not prove Mission25 completion. |
| Compatibility summaries | `/analytics/executive`, `/analytics/kpis`, `/analytics/dashboard`, `/analytics/alerts`, `/analytics/trends`, `/analytics/pipeline`, `/analytics/by-service`, `/dashboard/overview`, `/dashboard/{summary,revenue,brief,coach,kpis,trends,revenue-trends,status}`, `/stats`, `/leads/intelligence/dashboard`, `/workflows/agenda/today`, `/calendar/events`, `/calendar/upcoming` | Aggregate or schedule projections. Full registrations are in canonicalPolaris1450–1596. |
| Legacy writes | `legacyWriteBlocked` in canonicalPolaris1496 onward; includes POST `/financial/estimates` and `/polaris/estimate` | Intercepts old mutation routes with409. Do not revive a file/browser price writer. Existing error wording is not changed or certified by this docs-only package. |

## Browser sinks and synthetic exceptions

| Source / rendered host | Flow and boundary |
| --- | --- |
| [canonical-intelligence.js](../../public/js/canonical-intelligence.js) 176–318/380 | Validates graph identifiers, provenance and timestamps; loads canonical surface/compatibility projections selected by host metadata. This is a display cache, not an estimate writer. |
| [app-store.js](../../public/js/app-store.js), [polaris-api.js](../../public/js/polaris-api.js) | In-memory compatibility records; derived price selects persisted `customerFacingPrice`. Legacy mutations are blocked; no durable approval authority here. |
| [polaris-engine.js](../../public/js/polaris-engine.js), [polaris-ui.js](../../public/js/polaris-ui.js), [polaris-m13-bridge.js](../../public/js/polaris-m13-bridge.js) | Read-only selectors/rendering and old-shape bridge. |
| [customer-detail.js](../../public/js/customer-detail.js), [analytics-engine.js](../../public/js/analytics-engine.js), [calendar-engine.js](../../public/js/calendar-engine.js), [communications-engine.js](../../public/js/communications-engine.js) | Customer drawer, analytics, calendar and communications display consumers. Native/trusted Polaris presentation helpers format display and assistant cards, not prices. |
| [command-center-page.js](../../public/js/command-center-page.js) and [workspace.js](../../src/commandCenter/workspace.js) | Owner dashboard/work detail rendering and graph-to-workspace adaptation. Workspace also creates fictional demo snapshots; those must not be confused with persistent canonical calculations. |
| `public/dashboard/{lead,leads,communications,calendar,command-center,polaris,executive-brief}.html` | Explicit `northstar-canonical-surfaces` metadata; lead/leads include estimates. Customer drawer can expose associated estimate advice. |
| `public/dashboard.html`, `public/demo-dashboard.html` | Command-center projection hosts; synthetic demo interception is handled by [demo-runtime.js](../../public/js/demo-runtime.js) 406. |
| [demo.js](../../src/routes/demo.js) 100–124; workspace225–485 | Token-scoped demo workspace → `demoCanonicalItems` → same surface/compatibility projection. Some fictional snapshots are constructed from scenario values; shared renderer is not proof of identical calculation provenance. |
| [homepageWebCall.js](../../src/services/homepageWebCall.js) 317 | Calls canonical calculator with fictional business profile/identities and returns browser-memory-only illustrative output, explicitly not a quote. Does not INSERT a persistent estimate. |
| [retell-provider.js](../../public/js/retell-provider.js), [simulator.js](../../public/js/simulator.js) | Intake/result adapters reference canonical output. They do not independently persist an approved estimate. |
| [Mission23 operational intelligence](../operations/POLARIS_OPERATIONAL_INTELLIGENCE.md) and [downstream handoffs](../operations/DOWNSTREAM_HANDOFFS.md) | Adjacent completion/work/operations display sinks and future input references. Existing reference consent does not authorize Mission24 consumption. Not direct `canonical_estimates` writers/readers. |

## Inventory method and wording disposition

Source reconciliation searched all `src` JavaScript for `canonical_estimates`, `canonical_polaris_snapshots`, calculator imports/calls, graph-service exports/calls and graph reader/projection imports. It followed registrations through server mount order, the eight surface names, compatibility routes, frontend canonical-loader metadata, store/API/engine adapters, and synthetic homepage/demo exceptions. Direct `canonical_estimates` production matches are exactly graph service, v2 repository and canonical routes. Snapshot matches add demo voice lifecycle. Tests/migrations and unreferenced exports were classified separately. This inventory is complete for that named authority and its adapter families at the pinned base; it does not assert every legacy use of the English word estimate is a canonical consumer.

The package changes only these architecture/roadmap documents, with no HTML/CSS/JavaScript/API/SQL changes. Therefore no rendered state is introduced or changed. The mapped sinks still matter for future adoption: every changed label, card, dialog, loading/empty/denied/validation/error/help/accessibility state must receive the wording gate in owner/admin/estimator/worker/dispatcher/customer contexts as actually authorized, with relevant mobile/theme checks. No blanket “backend-only, N/A” exemption or mission-wide frontend cleanliness claim follows from this disposition.

## Human decision consumer extension

The existing shared drawer now consumes a separate human decision ledger through its owner/admin estimate-review read and bounded decision write. Demo uses the same renderer/projector with isolated synthetic storage. See [the decision contract](../operations/MISSION_24_ESTIMATE_DECISIONS.md) for exact ledger, permissions, source pins, recovery and wording states. Broad machine estimate projections retain their original semantics; no worker or customer output projection receives approval authority. This does not remove the inventory's future adoption gaps.

## Part1 Slice4 consumer extension

The existing owner/admin estimate-review GET now also passes its same-transaction graph snapshot and human decision to src/estimating/capellaReview.js. src/routes/demo.js uses that identical projector with its isolated stored demo workspace. public/js/customer-detail.js renders the comparison in its existing contextual review; demo-runtime continues redirecting demo requests away from private endpoints. No other broad machine-price projection gains human approval or private risk content. The output has no new writer, schema, customer projection or provider. Details and changed wording states: [Capella recorded costs](../operations/MISSION_24_CAPELLA_RECORDED_COSTS.md). The original inventory remains explicitly dated; this is an additive extension.


Slice4 demo correction adds src/commandCenter/demoEstimateExample.js as a canonical calculator caller only during creation/reset of the first fictional job. It stores the same calculated snapshot, explicit illustrative input and profile authority in the existing token-owned demo graph. workspace.js uses that snapshot's actual input/profile pins for this marked example; legacy graphs preserve the old projection. Other jobs retain unavailable cost cases. This is a declared synthetic exception to production persistence, not real tenant authority or a second estimator. The original baseline inventory remains historical.
