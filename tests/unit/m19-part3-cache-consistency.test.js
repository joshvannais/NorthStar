'use strict';

const cache = require('../../src/cache/client');

function identity(organizationId, endpoint) {
  return {
    organizationId,
    userId: 'user-' + organizationId,
    sessionId: 'session-' + organizationId,
    endpoint: endpoint || 'canonical.graphs',
    filters: { limit: 50 },
    readModelVersion: 'm19-part3-read-v1',
  };
}

describe('canonical reads never depend on process-local cache state', () => {
  beforeEach(() => {
    cache.setEnabled(true);
    cache.clearForTests();
  });

  afterEach(() => {
    cache.setEnabled(true);
    cache.clearForTests();
  });

  test('every canonical wrapper call executes its authoritative PostgreSQL read', async () => {
    const org = identity('org-a');
    let calls = 0;
    const first = await cache.wrapCanonical(org, async function () { calls += 1; return ['first']; });
    const second = await cache.wrapCanonical(org, async function () { calls += 1; return ['second']; });
    expect(first).toEqual(['first']);
    expect(second).toEqual(['second']);
    expect(calls).toBe(2);
  });

  test('canonical cache population is disabled even when generic caching is enabled', async () => {
    const org = identity('org-a');
    expect(await cache.setCanonical(org, ['stale'], 60)).toBe(false);
    expect(await cache.get(cache.buildCanonicalKey(org))).toBeNull();
  });

  test('disabled cache returns the same authoritative value without correctness dependencies', async () => {
    const org = identity('org-a');
    let calls = 0;
    cache.setEnabled(false);
    const first = await cache.wrapCanonical(org, async function () { calls += 1; return { value: 1 }; });
    const second = await cache.wrapCanonical(org, async function () { calls += 1; return { value: 1 }; });
    expect(first).toEqual(second);
    expect(calls).toBe(2);
    expect(cache.isRedisAvailable()).toBe(false);
  });
});
