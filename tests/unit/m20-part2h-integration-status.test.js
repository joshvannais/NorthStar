'use strict';

const {
  AUTHORITY,
  PROVIDERS,
  readCanonicalIntegrationStatuses,
} = require('../../src/integrations/status');

function poolFor(rows) {
  return {
    query: jest.fn(async (_sql, _params) => ({ rows })),
  };
}

describe('Mission 20 Part 2H canonical integration status projection', () => {
  test('projects an exact provider-neutral status contract without provider identifiers or metadata', async () => {
    const pool = poolFor([
      { provider: 'retell', status: 'active', record_count: 1 },
      { provider: 'retell', status: 'inactive', record_count: 3 },
      { provider: 'voice', status: 'inactive', record_count: 2 },
    ]);

    const projected = await readCanonicalIntegrationStatuses(pool, 'organization-a');

    expect(AUTHORITY).toBe('canonical_integration_ownership');
    expect(PROVIDERS).toEqual(['retell', 'voice']);
    expect(projected).toEqual({
      authority: 'canonical_integration_ownership',
      connectors: [
        { provider: 'retell', status: 'active' },
        { provider: 'voice', status: 'inactive' },
      ],
    });
    expect(Object.keys(projected)).toEqual(['authority', 'connectors']);
    expect(projected.connectors.map(Object.keys)).toEqual([
      ['provider', 'status'],
      ['provider', 'status'],
    ]);
    expect(JSON.stringify(projected)).not.toMatch(/external|identifier|metadata|record_count|organization-a/i);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected.connectors.every(Object.isFrozen)).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual(['organization-a']);
    expect(pool.query.mock.calls[0][0]).toMatch(/WHERE organization_id = \$1/);
  });

  test('uses explicit not-provisioned and fail-closed ambiguous states', async () => {
    const none = await readCanonicalIntegrationStatuses(poolFor([]), 'organization-a');
    expect(none.connectors).toEqual([
      { provider: 'retell', status: 'not_provisioned' },
      { provider: 'voice', status: 'not_provisioned' },
    ]);

    const ambiguous = await readCanonicalIntegrationStatuses(poolFor([
      { provider: 'retell', status: 'active', record_count: 2 },
      { provider: 'voice', status: 'active', record_count: 1 },
    ]), 'organization-a');
    expect(ambiguous.connectors).toEqual([
      { provider: 'retell', status: 'ambiguous' },
      { provider: 'voice', status: 'active' },
    ]);
  });

  test.each([
    [null, 'Canonical PostgreSQL persistence is unavailable.'],
    [{}, 'Canonical PostgreSQL persistence is unavailable.'],
  ])('rejects a missing PostgreSQL authority', async (pool, message) => {
    await expect(readCanonicalIntegrationStatuses(pool, 'organization-a')).rejects.toMatchObject({
      code: 'CANONICAL_PERSISTENCE_UNAVAILABLE',
      status: 503,
      message,
    });
  });

  test.each([null, undefined, '', '   '])('rejects an absent tenant identity', async organizationId => {
    const pool = poolFor([]);
    await expect(readCanonicalIntegrationStatuses(pool, organizationId)).rejects.toMatchObject({
      code: 'INTEGRATION_STATUS_TENANT_REQUIRED',
      status: 403,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('fails closed on an impossible provider or status row', async () => {
    for (const rows of [
      [{ provider: 'stripe', status: 'active', record_count: 1 }],
      [{ provider: 'retell', status: 'unknown', record_count: 1 }],
      [{ provider: 'retell', status: 'active', record_count: -1 }],
    ]) {
      await expect(readCanonicalIntegrationStatuses(poolFor(rows), 'organization-a')).rejects.toMatchObject({
        code: 'INTEGRATION_STATUS_INVALID',
        status: 503,
      });
    }
  });
});
