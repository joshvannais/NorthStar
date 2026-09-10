# Mission24 Phase1 — first runtime adoption

Candidate scope: read-only **Estimate review** in the existing shared customer drawer. This implements a first subset of the [architecture contract](../architecture/MISSION_24_ESTIMATE_ARCHITECTURE.md), not full Phase1, Capella Risk Lens, commercial approval or customer quote composition.

## Actual authority and consumers

`GET /api/v1/canonical/estimates/:estimateId/review` uses the current durable session/membership read snapshot and then restricts the new private review to current owners/administrators. It selects that exact persisted estimate through the existing canonical graph reader and preserves tenant isolation, source pins and historical values. Existing dispatcher access to other projections is neither broadened nor reinterpreted as new financial permission.

`src/services/estimateReview.js` is a consumed read projector, not a second calculator or writer. It exposes selected recorded amounts, null display amounts for absent/nonfinite values with distinct missing/unavailable/recorded/invalid source states, recorded-at date and limited cost-basis explanations. `not_recorded_here` describes this application's missing approval record, not every possible human decision elsewhere. It does not infer approval from a calculated price, a scheduling action or a GET.

`public/js/customer-detail.js` renders the review inside the existing price disclosure and offers Refresh. It matches estimate, customer, graph, operation, opportunity, snapshot identity/digest/date, supporting-fact IDs, calculation version, input fingerprint and Business Profile id/version/hash. An old customer-switch response is discarded; inconsistent selected pins clear the view. Raw pins and internal calculation reasons are not rendered.

Actual primary mounted paid host is `/dashboard`, served by `public/demo-dashboard.html` in `src/server.js`; legacy `public/dashboard.html` and `public/dashboard/command-center.html` files are not the current primary route. Leads and communications mount the same drawer. This clarifies the architecture inventory's file-level list without changing old source receipts.

Demo uses the SAME drawer/renderer and the SAME deterministic server projector via `GET /api/demo/command-center/estimates/:estimateId/review`, reading the token-scoped synthetic workspace. `demo-runtime.js` adapts the request before private HTTP. Synthetic provenance is explicitly labeled; no human approval or paid authority is fabricated. No new demo workflow, cloned estimator or simulation controls in paid UI.

No schema, migration, calculator, pricing, approval, persistent review state, provider, configuration or production changes. No operational handoff consumption. No localStorage price authority. Responses are no-store. Historical stored estimates remain unchanged when the Business Profile later changes.

## Requirement-to-evidence and wording inventory

| Requirement/state | Focused evidence |
| --- | --- |
| Exact source and historical value preservation; valid zero/null/absent | Unit projector checks and mounted PostgreSQL API fixture |
| Owner/admin; member/dispatcher/viewer; other tenant; unauthenticated; suspended/changed membership; revoked session | Mounted actual server/auth/current membership/reader API fixture |
| No estimate/snapshot/operation writes; new profile does not reprice stored review | Before/after durable row digests and source-pinned API comparison |
| Shared deterministic paid/demo contract | Unit comparison plus actual token-scoped demo route and same drawer browser interaction |
| Loaded/partial, loading, refresh, unavailable, denied, stale selected pins, late customer response | Chrome and actual WebKit browser cases; safe error fixtures inject only benign transport responses, while access decisions are separately tested through mounted API |
| Owner dashboard, leads and communications shared component | Real mounted route/HTML/JS browser reads with disposable data |
| Desktop/mobile and light/dark; keyboard refresh; visible spacing | Rendered screenshots and browser interaction; actual WebKit is not physical Safari |
| Demo labels/refresh and no private endpoint requests | Real demo adapter browser request observation, desktop and mobile |

Engineering keys, SQL, routes, raw IDs/digests, stack traces and raw `notCalculated` reasons do not appear in this new review. Existing cost category labels and safe unavailable explanations remain visible. The new disclosure uses existing shared pricing row styling and does not alter NorthStar or Polaris branding. No whole-app wording cleanliness is inferred from this bounded review.

Tests: `tests/unit/m24-estimate-review.test.js`, `tests/helpers/m24-estimate-review-fixture.js`, `tests/api/m24-estimate-review-postgres.js`, `tests/browser/m24-estimate-review.js`; existing canonical-calculation regression remains separate. Final exact-head results, screenshots, source hashes and failed intermediate fixture attempts belong in the sealed external handoff; this document does not declare unexecuted checks passing.

## Retained gates and limits

Fresh disposable PostgreSQL18, UTC/UTF8/C locale/checksums, separate owner/runtime roles, synthetic tenant/job data only. No production or live provider evidence is inferred. Independent different-reviewer acceptance and release remain separate. Historical three focused API failures and fifteen wider failures stay explicit and are not relabeled passing; only affected regression is rerun. Hosted CI, physical Safari/devices/manual assistive technology, authenticated private production, provider/storage/downstream delivery and founder final visual verdict remain unavailable unless separately obtained.

No migration/recovery action is required or consumed. The earlier Part11 gate error and accepted untested restore/forward-fix limit are preserved; no future schema waiver is created. Future Capella risk scenarios and human approval/customer-safe branded output must retain this same estimate lineage and explicit authority boundaries.
