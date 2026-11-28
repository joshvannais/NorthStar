# Mission 29 Part 1B — organization and location identity contracts

Status: **Writer candidate; independent exact-head audit and release pending.** The [approved roadmap](../roadmap/MISSION_29_ENTERPRISE_PLATFORM.md), [complete source](../roadmap/MISSION_29_APPROVED_SOURCE.md), [ledger](../roadmap/MISSION_29_ACCEPTANCE_LEDGER.md) and [machine-readable contract](MISSION_29_PART1B_ORGANIZATION_LOCATION_IDENTITY.json) remain authoritative together. Scope is identity/reference data contracts only; no authenticated context, lifecycle write, UI or enterprise permission is introduced.

## Implementation and baseline

The actual module is [identityContract.js](../../src/enterprise/identityContract.js), exercised directly by [the focused unit suite](../../tests/unit/m29-part1b-organization-location-identity.test.js). It imports no application repository, route, provider, environment or identity allocator. No existing production caller imports it in this slice. The module contract marker is northstar.enterprise.identity.v1.

Inherited main is [1eb713a8c532aaac1e04e1828933a199277afe8f](https://github.com/joshvannais/NorthStar/commit/1eb713a8c532aaac1e04e1828933a199277afe8f), tree cbf8b66959b01ca769ec625503f6490046710d96. [PR615](https://github.com/joshvannais/NorthStar/pull/615) records terminal 1A acceptance. The [1A inventory](MISSION_29_PART1A_AUTHORITY_INVENTORY.md) and its JSON remain unchanged historical snapshots. The approved source raw Git SHA256 remains 636841534E6F6AC88E37FD2E10D86E4B54EF3F8D53CF78CC963648C3CD21C391; all 44 definitions/order remain intact.

## Typed identities

| Kind | Identity/reference meaning | Retained boundary |
| --- | --- | --- |
| enterprise_group_identity | An explicit group ID in a distinct typed namespace | Not organizations.id, a tenant alias, legal ownership or an access grant |
| company_reference | The existing organizations.id retained as organizationId | No new company ID, database existence assertion, membership or profile rewrite |
| location_identity | A location ID scoped by explicit organizationId | Same UUID text in a second company scope does not identify the first company location |
| legacy_location_reference | Exact headquarters/office key plus organizationId and profile pin | Reference only; no new canonical location, migration, mapping or automatic adoption |

UUIDs are exact primitive lower-case hyphenated text. The module never coerces, trims, case-folds, allocates or derives them. UUID syntax does not prove durable existence; a nil UUID is a literal value, never a wildcard. Existing Business Profile office keys retain their exact permitted letters, digits, punctuation and case.

Every identity carries exact declaration metadata: declarationId, declaredByActorId and canonical UTC declaredAt. These are declarations, not verified actor, issuer, source, freshness, membership, permission or currentness evidence. A historical timestamp is preserved as metadata rather than falsely treated as current authorization.

Returned records and all nested provenance/profile pins are new frozen data. Graph arrays and graph records are also copied/frozen. This prevents mutation of an in-process contract snapshot; it does not claim durable uniqueness, version history or immutable storage. Input objects are not mutated. Unknown fields, missing/null/undefined required data, symbols, hidden fields, inherited records and accessors are rejected without invoking data getters.

## Explicit non-authorizing relationships

The closed relationship vocabulary is enterprise_company_association and company_location_reference. Both carry explicit identities and declaration metadata. Neither establishes common/legal ownership, active membership, franchise participation, reporting visibility, approval authority or data transfer. Several distinct metadata associations do not select an enterprise-owner or franchise disclosure policy. Parent-group hierarchy, regions, franchises and access-grant kinds are unsupported here.

normalizeIdentityGraph requires its exact contract marker and dense explicit identities/relationships arrays. An explicitly empty graph is valid and adopts nothing. Duplicate typed identities reject even when identical; conflicting declarations are not silently merged. Relationship IDs are unique across kinds and duplicate endpoint pairs reject even under different IDs. Every endpoint must resolve in its exact typed namespace. A matching UUID in a company record cannot satisfy a group/location reference.

Scoped location and legacy records require a matching declared company reference. Every canonical location also requires an explicit matching company_location_reference edge; identity scope does not generate it. A foreign-company location is never resolved by bare ID. A legacy office reference cannot satisfy a canonical location edge. Output order is deterministic without mutating the input batch.

Batch bounds are 1,000 identities and 2,000 relationships per invocation. They are resource bounds for this pure contract operation, not plan tiers, seats, company/location allowances or pricing decisions.

## Exact legacy snapshot matching

matchLegacyLocationSnapshot accepts an explicit legacy reference plus an explicitly supplied snapshot containing organizationId, profilePin and locationKeys. Scope and all pin fields must match exactly; the pin comprises canonical UUID id, exact org-profile-v positive decimal version text and lower-case 64-hex hash. Version text is not coerced through Number, preserving large historical values.

The key must occur exactly in the supplied list. Unknown/trimmed/case-folded aliases deny. Duplicate or case-ambiguous source keys deny. The existing stable-key grammar is preserved. No active Business Profile is fetched, no canonical location is allocated, and no mapping or record adoption is inferred.

This helper proves equality/existence only inside the supplied snapshot. A caller cannot use that result as proof of authentic source, active-profile freshness, current membership or authorization. Future 1C consumers must resolve fresh trusted server-owned session/company/profile authority separately; 1D owns governed persistence and lifecycle transitions.

## Compatibility and persistence disposition

The existing company/Business Profile authority, organizations.id values, fixed roles, UNIQUE(user_id) membership constraint, current durable session joins and all office/homeLocation references remain unchanged. No existing runtime route, authentication middleware, worker, public UI, schema, migration, data or dependency is modified.

No repository or migration is necessary to define these pure contracts. Source still has 285 migrations through 289/no 290 and all historical SQL bytes remain unchanged. There is no schema upgrade, backfill, data conversion, implicit legacy adoption or data rollback step. The module is additive and unmounted. Rollback of a release remains root-owned; no rollback operation is executed or claimed here. Actual database persistence/reload/concurrency is not claimed by JSON roundtrip tests.

## Validation and evidence boundaries

The focused tests execute the actual module. Positive and adversarial cases cover typed identities, namespace confusion, explicit relationships, duplicate/unknown/mismatched references, missing/null/undefined/extra fields, copied deep immutability, provenance, deterministic JSON roundtrip, exact legacy matching and bounded dense arrays. No repository mocks or copied validator substitute for the production functions.

Writer test results are not independent evidence. Root must audit the complete exact candidate in a new fresh full-history checkout and require zero P0–P3 before normal review/release. Any source SHA change requires that entire independent audit again. Required backup/standing rotation, guarded normal merge, one automatic deployment and authorized read-only source/image/startup/migration/health/render/key-cleanup verification remain root release gates. No future candidate SHA or release is predicted here.

No fresh PostgreSQL, mounted HTTP/browser, hosted CI, private-production or provider campaign is claimed for this pure contract slice. Empty/unavailable CI is not green. Six older baseline-reproduced full-parity failures remain unclaimed passing. Founder visual approval, physical devices/manual AT, provider/live/private authenticated production, real recipients/messages/money, legal/professional conclusions, production SLA and disaster restore remain separate.

## Next boundary

After terminal 1B acceptance, 1C may implement authenticated enterprise context within the approved plan. Slice 1C, lifecycle writes in 1D, UI in 1E, custom roles/SSO in later Part 2, franchise authority in Part 4, enterprise API in Part 7 and Missions 30/31/33 have not been pulled into 1B.
