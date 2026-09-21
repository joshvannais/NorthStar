'use strict';

const { createHash } = require('crypto');
const config = require('../../src/config');
const { listInboundCallsPage } = require('../../src/retell/client');
const { reconcileRetellInboundCalls } = require('../../src/forecasting/retellCallReconciliation');

const startsAt = '2026-08-01T00:00:00.000Z';
const endsAt = '2026-09-01T00:00:00.000Z';
const startMs = Date.parse(startsAt);
const digest = id => createHash('sha256').update(id).digest('hex');
const call = (id, overrides = {}) => ({
  call_id: id, agent_id: 'agent_tenant_a', call_type: 'phone_call',
  direction: 'inbound', call_status: 'ended', start_timestamp: startMs + 1000,
  ...overrides,
});
const input = ids => ({ agentId: 'agent_tenant_a', startsAt, endsAt,
  canonicalCallDigests: ids.map(digest) });

describe('Mission 26 Retell call-list diagnostic', () => {
  test('exhausts pages and compares call identities without claiming certified coverage', async () => {
    const pages = [
      { has_more: true, pagination_key: 'next_page', items: [call('call_a')] },
      { has_more: false, items: [call('call_b')] },
    ];
    const fetchPage = jest.fn(async () => pages.shift());
    await expect(reconcileRetellInboundCalls(input(['call_a', 'call_b']), fetchPage)).resolves.toEqual({
      state: 'snapshot_matched', callCount: 2, historicalCoverageCertified: false,
    });
    expect(fetchPage.mock.calls[1][0].paginationKey).toBe('next_page');
  });

  test.each([
    ['unmatched provider call', input([]), { has_more: false, items: [call('call_a')] }, 'source_records_disagree'],
    ['missing provider call', input(['call_a']), { has_more: false, items: [] }, 'source_records_disagree'],
    ['cross-agent result', input([]), { has_more: false, items: [call('call_a', { agent_id: 'agent_tenant_b' })] }, 'provider_call_unresolved'],
    ['outbound result', input([]), { has_more: false, items: [call('call_a', { direction: 'outbound' })] }, 'provider_call_unresolved'],
    ['ongoing result', input([]), { has_more: false, items: [call('call_a', { call_status: 'ongoing' })] }, 'provider_call_unresolved'],
    ['outside window', input([]), { has_more: false, items: [call('call_a', { start_timestamp: Date.parse(endsAt) })] }, 'provider_call_unresolved'],
    ['missing cursor', input([]), { has_more: true, items: [call('call_a')] }, 'provider_page_invalid'],
    ['duplicate call', input(['call_a']), { has_more: false, items: [call('call_a'), call('call_a')] }, 'provider_duplicate_call'],
  ])('%s fails closed', async (_name, source, page, reason) => {
    await expect(reconcileRetellInboundCalls(source, async () => page)).resolves.toEqual({
      state: 'unavailable', reason,
    });
  });

  test('provider failure and cursor loops are unavailable', async () => {
    await expect(reconcileRetellInboundCalls(input([]), async () => { throw Error('private provider detail'); }))
      .resolves.toEqual({ state: 'unavailable', reason: 'provider_request_failed' });
    const page = { has_more: true, pagination_key: 'same', items: [call('call_a')] };
    await expect(reconcileRetellInboundCalls(input(['call_a']), async () => page))
      .resolves.toEqual({ state: 'unavailable', reason: 'provider_page_invalid' });
  });

  test('Retell transport pins the tenant agent, inbound phone type, window and page limit', async () => {
    const oldFetch = global.fetch;
    const oldKey = config.retell.apiKey;
    config.retell.apiKey = 'test-key';
    global.fetch = jest.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ has_more: false, items: [] }) }));
    try {
      await listInboundCallsPage({ agentId: 'agent_tenant_a', startsAtMs: startMs,
        endsAtMs: Date.parse(endsAt) });
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.retellai.com/v3/list-calls');
      expect(JSON.parse(options.body)).toEqual({
        filter_criteria: {
          agent: [{ agent_id: 'agent_tenant_a' }],
          call_type: { type: 'enum', op: 'in', value: ['phone_call'] },
          direction: { type: 'enum', op: 'in', value: ['inbound'] },
          start_timestamp: { type: 'range', op: 'bt', value: [startMs, Date.parse(endsAt) - 1] },
        }, sort_order: 'ascending', limit: 50, include_total: false,
      });
    } finally {
      global.fetch = oldFetch;
      config.retell.apiKey = oldKey;
    }
  });
});
