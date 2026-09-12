# Mission 24 Part 5: Travel And Logistics

Part 5 is one unsplit implementation. This document describes the local candidate, not a release acceptance. Part 6 pricing, Part 7 reasoning, provider routing, customer quotes, outcome learning and onsite capture remain separate authorities.

## Recorded inputs and exact costs

The shared travel plan stores up to 12 trips, 12 logistics costs, 12 access records, 12 hauling groups, 36 explicit load/leg bindings, and a declared stage plan with up to 12 resources and 12 ordered stages. Distance units are miles/kilometres; time is minutes/hours; fuel units are US gallons/litres/kilowatt-hours. Zero is distinct from missing. Each trip/logistics amount rounds once to cents using rational arithmetic, followed by addition. People are the whole traveling group, never implicitly multiplied by vehicles. Whole-job consumption and charges occur once; per-vehicle-leg and per-vehicle-trip scopes are explicit.

Straight-line distance does not establish driving distance. No route, source price, employee qualification, availability or safety verification is inferred. Missing dates, quantities, applicability and expense coverage remain visible. Incomplete plans can be saved, then revised by the owner as information arrives. Required structural contradictions cannot be acknowledged away.

Homogeneous loads use both applicable volume and payload limits, retained quantities and explicit initial-load ownership. Separately measured loads retain their own capacity and contents; there is no greedy mixed packing. Optional recorded density converts only a missing supported quantity, never guessed yield or initial contents. Zero new output does not erase responsibility for existing contents. Outbound/return/final legs and their counts are explicit.

Stages form an ordered dependency graph, with recorded labor-task positions and equipment-plan references. Elapsed minutes are separate from person-minutes and money. Parallel use of a shared exclusive resource needs review. A position not explicitly located is not assumed onsite or productive. Missing canonical execution or qualification evidence is not manufactured. Stage calculations never extend an appointment.

## Composition and immutable authority

`estimate-cost-adoption-v3` composes material, labor, equipment and travel in the existing estimate revision ledger. Each new selection replaces its original component; other included plans and original historical charge/tax guidance remain pinned. All 24 component orders use the same manifest/composer. A new cost revision requires a new matching human scope/price review before CAPELLA compares that price with costs.

Coverage records identify exact included expense lines, categories and amounts. A shared source cap prevents multiple overlap or equipment-bundle allocations from claiming more than the retained expense. Fuel-only travel marked included elsewhere requires a positive exact retained equipment allocation; this allocation is neither added nor deducted again. Other overlap deductions reduce travel once, leaving the covering expense once. Similar labels do not prove overlap. Unknown applicable costs prevent a complete total and profit claims.

Travel plan history, successful receipts, component manifests and old v1/v2 revisions remain immutable. Changes and withdrawals do not erase still-adopted travel. Current owner/admin, tenant/session, source and decision pins are checked; authority is checked after waits before receipts or mutation. Source revocation is evaluated using current authorized publication metadata without exposing revoked prose. Travel withdrawal remains possible under current cost-write authority when new source-based adoption is no longer eligible.

## Scheduling integration

Paid protected reads and isolated demo reads project current and still-adopted travel alongside existing equipment requirements. Trusted preview and approval use the same restrictions: applicable current access closure is blocking; stale/unknown access, origin, road time, task/resource and buffer evidence needs review. No dispatch notification, route lookup or automatic schedule change is added. The sole cleanup exemption is a real assigned-to-unassigned transition with unchanged schedule state/start/end.

Migration 070 introduces a private organization/estimate fence with actual transactional updates. Travel mutations, all legacy/current revision mutation paths, and mutation-authorizing scheduling share it. Lock order places estimate/travel before the existing equipment asset fences. Ordinary GET/conflict discovery does not write fences. Existing bounded serialization handling does not automatically retry uncertain HTTP saves or renew consent. Existing SQL signatures and privileges remain preserved; old scheduling/equipment review delegates are retained under private names.

## Paid/demo and user-facing consumers

The shared customer drawer provides travel planning under Travel And Work Time, with compact source/load/stage disclosures, explicit preview/consent and history. Original work/travel summary values remain labeled original. Existing price review remains inside Polaris and CAPELLA remains a separate card. The saved cost reader and local Polaris `Show saved travel costs` / `Review logistics` queries display the selected included travel and latest separate plan; general provider conversation still retains its original-context boundary.

New/reset demo sessions receive versioned optional example inputs with actual synthetic job labels, straight-line source distance when present, and visibly simulated rates. Choosing the example does not save or approve anything; driving distance/time and crew input remain deliberate. Old sessions are never retrofitted or reset and can use manual entry. Authored examples do not claim Retell, mapping or supplier execution.

## Migration, recovery and release limits

All 67 previously applied SQL files remain byte-identical. New 070 creates the private travel history/fence, extends the demo operation CHECK and existing revision columns/CHECK/FK, and installs narrow composition/scheduling delegates. Startup retains the tighter of inherited settings and 5-second lock/20-second per-statement caps. Existing-table/FK/check validation and unknown external writers still require a concrete release assessment. No production SQL, backup, maintenance, provider or deployment action is authorized by this implementation.

An old reader is incompatible with new travel/v3 history. Recovery must use current compatible readers with source-controlled plan/adoption/scheduling mutations paused; the combined recovery also pauses human price decisions. Authorized reads and immutable histories remain, paused attempts make no claim about whether an earlier uncertain save committed, and forward resume retains exact receipt replay. Physical restore is not established by application-pause tests. Final handoff distinguishes executed builds from prepared descendants and records exact source deltas.

## Verification ownership

Focused tests cover rational arithmetic/rounding and component orders; SQL/JS agreement; source revocation, saved references and old replay; actual scheduling, equipment-046 and revision interleavings with absent/existing fences and expiry-after-wait; startup contention/rollback and old SQL/routine/ACL preservation; populated paid/demo upgrade, pause and forward resume; rendered entry, incomplete-to-measured continuation, coverage, selected review/local query, consent, uncertain retry, rejected errors, keyboard, themes and final navigation. Failed harness attempts remain evidence with corrected accounting, not relabeled product failures or passing runs. Independent review and separately authorized public release acceptance remain required.
