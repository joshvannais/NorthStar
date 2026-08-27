# M22-P5-012 closure

## Validated cause

`operatorDirectory` capped profiles and crews at 100 and truthfully exposed
`truncated=true`, but the shared Calendar/Command Center target selector consumed
only the first `targets` array. It ignored truncation and had no current server-
side page or search path. Valid workers and crews beyond the first 100 were
therefore unreachable for assignment and reassignment.

## Narrow correction

- Initial directory queries retain their independent 100-per-kind resource
  bounds and now publish exact per-kind and combined shown/total counts.
- `GET /api/v1/canonical/operator-targets` returns at most 25 current targets,
  ordered by kind, C-collated label, and UUID. A canonical cursor carries the
  tenant, exact query, kind, label, and UUID boundary.
- Search is an exact UUID or case-insensitive label prefix. It is NFC-normalized,
  trimmed, limited to 100 characters/400 UTF-8 bytes, and contains no control
  bytes. Cursor input is canonical unpadded base64url JSON limited to 4,096
  bytes and rejects unknown keys, wrong schema/order/tenant/query/kind/label/ID,
  padding, trailing bytes, and invalid UTF-8 before the directory query.
- Each directory response reads actor authority and targets inside one read-only
  repeatable-read PostgreSQL snapshot. Only active workers and crews with a
  current active member are returned.
- The shared dialog visibly reports incomplete, loading, empty, ready, final-
  page, and error states. Search and Next controls are keyboard/touch operable;
  labels and hostile bytes use DOM creation and `textContent`.
- Safe read-only operators can inspect current targets but cannot preview/apply.
  Existing Part 4 preview/approval rechecks deactivation, crew, role, session,
  subscription, tenant, revision, and evidence changes before mutation.

## Mounted closure

A fresh PostgreSQL 18.4 UTC tenant with 105 profiles and 102 active crews proves
200/207 initial coverage, nine stable pages with 207 unique keys, last worker
and crew reachability, three duplicate/hostile matches, employee and cross-
tenant denial, read-only subscription separation, inactive target exclusion,
and preview/approval stale rejection after deactivation. Both Calendar and
Command Center real-visible controls complete the formerly unreachable target
flows in installed Chrome and actual Playwright WebKit.
