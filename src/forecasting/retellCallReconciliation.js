'use strict';

const { createHash } = require('crypto');
const { listInboundCallsPage } = require('../retell/client');

const CALL_ID = /^[A-Za-z0-9_-]{1,160}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PAGE_LIMIT = 50;
const MAX_CALLS = 1000;
const MAX_PAGES = 21;

function unavailable(reason) {
  return Object.freeze({ state: 'unavailable', reason });
}

function instantMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isSafeInteger(ms) && new Date(ms).toISOString() === value ? ms : null;
}

/**
 * Diagnostic comparison only. A matched API scan is not a historical coverage
 * certificate, caller-consent receipt, lead identity, or forecast observation.
 * The caller must resolve the current tenant-owned agent and canonical pins
 * through the existing guarded authorities; this module exposes no route.
 */
async function reconcileRetellInboundCalls(input, fetchPage = listInboundCallsPage) {
  const startsAtMs = instantMs(input?.startsAt);
  const endsAtMs = instantMs(input?.endsAt);
  const agentId = input?.agentId;
  const expected = input?.canonicalCallDigests;
  if (typeof agentId !== 'string' || !CALL_ID.test(agentId) ||
      startsAtMs === null || endsAtMs === null || endsAtMs <= startsAtMs ||
      endsAtMs - startsAtMs > 35 * 86400000 || !Array.isArray(expected) ||
      expected.length > MAX_CALLS ||
      Array.from({ length: expected.length }, (_, index) => index).some(index =>
        !Object.prototype.hasOwnProperty.call(expected, index) ||
        typeof expected[index] !== 'string' || !DIGEST.test(expected[index])) ||
      new Set(expected).size !== expected.length || typeof fetchPage !== 'function') {
    return unavailable('invalid_scan_input');
  }

  const observed = new Set();
  const cursors = new Set();
  let cursor;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    let page;
    try {
      page = await fetchPage({ agentId, startsAtMs, endsAtMs, paginationKey: cursor });
    } catch (_error) {
      return unavailable('provider_request_failed');
    }
    if (!page || typeof page !== 'object' || typeof page.has_more !== 'boolean' ||
        !Array.isArray(page.items) || page.items.length > PAGE_LIMIT ||
        (pageNumber > 0 && page.items.length === 0) ||
        (page.has_more && (page.items.length === 0 || typeof page.pagination_key !== 'string' ||
          !page.pagination_key || page.pagination_key.length > 512 || cursors.has(page.pagination_key)))) {
      return unavailable('provider_page_invalid');
    }
    for (const item of page.items) {
      if (!item || item.agent_id !== agentId || item.call_type !== 'phone_call' ||
          item.direction !== 'inbound' || typeof item.call_id !== 'string' ||
          !CALL_ID.test(item.call_id) ||
          !Number.isSafeInteger(item.start_timestamp) ||
          item.start_timestamp < startsAtMs || item.start_timestamp >= endsAtMs ||
          item.call_status !== 'ended') {
        return unavailable('provider_call_unresolved');
      }
      const digest = createHash('sha256').update(item.call_id, 'utf8').digest('hex');
      if (observed.has(digest)) return unavailable('provider_duplicate_call');
      observed.add(digest);
      if (observed.size > MAX_CALLS) return unavailable('scan_limit_exceeded');
    }
    if (!page.has_more) {
      const expectedSet = new Set(expected);
      const missingInNorthStar = [...observed].some(digest => !expectedSet.has(digest));
      const missingAtProvider = expected.some(digest => !observed.has(digest));
      if (missingInNorthStar || missingAtProvider) return unavailable('source_records_disagree');
      return Object.freeze({ state: 'snapshot_matched', callCount: observed.size,
        historicalCoverageCertified: false });
    }
    cursors.add(page.pagination_key);
    cursor = page.pagination_key;
  }
  return unavailable('scan_limit_exceeded');
}

module.exports = { reconcileRetellInboundCalls };
