'use strict';

const {
  recordProductEvent,
  resetForTests,
  sanitizeProductEvent,
} = require('../../src/observability/productTelemetry');

const valid = Object.freeze({
  event: 'cta_click',
  surface: 'public',
  routeClass: 'home',
  action: 'homepage_explore_demo',
  elapsedBucket: 'under_15s',
});

describe('privacy-bounded product telemetry', () => {
  beforeEach(() => resetForTests());

  test('accepts only the exact closed analytics envelope', () => {
    expect(sanitizeProductEvent(valid)).toEqual(valid);
    expect(sanitizeProductEvent({ ...valid, email: 'person@example.com' })).toBeNull();
    expect(sanitizeProductEvent({ ...valid, routeClass: '/demo?token=secret' })).toBeNull();
    expect(sanitizeProductEvent({ ...valid, action: 'customer_name' })).toBeNull();
    expect(sanitizeProductEvent({ ...valid, event: 'keystroke' })).toBeNull();
  });

  test('logs only closed dimensions and an aggregate count', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    expect(recordProductEvent(valid)).toEqual(valid);
    expect(recordProductEvent(valid)).toEqual(valid);
    expect(info).toHaveBeenLastCalledWith({
      component: 'product_telemetry',
      event: 'aggregate_updated',
      eventClass: 'cta_click',
      surface: 'public',
      routeClass: 'home',
      action: 'homepage_explore_demo',
      elapsedBucket: 'under_15s',
      count: 2,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('person@example.com');
    info.mockRestore();
  });
});
