# Mission 25 Part 10 — Native equipment utilization release boundary

## Slice A authority

Migration `096_canonical_native_equipment_utilization.sql` and the guarded routes under `/api/v1/learning` add one tenant-private native equipment outcome. A current owner or administrator must grant separate `native_equipment_checkout_variance_v1` purpose consent. The owner may then explicitly record one observation for an estimate whose Mission 24 equipment-cost plan has been adopted and whose matching Mission 23 execution is completed.

Every equipment-cost line with positive planned hours must identify one exact line in the underlying equipment plan and one current active reviewed tenant asset. The same asset cannot stand for multiple planned lines. The completed execution must contain a complete effective event chain for each asset: one `check_out`, optional `use` events only while checked out, and one later `check_in`. Missing pairs, overlapping checkouts, events outside a checkout, stale asset versions, changed plan lineage or an execution without a completion record fail closed.

The observation pins the estimate, adopted estimate revision, equipment plan, equipment-cost plan, execution, completion, each current asset version and every effective checkout/use/check-in event revision and digest. It reports planned hours, recorded checkout hours, absolute variance, percentage variance and a deterministic five-percent advisory band. It does not claim engine-on time, productive utilization, fuel burn, operating cost, maintenance cost, condition or availability. Those claims require later source authorities.

## Correction, consent and adoption boundary

Equipment corrections use the existing explicit Mission 23 correction authority. A correction changes the current source digest, makes the saved observation stale and masks its advisory until an owner records a new immutable observation. Purpose-consent revocation blocks writes and hides observations from runtime reads. Another tenant receives no record-existence signal.

The runtime role can execute only the guarded consent and observation entry functions. It has no direct table access and no execution permission on the source-basis helper. Consent and observation rows are immutable. An observation never changes an estimate, price, schedule, asset record, cost allocation or business policy.

## Acceptance coverage

Disposable PostgreSQL coverage applies the complete migration chain through `096`, creates and adopts an exact equipment plan, records a four-hour checkout chain against eight planned hours, completes the linked job, grants consent and records the observation. It verifies exact-key replay, duplicate rejection, owner-only mutation, stale masking after an authorized reopen/correct/re-complete sequence, a refreshed five-hour observation, consent revocation, tenant isolation, immutable history, entry-only runtime privileges and exact migration checksum registration.

Slice A does not add external fleet or equipment imports, operating-cost outcomes, maintenance, downtime, condition, multi-job calibration, Learning Center UI or provider connectivity. Those remain Slices B-H.
