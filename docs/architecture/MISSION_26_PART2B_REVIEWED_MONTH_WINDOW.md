# Mission 26 Part 2B: reviewed historical month window

Status: isolated, unreleased bounded integration candidate. Full Part 2B remains open.

The paid owner/admin `GET /api/v1/forecast/reporting-windows/reviewed-month-window?localStartDate=YYYY-MM-01` endpoint joins the [immutable owner-reviewed month claim](MISSION_26_PART2B_REVIEWED_PROFILE_MONTH.md) to its pinned Business Profile revision and the released reporting-window projection. Both guarded reads use one repeatable-read transaction so a claim and profile cannot come from different database snapshots. The route rechecks the normalized profile hash and requires the stored private raw-profile digest pin to remain valid. It returns only the derived tenant-wide local-month window and a minimized claim identity, never the raw Business Profile or private digest.

No claim, a revocation or a changed profile yields `window: null` with an explicit unavailable reason. A surviving claim says that an authorized owner or administrator asserted historical applicability; it does **not** independently verify the old business calendar, prove complete observations, make a source eligible, or issue a forecast. All those flags remain false even when a window is returned. This endpoint does not change Mission 20 Business Profile history or Mission 22 scheduling authority, and no price or demand forecast consumes this window yet.

Mounted disposable-PostgreSQL tests use fictional tenants to cover missing claim, confirmed pinned window, later raw-calendar change, revocation, tenant and role isolation, strict request shape, private response and withheld forecast claims. The existing current-profile route remains available. CI, private production, provider, physical-device and live historical evidence are not claimed.
