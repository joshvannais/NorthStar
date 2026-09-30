# Mission 26 Part 4D — bounded demand UI boundary

Status: unreleased local candidate on deployed Part 4C authority. It presents a current bounded backlog fact and a clearly isolated fictional example. It does not issue a demand forecast or complete Part 4.

## Paid workspace

The shared Command Center does not create a current-backlog snapshot during page load or ordinary workspace refresh. A paid owner or administrator must choose one of two explicit actions:

1. **Capture current backlog** sends an empty guarded request to `POST /api/v1/forecast/current-backlog/snapshots` with one browser-generated idempotency key. An unconfirmed retry reuses that same key. A completed action clears the attempt so a later deliberate capture has a new identity.
2. **Load receipt** requires the exact UUID returned by an earlier capture and reads only `GET /api/v1/forecast/current-backlog/snapshots/:snapshotId`.

The server remains the tenant, paid-subscription, owner/admin, CSRF, idempotency, source-currentness and 500-member-bound authority. The browser accepts only the migration 209 safe projection, mandatory false coverage and forecast flags, nonnegative bounded counts and coherent reviewed-person-minute state. It never receives member appointment, assignment, estimate, execution, review or source-generation identities. A cross-tenant receipt is indistinguishable from an unavailable private receipt.

The UI separates approved-unscheduled, approved-scheduled and in-progress counts from reviewed planned person-hours. Missing or noncurrent person-plan review makes planned time unavailable while preserving only the allowed current counts. A stale receipt withholds all counts, planned time and digests. Overflow, access restriction, source contention, malformed response and workspace failure each have an explicit no-number state. Retry repeats only the user's prior explicit receipt action; workspace recovery does not silently capture a new receipt.

## Isolated demo

`/demo` uses one frozen fictional presentation object inside the browser. It never calls the paid current-backlog endpoint and never reads or writes production tenant tables. The card labels the example fictional and hides paid receipt controls. Its example numerics prove only responsive presentation behavior.

## Forecast boundary

The backlog card is a present-state fact. A separate demand-forecast line remains **Forecast unavailable** in both paid and demo modes. The UI never blends backlog with lead counts, pipeline, seasonality, probabilities or predicted work. `knownSubsetOnly=true` and `sourceCoverageComplete=false`, `offPlatformCoverageVerified=false`, `providerCoverageVerified=false`, `probabilityCalibrated=false`, `forecastIssued=false` and `paidNumericServing=false` remain required even when reviewed planned person-minutes are displayed.

Focused local evidence covers paid no-request-on-load, explicit capture and exact read, same-key retry identity, available/missing/stale/oversized/restricted/workspace states, poisoned response refusal, isolated demo no-request behavior and false evidence flags. Local Chrome rendering covers the paid desktop/light and demo mobile/dark component. This evidence is fictional and local: it does not prove production deployment, complete business or provider coverage, natural history, forecast calibration, paid numeric forecast serving, live Safari or physical-device behavior, accessibility acceptance, Part 4 acceptance or the founder's visual verdict.
