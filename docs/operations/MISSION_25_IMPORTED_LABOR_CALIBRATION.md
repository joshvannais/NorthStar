# Mission 25 imported labor calibration

Migration `087_canonical_imported_labor_calibration.sql` and guarded routes under `/api/v1/learning/external-labor-sources/:sourceKey` turn a bounded set of current, reviewed imported labor outcomes for one exact service key into a deterministic advisory proposal.

An owner or administrator must first maintain current source consent and imported-outcome consent, then separately grant `imported_labor_duration_calibration_v1` consent. A proposal requires at least five and uses at most 100 fresh outcome revisions. It pins the exact observations, their source manifests, the current outcome consent, the calibration consent and algorithm version. The proposal reports the median recorded-to-planned worker-hour ratio plus lower and upper quartiles. It recommends keeping, increasing or decreasing the planning assumption using a fixed five-percent band.

Corrections, tombstones, match changes, adopted-plan changes, consent changes and refreshed observations change the current sample digest. Earlier proposals then remain immutable but lose their current advisory values until a new proposal is explicitly confirmed. Consent revocation blocks proposals and masks derived runtime results.

The output is evidence for an owner decision. It does not change an estimate, labor plan, rate, schedule, payroll record, worker profile or business policy. Adoption remains a separate future human-authorized workflow.

This package is API-only. It adds no rendered owner interface. The later experience must separately pass plain-language wording, focus order, keyboard operation, mobile layout, theme parity and founder visual review.
