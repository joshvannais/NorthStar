# Account-free demo workspace lifecycle

This document records the conservative Pre-Mission 23 P5 contract for `DEM-15` through `DEM-18`.

## Lifecycle authority

- A new account-free demo cookie session creates one randomized fictional workspace seed.
- The seed creates one fictional tenant atomically: company identity, Business Profile, service catalogue, territory, time zone, workforce, customers, jobs, and schedule are generated together.
- Ordinary navigation, browser reload, and repeated lead simulation preserve that active workspace. Manually selected scenario choices affect the new fictional lead, not the seeded tenant identity or settings.
- **Reset Demo** atomically advances the seed and replaces the fictional tenant, graph, identity, settings, customers, jobs, and schedule in the same isolated cookie session.
- Literal browser-refresh randomization is intentionally not implemented. It would contradict cross-page persistence, repeated lead generation, same-session tab consistency, and saved scenario choices.

The raw seed is stored only inside the server-side demo state. It is not returned by workspace, canonical-surface, account, workforce, Business Profile, Settings, knowledge, or integration projections. Random admission derives from the cryptographically random bounded demo token, while pure explicit-seed helpers provide reproducible fixtures for tests and screenshots without module-global mutable state.

## Fictional-data boundary

Generated people use visibly synthetic surnames. Email addresses use `example.com`; North American phone numbers use the reserved `555-0100` through `555-0199` fictional range; addresses contain an explicit `Example`, `Sample`, `Fixture`, or `Demo` marker and the non-routable `00000` postal code. No provider connection, call, message, map launch, or external mutation is performed.

Each address carries the seeded service zone, coordinates, time zone, calculated distance from the fictional headquarters, and an inside-radius assertion. Each job references a generated customer, supported service, assigned fictional workforce member, and the same territory time zone. Every demo destination continues to consume the existing shared workspace graph and canonical projection boundary.

## Deterministic evidence

`createDemoWorkspaceFixture({ seed })` produces a byte-stable fixture, including a seed-derived deterministic evidence timestamp when no explicit anchor is supplied. Mounted runtime admission supplies the session creation time as the schedule anchor; a fixed seed plus fixed anchor remains byte-stable for route screenshots and property tests.
