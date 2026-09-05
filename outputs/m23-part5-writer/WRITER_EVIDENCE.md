# Mission 23 Part 5 writer evidence

Status: corrected implementation candidate awaiting a different fresh independent
exact-head re-audit. The first audited head was
`ec63f9065fc869669b47b04e062a6d42e53bbfda`; its terminal audit required the
three bounded corrections recorded in `CORRECTION_LOG.md`. A subsequent fresh
re-audit of `48c8acd95122d1e0b8d0a5df70611d11a9aea4ff` required one P3 correction
to Chrome 390-pixel fixed-header clearance; that bounded correction is also
recorded in the ledger. This is not an audit approval, release, deployment, live
research claim, or founder visual approval. The draft PR's new immutable head is
the final writer handoff identity; no Part 6 work is included.

## Provenance and authority

- Canonical executor readability was confirmed before work. The governing Mission
  23 roadmap and directly governing asset, knowledge, provider, security,
  migration, test, release and design contracts were read before editing.
- Exact released base: `eccc8e901b20ae3cc65a68c9fb2b068a4ceb9375`.
- Persistent full-history writer checkout:
  `/home/joshv/northstar-m23-part5-writer-eccc8e9-20260905`.
- Narrow branch: `review/m23-part5-equipment-operations`; no Part 4 writer checkout
  was reused. Base history contained 1,230 commits; no AGENTS.md was found.
- A separate detached, tracked-clean baseline worktree at
  `/home/joshv/northstar-m23-part5-baseline-eccc8e9` was used only to attribute
  pre-existing test failures; it was not an implementation checkout.
- The roadmap's Part 4 status records only the supplied approved head
  `2e682e4bc33d419c1fc357957e825c18cdec2cd6`, merge/deployed base above, Railway
  `f5f6caab-08a5-490a-93c4-386e84f3b4f8`, applied pending sequence 042–045, and
  three health 200s with the supplied release evidence boundary.

## Delivered scope

The unified package contains NorthStar-controlled reviewed public research
source/version import authority, exact private tenant asset-version pinning,
shared sequential reviewed onboarding from Business Profile and Polaris,
server-only gated literal-identifier extraction through the existing Responses
integration, and explicit authorized confirmation before Mission 20 mutation.
It includes exact operator/execution use, check-out/in, readings, condition,
fault, downtime, maintenance, append-only correction and availability contracts.
The responsive catalogue uses non-empty generated categories, native collapsed
disclosures, counts, search/status filtering, source provenance and truthful
review/error states. Part 9's full operational execution UI is excluded.

No live provider call, enablement, credential/configuration change, real research
import, production access, customer contact, merge or deployment was performed.
Synthetic research exists only in disposable test databases. Missing approved
research leaves a saved tenant asset needs_review and unusable for operations.

## Local verification

Runtime: Node 24.18.1; disposable vanilla PostgreSQL 18.4 on loopback port 55468
with separately exercised owner/runtime roles. Earlier Ubuntu-distribution
PostgreSQL was replaced for final runs because historical tests require the
vanilla version metadata. No production connection was used.

| Final verification group | Result |
| --- | --- |
| Entire available-only Jest inventory, corrected candidate | 193 suites, 6,597 tests passed; 50 explicit exclusions; zero failures |
| Unit, contract and ratification directories | 119 suites, 5,891 tests passed |
| Exact correction-focused equipment/migration/inspector group | 5 suites, 79 tests passed |
| Prior operations and full ratification regression | 24 suites, 437 tests passed |
| Account migration available cases | 23 passed; one absent archived negative control unavailable |
| Chrome 152.0.7977.82 mounted browser | Complete matrix passed three consecutive times after the P3 correction |
| Actual Playwright WebKit 26.5 mounted browser | Passed |

Browser evidence exercises both entry paths and explicit confirmation against
the actual mounted server/disposable PostgreSQL, 1280/768/390/320 CSS-pixel
viewports in light and dark, collapsed categories, keyboard disclosure and focus
return, touch emulation, inert persisted markup, semantic labels, reduced motion,
CSS 200% zoom and 320-pixel reflow equivalent. At 768/390/320, both engines and
both themes assert the title, action and complete captured catalogue controls are
inside the viewport and vertically clear the actual fixed header before and after
the screenshot. At 390 pixels the oracle also asserts reduced-motion root scroll
behavior is `auto` and requires four identical safe-area samples on consecutive
animation frames before capture, using the audit-triggering 320-before-390 order.
The Polaris trace proves the Ford F-350 prompt opens a reviewed
server draft, while the two required unrelated prompts and an equipment-word note
stay in ordinary Polaris with zero equipment draft/asset writes. Both runs recorded
zero page errors and zero provider calls. Their expected HTTP failures are the
three ordinary Polaris selected-record 400s and the intentionally intercepted 503
catalogue request used to prove failure is not rendered as an empty result.

Broad-suite history is retained in `evidence-summary.json`, including failures.
The first available-only run had 6,566 passes, 50 explicit exclusions and one
obsolete static form-state expectation; that expectation was corrected and both
the complete unit/contract/ratification directories and explicit equipment group
passed afterward. The final pre-audit fully staged broad rerun passed 193 suites
and 6,573 tests. After the terminal audit corrections, the fully staged broad
rerun passed 193 suites and 6,596 tests with zero failures and the same 50
exclusions in 676.676 seconds; the exact run is recorded in the generated summary.
After the later Chrome-clearance P3 correction, the exact available-only inventory
passed 193 suites and 6,597 tests with zero failures and the same 50 exclusions in
588.314 seconds; the unit/contract/ratification directories passed 5,891 tests and
the five-suite focused group passed 79 tests.
An additional staged-inventory rerun passed 6,572 tests and exposed one
historical public-script allowlist assertion for the newly tracked equipment.js;
that explicit authorized-addition expectation was updated without changing
runtime or migration bytes. Its failure remains in the generated history.
The 50 exclusions are 49 failures independently reproduced on the unchanged
released base plus one unavailable archived physical-ordinal negative control.
They remain non-passing evidence, not waivers or equipment successes.

## Reproduction and freeze

`bash outputs/m23-part5-writer/run-local.sh --available` runs the entire Jest
inventory with only the exact 50 names in `availability-exclusions.json`
excluded. The runner removes provider/production environment variables and uses
only the explicitly named disposable cluster. For equipment-only runs use
`--runTestsByPath` with the five new test files; do not use the checkout's
`m23-part5` substring as a Jest path pattern because it matches every file.

The mounted browser runner is `tests/browser/m23-part5-equipment.js` with
`--browser=chrome` or `--browser=webkit`; its fixture uses the same explicit
disposable database identity. Raw verbose logs and result JSON remain local and
ignored. Committed summary records retain run counts, failure names and raw
result byte hashes; committed browser evidence includes screenshots.

All 43 released migration blobs remain byte-identical. Additive migration 046 is
at the required canonical path `migrations/046_m23_equipment_operations.sql` and
the alternate audited path is absent. Its unchanged bytes remain frozen at Git
blob `5b9d294954fb27857299be0b9ef15873ba07cc45`, 57,208 bytes,
SHA-256 `86284c861a014b462e3456e87ec7be703f299e19d23cc7b1650bcd87cb47513f`.
See `MIGRATION_IDENTITY.md`, `REQUIREMENT_TO_EVIDENCE.md`, `CORRECTION_LOG.md`
and `UNAVAILABLE_EVIDENCE.md` for the exact contract and evidence boundaries.

Hosted CI, physical Safari/devices, actual assistive-technology sessions, native
browser zoom, live provider/private production/legal evidence, and founder
personal visual approval remain unavailable. An independent auditor must decide
the candidate's acceptance; no local green result grants release authority.
