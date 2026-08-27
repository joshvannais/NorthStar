# M22-P4-003 closure trace

## Validated original failure

The independent audit at exact head
`03ba43e30625278a72880c6ae4e0d4fd3ce7c98e` established both parts:

- separate volatile `clock_timestamp()` samples could violate
  `canonical_schedule_previews_expiry_check` before the expiry assertion; and
- the selected test's shared initially-unassigned appointment made a direct
  named invocation fail 409 at preview creation.

The immutable original report, finding JSON, failing Parts 1-4 result, three
named runs, and their hashes remain in the external audit directory recorded in
`auditor-artifact-hashes.txt`.

## Source-to-sink correction

- Source identity: new dedicated `boundaryAppointment` fixture.
- Prerequisite: `seedAppointment` is called inside this test.
- Valid transition: `assign` from its initial unassigned state.
- Clock source: exactly one database `clock_timestamp()` CTE value.
- Derived timestamps: `created_at = expires_at - interval '15 minutes'` and the
  same `created_at`/`expires_at` values are passed into the preview digest.
- Product sink: the unmodified approval endpoint evaluates its live wall clock
  and returns `409 M22_PREVIEW_EXPIRED` at the inclusive boundary.
- Side-effect assertion: the dedicated assignment revision is unchanged.

## Regression result

- Isolated named test: 3/3 fresh invocations passed.
- Normal full-file repeats: 3/3 runs passed, each 14/14.
- Random seed 2204: this corrected test passed; another known shared-fixture
  case failed and is preserved without expanding the correction.
- Mounted Parts 1-4: 57/57 passed.
- Full locally available corpus: 2,081/2,081 passed.

No product authority, migration, provider, UI, package, or roadmap behavior was
changed to obtain these results.
