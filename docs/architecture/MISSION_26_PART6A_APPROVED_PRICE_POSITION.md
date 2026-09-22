# Mission 26 Part 6A — historical approved-price position

`summarizeApprovedPriceFlow` interprets a bounded Mission 24 approved-price
event receipt through the released decision-lineage validator. It sums the
**first** human approval for each estimate whose recorded time falls in an
exact half-open UTC window. Later amendments and withdrawals stay visible in
the source lineage but do not rewrite the historical first-approval flow.
Unlike currency amounts in one window make the position unavailable; they
are never converted or summed. Empty input yields a descriptive zero only
for the caller-supplied receipt.

This is unmounted historical arithmetic. The caller's receipt does not prove
tenant authority, complete coverage, currentness or source digest integrity.
The result therefore retains `sourceAuthenticated: false`,
`currentnessVerified: false` and `forecastIssued: false`. It is approved
commercial price activity, not booked work, earned revenue or cash collected.
Only the existing guarded snapshot reader can authorize source access. A
future integration must bind its receipt, currentness result and calculation
in one consistent authorized transaction before numerical promotion. Mission
22 must separately authenticate first bookings and reviewed price-at-booking
links; Mission 27 owns native invoice and payment evidence.

Focused synthetic tests cover first approvals, amendments, withdrawals,
half-open microsecond windows, exact-cent sums, mixed currency and invalid
lineage. They do not establish paid-tenant source coverage or a forecast.
