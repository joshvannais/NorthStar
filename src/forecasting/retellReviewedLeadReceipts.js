'use strict';

// Internal source projection only. A reviewed call set is not evidence that
// Retell retained every historical call or that a reporting period is complete.
const READ = `SELECT
 public.canonical_forecast_retell_call_snapshot_read($1,$2,$3,$4,$5) source,
 public.canonical_forecast_retell_call_reviews_read($1,$2,$3,$4,$5) reviews`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d{3})(\d{3})?Z$/;

function time(value) {
  const match = typeof value === 'string' ? INSTANT.exec(value) : null;
  if (!match) return null;
  const millisecondInstant = `${match[1]}.${match[2]}Z`;
  const parsed = Date.parse(millisecondInstant);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== millisecondInstant)
    return null;
  return BigInt(parsed) * 1000n + BigInt(match[3] || '000');
}

function unavailable(reason) { return Object.freeze({ state: 'unavailable', reason }); }

async function readReviewedRetellLeadReceipts({ pool, actor, snapshotId, startsAt, endsAt }) {
  const start = time(startsAt), end = time(endsAt);
  const normalizedSnapshotId = typeof snapshotId === 'string' ? snapshotId.toLowerCase() : snapshotId;
  if (!pool?.query || !actor || !UUID.test(snapshotId) || start === null || end === null ||
      end <= start || end - start > 35n * 86400000000n) return unavailable('invalid_source_window');
  const params = [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
    actor.authSessionId, normalizedSnapshotId];
  // Both SECURITY DEFINER reads execute inside one statement snapshot and
  // enforce current tenant, actor, session, entitlement and source consent.
  const row = (await pool.query(READ, params)).rows[0];
  const source = row?.source, reviews = row?.reviews;
  const sourceAsOf = time(source?.asOf);
  if (!source || !reviews || source.stale !== false || reviews.stale !== false ||
      source.id !== normalizedSnapshotId || reviews.snapshotId !== normalizedSnapshotId ||
      source.sourceSnapshotDigest !== reviews.sourceSnapshotDigest ||
      !DIGEST.test(source.sourceSnapshotDigest) || !Array.isArray(source.sources) ||
      !Array.isArray(reviews.calls) || source.sources.length !== reviews.calls.length ||
      source.sources.length > 1000 || sourceAsOf === null || end > sourceAsOf) {
    return unavailable('source_unavailable');
  }
  const byId = new Map();
  for (const review of reviews.calls) {
    if (!review || !UUID.test(review.callSourceId) || byId.has(review.callSourceId))
      return unavailable('review_source_mismatch');
    byId.set(review.callSourceId, review);
  }
  const leads = [];
  const pinnedIds = new Set();
  let callCount = 0;
  for (const pin of source.sources) {
    const event = time(pin?.eventAt);
    if (!UUID.test(pin?.sourceId) || pinnedIds.has(pin.sourceId) ||
        !DIGEST.test(pin?.digest) || event === null || event > sourceAsOf)
      return unavailable('call_occurrence_unknown');
    pinnedIds.add(pin.sourceId);
    const review = byId.get(pin.sourceId);
    if (!review) return unavailable('review_source_mismatch');
    if (event < start || event >= end) continue;
    callCount += 1;
    const reviewedAt = time(review.reviewedAt);
    if (review.status !== 'reviewed' || reviewedAt === null || reviewedAt < event ||
        !DIGEST.test(review.reviewDigest) ||
        !['new_lead', 'repeat_lead', 'not_lead'].includes(review.disposition))
      return unavailable('call_review_incomplete');
    if (review.disposition === 'new_lead') {
      leads.push(Object.freeze({ organizationId: actor.organizationId,
        leadId: pin.sourceId, firstReceiptAt: pin.eventAt,
        reviewedAt: review.reviewedAt,
        sourceDigest: pin.digest, state: 'active' }));
    }
  }
  return Object.freeze({ state: 'reviewed_source_only', sourceSnapshotDigest: source.sourceSnapshotDigest,
    callCount, reviewedDistinctLeadCount: leads.length,
    leadReceipts: Object.freeze(leads), historicalCoverageCertified: false,
    boundary: 'Reviewed identities only; no caller consent, retention, provider coverage or forecast is certified.' });
}

module.exports = { readReviewedRetellLeadReceipts };
