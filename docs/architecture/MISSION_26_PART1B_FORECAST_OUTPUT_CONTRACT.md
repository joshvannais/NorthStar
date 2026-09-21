# Mission 26 Part 1B — forecast output contract

This slice defines and validates the internal `m26-forecast-output-v1` envelope in `src/forecasting/outputContract.js`. It produces no forecast, route, database record, dashboard value, provider request or commercial action. An accepted shape is not proof that an input source is authorized, a target is applicable, an algorithm is valid, or an interval is calibrated. Parts 1C, 2, 3 and the individual forecast-family slices must enforce those separate authorities before any output is issued.

## Envelope

| Field | Required meaning |
| --- | --- |
| `contractVersion`, `organizationId` | Exact schema version and tenant identity. The caller must obtain tenant identity from trusted current authorization, never a browser claim. |
| `asOf` | UTC instant at which source knowledge is frozen. It is not an observed future outcome. |
| `horizon` | UTC `startsAt`, exclusive `endsAt`, and an hour/day/week/month/quarter/year grain. The horizon must end after `asOf`; target-specific periods and business calendars are later authority. |
| `target` | A bounded target key and definition version. Part 3A will register exact targets and outcome windows; this contract does not invent them. |
| `unit` | Bounded unit key and a three-letter currency only when the unit is `money`. Currency code and exact target-unit compatibility still require later registration. No conversion occurs here. |
| `value` | One of `unavailable` with a reason code, `point` with an exact decimal string, or `range` with ordered lower/central/upper exact decimal strings and either `deterministic_scenario` or `calibrated_interval` basis. No missing amount silently becomes zero. |
| `confidence` | Either `unavailable` with no digest or, for a calibrated interval only, `calibrated` with a pinned backtest digest. Points and deterministic scenario ranges carry unavailable confidence. There is no free-form confidence percentage. A digest is only a reference; Part 3 must prove backtest quality, calibration and applicability before displaying a calibrated claim. |
| `uncertainty` | `unquantified`, `deterministic_scenario` or `calibrated_interval`, plus at most twelve distinct coded drivers. A range basis must match the uncertainty state. Deterministic bounds cannot masquerade as probabilities. |
| `evidenceCoverage` | Explicit included, excluded, missing, stale and conflicting counts. These are not converted into a simplistic completeness or confidence percentage. Part 3A defines target-specific eligibility and whether categories overlap. |
| `applicability` | Optional service and area keys plus bounded coded limits. Null service/area is a declared broad scope, not proof the result applies to every job or region. |
| `calculationVersion`, `sourceSnapshotDigest` | Exact calculation identity and an as-of source pin. A point or range requires a snapshot digest. Part 2A must create and authorize real immutable snapshots; this contract cannot make a caller-supplied digest trustworthy. |

The validator accepts only exact keys and JSON-like values, rejects ambiguous time offsets, invalid dates, numeric floating-point amounts, reversed ranges, mismatched range/confidence states and unexplained monetary currency, and returns a detached frozen object. Decimal ordering uses scaled integers, not binary floating-point arithmetic. It intentionally does not calculate price, forecast outcome, interval coverage, accuracy, eligibility, or the commercial meaning of a target.

## Boundary and next gates

The existing investor forecast and legacy dashboard forecast labels remain outside this contract; see [Part 1A](MISSION_26_PART1A_SOURCE_READINESS.md). The module is not mounted by the server. Part 1C must define who may create/read a forecast, audit events, tenant-private presentation and fictional-demo isolation. Part 2A must create immutable as-of snapshots. Part 3 must register outcome targets, evaluate saved predictions against later actuals, measure sufficiency and calibration, and gate algorithm promotion. Parts 4–9 may then produce bounded forecast families. Part 11 owns immutable run storage and handoffs. No field in this envelope grants permission to mutate an owning source system.

`tests/unit/m26-forecast-output-contract.test.js` covers unavailable versus zero, source-pinned points, deterministic versus calibrated ranges, exact UTC windows, decimal ordering without floating-point arithmetic, currency, coverage, applicability and rejection of extra fields.
