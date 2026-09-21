'use strict';

const { graphRequest } = require('../../src/services/canonicalRetellIngestion');

function request(call) {
  return graphRequest({ event: 'call_ended', call: {
    call_id: 'synthetic_call', agent_id: 'synthetic_agent', ...call,
  } }, { organizationId: '11111111-1111-4111-8111-111111111111' }, null,
  'synthetic_event');
}

test('Retell epoch-millisecond start time becomes the canonical event instant', () => {
  expect(request({ start_timestamp: 1789905600000 }).occurredAt)
    .toBe('2026-09-20T12:00:00.000Z');
});

test('unknown numeric time stays unknown and does not become receipt time', () => {
  for (const value of [-1, 1789905600000.5, Number.MAX_VALUE, NaN]) {
    expect(request({ start_timestamp: value }).occurredAt).toBeNull();
  }
  expect(request({}).occurredAt).toBeNull();
});

test('preserves prior ISO-string provider timestamp support', () => {
  expect(request({ start_timestamp: '2026-09-20T12:00:00.000Z' }).occurredAt)
    .toBe('2026-09-20T12:00:00.000Z');
});
