# Part 4 mutation source-to-sink inventory

## Public and compatibility sources

| Source | Current sink | Part 4 decision |
| --- | --- | --- |
| `POST /api/v1/canonical/appointments/:id/mutation-previews` | bounded body -> mounted auth/context/permission -> normalization -> conflict/recommendation snapshot -> `canonical_schedule_create_mutation_preview` | Evidence only; persists a 15-minute non-capability preview. |
| `POST /api/v1/canonical/appointments/:id/mutation-approvals` | bounded body -> mounted auth/context/permission -> normalization -> current evidence reload -> `canonical_schedule_apply_mutation_approval` | Sole public mutation path; serializable exact-authority transaction. |
| `PATCH /api/v1/canonical/appointments/:id` | mounted auth/context/permission -> 428 response | Compatibility route is truthful but cannot mutate without preview/approval. |
| Calendar Part 1 edit/drag/resize PATCH calls | compatibility PATCH above | No bypass; Part 5 will consume the Part 4 workflow. No Part 4 UI claim. |
| simulation/demo transcript appointments | scoped query exclusion in repository and both database entry routines | Cannot preview or approve; paid/demo isolation preserved. |

## Internal and database sources

| Source | Guard |
| --- | --- |
| legacy `updateAppointmentSchedule` repository | No mounted production caller; runtime cannot insert/update/delete legacy approval, revision, audit, or idempotency evidence. Assignment guard rejects unmatched writes. |
| direct `canonical_schedule_assignments` DML | Runtime INSERT/DELETE revoked; UPDATE is narrowly retained for authoritative conflict locking and is guarded by same-transaction exact approval evidence. |
| direct `canonical_appointments` schedule/status DML | Appointment trigger requires a current same-transaction legacy or Part 4 approval that exactly matches assignment state. |
| direct Part 4 preview/approval/audit/idempotency DML | Runtime INSERT/UPDATE/DELETE revoked; immutable triggers reject update/delete. |
| direct assignment revision DML | Runtime DML revoked; revision trigger binds the row to current assignment and exact same-transaction approval. |
| transaction-local setting forgery | No authority derives from session settings. Mounted regression sets a forged custom transaction-local value and still receives database denial. |
| internal helper or trigger invocation | Runtime EXECUTE revoked for actor, target, digest, assignment, revision, appointment, initial-creation, immutable, and completion helpers. |
| appointment creation | Existing trigger function is schema-qualified `SECURITY DEFINER` with fixed trusted search path and can create only revision-1 needs-review authority. Runtime cannot invoke it directly. |

## Atomic lock and evidence order

1. Normalize a bounded exact JSON request before broad parsing.
2. Begin serializable transaction with bounded statement and lock timeouts.
3. Lock organization, membership, profile, user, session, subscription,
   onboarding, and active Business Profile authority in the actor check.
4. Load the tenant-scoped assignment and appointment; compute mounted Part 2
   and Part 3 evidence.
5. In the approval entry routine, authenticate current actor/session/CSRF first,
   then resolve idempotent replay, lock the preview, and lock the assignment.
6. Recheck revision/digest/status, expiry, replay, target, conflict,
   recommendation, warning/review acknowledgements, and transition.
7. Insert approval, update assignment, insert revision, update appointment,
   insert audit, and insert idempotency response.
8. A deferred completion trigger proves all evidence is present and mutually
   consistent before commit. Any failure rolls back every row.
