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

describe('canonical organization cache consistency', () => {
  beforeEach(() => {
    cache.setEnabled(true);
    cache.clearForTests();
  });

  afterEach(() => {
    cache.setEnabled(true);
    cache.clearForTests();
  });

  test('an invalidation prevents an older concurrent read from repopulating stale data', async () => {
    const org = identity('org-a');
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const staleRead = cache.wrapCanonical(org, async function () {
      await delayed;
      return ['stale'];
    });

    await cache.invalidateOrg('org-a');
    release();
    expect(await staleRead).toEqual(['stale']);

    let freshFetches = 0;
    const fresh = await cache.wrapCanonical(org, async function () {
      freshFetches += 1;
      return ['fresh'];
    });
    const cachedFresh = await cache.wrapCanonical(org, async function () {
      throw new Error('fresh value should have been cached');
    });
    expect(fresh).toEqual(['fresh']);
    expect(cachedFresh).toEqual(['fresh']);
    expect(freshFetches).toBe(1);
  });

  test('organization A invalidation leaves organization B entries intact', async () => {
    const orgA = identity('org-a');
    const orgB = identity('org-b');
    await cache.setCanonical(orgA, ['a']);
    await cache.setCanonical(orgB, ['b']);
    const orgBKey = cache.buildCanonicalKey(orgB);

    await cache.invalidateOrg('org-a');

    expect(await cache.get(orgBKey)).toEqual(['b']);
    expect(await cache.get(cache.buildCanonicalKey(orgA))).toBeNull();
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
