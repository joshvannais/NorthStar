# Reviewed equipment authority — Mission 23 Part 5 writer candidate

This is an implementation contract, not independent approval or a release
receipt. Migration 046 is additive to released 001–045. Mission 20 remains the
tenant asset authority; the Mission 21 canonical JSON/source-version boundary
is extended with a separate NorthStar-controlled universal equipment registry.

## Public research and private asset instances

`equipment_import_reviewed` is an offline database-owner-only entry point.
The authenticated `session_user` must be the database owner, even when the
function is called through another security-definer function. The ordinary
runtime and PUBLIC have neither EXECUTE nor table access. There is no tenant
publication, browser import, platform administration UI, provider fetch, URL
fetcher, research seed, credential change, or provider activation in this part.

A NorthStar-controlled review supplies the exact manufacturer, model, model
year, series, engine/power configuration, and configuration; cited public
sources with URL, title, publisher, source version, source-content SHA-256,
access time; source-ordinal-linked specifications; confidence; reviewed time;
fresh-until time; and approved/conflict/revoked disposition. Import records the
authenticated importer, reviewer reference, review-evidence digest, reason,
exact predecessor, immutable version/digest, and database import time. Versions
are append-only. The import principal is responsible for actual source review;
the contract does not claim that syntactic validation verifies a source's truth.

An exact configuration digest resolves only its latest version. Missing,
stale, conflicting, revoked, superseded, low-confidence, unknown, and different
configurations cannot establish equipment use. A tenant attachment inventory
never enters this registry. A base vehicle match does not establish its actual
attachments: an exact cited `reviewed_attachment_configuration` public
specification must cover a non-`none` configuration, otherwise it needs review.
The universal importer rejects tenant-only fields instead of accepting a mixed
tenant/public document. Public specification review must never copy tenant data.

Serial/VIN, actual ownership/access, financing, condition, readings, location,
actual attachments, maintenance, fault, downtime, cost, and use context remain
tenant-private. No tenant draft or operation is an import source. No schema,
provider output, or category grants professional capability, qualification,
safety, insurance, ownership, availability, or legal status.

## One reviewed onboarding pipeline

Business Profile Vehicles & Equipment and Polaris's add-equipment conversation
both use `/api/equipment/drafts` and the same sequential draft actions.
The Polaris presentation shortcut requires an explicit add-equipment subject
(equipment, vehicle, machinery or a bounded equipment noun), or the literal
Ford F-350 example, optionally followed by a use/configuration phrase. It does
not match equipment words elsewhere in note prose. Other or ambiguous messages
continue through ordinary Polaris, including its existing selected-record gate.
This shortcut assigns no asset identity, category, research or capability and
does not change Business Profile's free-form reviewed intake contract.
Admission derives organization, user, role, durable session, CSRF and account
state from the server and database before optional provider assistance. The
existing server-only Responses runtime, existing entitlement and usage ledger,
`POLARIS_OPENAI_ENABLED`, and `OPENAI_API_KEY` remain the only provider boundary.
During writer validation every provider response is deterministic/intercepted;
the full mounted browser runs use the unconfigured manual path.

Provider assistance extracts literal identifiers from the user message, never
facts from model memory or web research. Both JavaScript and PostgreSQL validate
those substrings. Already supplied identifiers are not asked again. Missing
fields are asked one at a time; unknown values remain unknown. The complete
server draft, version, digest and research disposition are displayed before an
owner/admin submits `save_reviewed_asset` with exact revision/digest and an
idempotency key. No draft or AI suggestion creates a tenant asset silently.
Unknown/generic manufacturer or model cannot be saved. An exact identity with
unavailable research may be saved as needs_review, but cannot be operated.

Reviewed re-onboarding can target one active existing Mission 20 asset using its
exact current version/digest. Confirmation advances that same asset version and
preserves other private Mission 20 fields. Each confirmation stores an immutable
complete asset snapshot and exact research pin. Earlier snapshots and events
remain intact; stale target versions and old operation-source replays fail.
Existing manual identity changes invalidate the pin until explicit re-review.

Create/answer/confirm/cancel receipts, draft revisions, asset mutation, pin and
Mission 20 audit event commit atomically. Admission does not create a draft.
The request digest excludes provider assistance but includes the original exact
input; assistance is validated server-side and enters the first immutable
receipt. Replays return that receipt only after current authority validation and
do not repeat the provider call. Concurrent contenders may receive 409 and must
retry the same request, never blindly reapply a write. Drafts are session-bound,
expire after 24 hours, and are bounded to 20 current drafts per actor.

## Attributable execution evidence

`/api/equipment/executions/:id/actions` requires exact current execution and
Mission 22 assignment revisions/digests, exact active asset version/snapshot
digest, exact approved universal version/digest, and exact asset-ledger
revision/digest. Actor/session/role/CSRF, active performer, tenant scope, current
dispatch scope and accepted transcript-source authority are revalidated. New
facts require an in-progress execution and a scheduled, non-needs-review
assignment; the performer must belong to that exact current assignment.
Members may record only themselves inside current assigned scope; owner/admin
review authority is required for corrections and meter resets.

Distinct facts are check_out, use, check_in, reading, condition, fault,
downtime_start, downtime_end, maintenance and meter_reset. Each retains
operator, execution, source pins, observed time, recorded time/actor, reason,
description and optional explicit reading/unit. Units are hours, km, mi,
percent, litres, gallons or count; there is no implicit conversion. Cumulative
hours/distance/count cannot decrease without a reset/correction. Fuel/charge
gauges are observations and may fluctuate; percent is bounded to 100.

One asset cannot be checked out to two executions/operators. Use and check-in
must match its recorded checkout. Recorded downtime blocks checkout/use.
Faults produce needs_review; maintenance does not silently erase faults or
certify safety. Availability is unknown, recorded in use, recorded downtime,
or needs_review, never a positive safety/availability claim. Current invalid
research forces needs_review while separately retaining historical recorded
availability. Corrections append an exact predecessor link and recompute the
effective facts in original recording order without deleting source evidence.

The released supporting-authority snapshot fence covers asset writes and
universal imports. A session-shared advisory lock is acquired before the
serializable mutation or repeatable-read snapshot. Database row locks and
per-asset/idempotency advisory locks serialize transitions. Ten-second statement
and idle timeouts, two-second lock timeout, no implicit retry, immutable
history, deferred completeness constraints, and least-privilege runtime grants
bound and fail closed on partial/audit/concurrency failure.

Limits: uncompressed strict UTF-8 JSON 32 KiB; no duplicate keys, hostile Unicode
controls or noncanonical strings; 500 tenant assets; 10,000 ledger revisions;
64 meters and 32 KiB derived ledger state; 12 source citations; 48 public cited
specifications; at most 200 returned execution facts, with total/returned and
truthful truncation metadata. Part 9 will supply the full operational UI and
any expanded browsing workflow; this part does not fabricate a complete result
when the bound is reached.

## Surface and evidence boundaries

The catalogue renders inert text and safe HTTPS source links, only nonempty
server-classified categories, native collapsed disclosures with counts, search,
status filter, review/availability states and explicit retry paths. Both entry
paths save to the same categories. Existing fleet planning assumptions remain
separate in a collapsed section and are never asset or capability evidence.

Local test evidence and initial failures are recorded under
`outputs/m23-part5-writer`. Chrome and actual Playwright WebKit are distinct
from physical Safari/devices. Screen-reader semantics and keyboard checks do
not claim a physical assistive-technology session. Hosted CI, physical devices,
private production/provider operation, legal review and founder personal visual
approval remain unavailable. No merge, deployment, live research, provider call,
provider enablement, platform admin UI, or Parts 6–12 is authorized here.
