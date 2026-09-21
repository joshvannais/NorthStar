# Mission 25 Part 12H external financial outcome operations

Part 12H records tenant-private advice from current external financial evidence that an owner or administrator has explicitly reviewed against one NorthStar estimate. A separate financial-outcome permission must pin the current financial source permission before an observation can be recorded.

The observation reports four independent areas:

- Revenue uses only explicit posted accounting entries whose basis is revenue.
- Collection uses only explicit collection records whose basis is amount collected. An invoice or payment state does not prove collection.
- Realized cost uses only explicit posted accounting entries whose basis is direct cost, overhead cost or other cost.
- Margin is available only when recorded revenue and recorded realized cost use the same currency and revenue is greater than zero. It is the difference between those external recorded amounts, not a native NorthStar profit record.

Each contributing external reference needs exactly one current source record and a current reviewed link to the same NorthStar estimate. Unknown accounting treatment, duplicate records, stale links, non-posted revenue or cost, unavailable amounts and mixed currencies make the affected result unavailable. A reviewed accounting entry with no amount or category withholds both revenue and realized cost because the source does not say which one it affects. A reviewed collection entry with no amount withholds collection. These records remain in the exact source manifest and cannot be ignored beside otherwise valid amounts. Missing records or amounts never become zero. No exchange rate, invoice revenue, payment collection, reversal sign or financial completeness is inferred.

Every observation pins the current source-permission period, purpose-permission period, complete relevant reviewed-reference set, exact source manifests, current NorthStar estimate basis, calculation version and request identity. A correction, tombstone, source or purpose permission change, reviewed-link change or NorthStar target change makes prior advice stale. Revocation hides derived history. A later grant starts a new period and does not revive earlier evidence, links or observations.

The result is advisory and changes no customer, job, estimate, schedule, price, imported record, financial record or company policy. Native NorthStar invoice, payment, collection, accounting, revenue, cost and margin records remain unavailable until Mission 27. This API-only slice adds no rendered owner surface. Slices I-K remain mandatory for calibration, lifecycle operations and the complete Learning Center experience.

No live provider, provider credential, private production account, production migration, deployment, physical-device review or manual assistive-technology review is claimed.
