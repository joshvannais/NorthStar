'use strict';

const {
  CATALOGUE_AUTHORITY,
  CATALOGUE_VERSION,
  CATEGORY_KEYS,
  PRESENTATION_STATES,
  PROVIDER_KEYS,
  projectIntegrationCatalogue,
  readIntegrationCatalogue,
} = require('../../src/integrations/catalogue');

const EXPECTED_CATEGORIES = Object.freeze([
  'communications_ai',
  'calendar_scheduling',
  'accounting_payments',
  'field_service_crm',
  'workflow_data',
  'maps_navigation',
  'enterprise_assets_inventory',
]);

const EXPECTED_PROVIDERS = Object.freeze([
  'retell', 'voice', 'twilio', 'openai', 'elevenlabs', 'email',
  'google_calendar', 'microsoft_calendar', 'apple_calendar',
  'quickbooks', 'stripe', 'square',
  'jobber', 'housecall_pro', 'servicetitan', 'salesforce',
  'google_sheets', 'zapier',
  'google_maps', 'apple_maps', 'waze',
  'procore', 'netsuite', 'dynamics_365', 'samsara', 'fleetio',
]);

const SAFE_PROVIDER_KEYS = Object.freeze([
  'key', 'name', 'mark', 'description', 'presentation', 'authority', 'capabilities',
]);

const MAP_PROVIDER_DESCRIPTION =
  'Canonical provider preferences are managed in the Map launch preferences panel below; ' +
  'provider connection and destination-launch/navigation actions are not included.';

function canonicalStatuses(retell, voice) {
  return {
    authority: 'canonical_integration_ownership',
    connectors: [
      { provider: 'retell', status: retell },
      { provider: 'voice', status: voice },
    ],
  };
}

function providers(projected) {
  return projected.categories.flatMap(category => category.providers);
}

function byKey(projected, key) {
  return providers(projected).find(provider => provider.key === key);
}

describe('Mission 20 Phase 6C provider-neutral integration catalogue', () => {
  test('exports exact immutable machine ordering and the accepted presentation vocabulary', () => {
    expect(CATALOGUE_AUTHORITY).toBe('northstar_integration_catalogue_v1');
    expect(CATALOGUE_VERSION).toBe(1);
    expect(PRESENTATION_STATES).toEqual([
      'available',
      'coming_soon',
      'requires_provider_approval',
      'connected',
      'syncing',
      'needs_attention',
      'disconnected',
    ]);
    expect(CATEGORY_KEYS).toEqual(EXPECTED_CATEGORIES);
    expect(PROVIDER_KEYS).toEqual(EXPECTED_PROVIDERS);
    expect(Object.isFrozen(PRESENTATION_STATES)).toBe(true);
    expect(Object.isFrozen(CATEGORY_KEYS)).toBe(true);
    expect(Object.isFrozen(PROVIDER_KEYS)).toBe(true);
  });

  test.each([
    ['active', 'connected', 'Connected'],
    ['inactive', 'disconnected', 'Disconnected'],
    ['ambiguous', 'needs_attention', 'Needs attention'],
    ['not_provisioned', 'requires_provider_approval', 'Requires provider approval'],
  ])('maps canonical Retell %s without client inference', (authorityStatus, state, label) => {
    const projected = projectIntegrationCatalogue(canonicalStatuses(authorityStatus, authorityStatus));
    for (const key of ['retell', 'voice']) {
      expect(byKey(projected, key).presentation).toEqual({ state, label });
      expect(byKey(projected, key).authority).toEqual({
        configuration: 'canonical_business_profiles.voiceAssistant',
        connection: 'canonical_integration_ownership',
        basis: authorityStatus,
      });
    }
  });

  test('projects the exact safe provider catalogue without unsupported connection claims', () => {
    const projected = projectIntegrationCatalogue(canonicalStatuses('active', 'inactive'));
    expect(projected).toMatchObject({
      authority: 'northstar_integration_catalogue_v1',
      version: 1,
      readOnly: true,
    });
    expect(projected.categories.map(category => category.key)).toEqual(EXPECTED_CATEGORIES);
    expect(providers(projected).map(provider => provider.key)).toEqual(EXPECTED_PROVIDERS);
    expect(new Set(providers(projected).map(provider => provider.key)).size).toBe(26);

    const stripe = byKey(projected, 'stripe');
    expect(stripe.presentation).toEqual({
      state: 'requires_provider_approval',
      label: 'Requires provider approval',
    });
    expect(stripe.authority).toEqual({
      configuration: 'authority_missing',
      connection: 'authority_missing',
      basis: 'provider_approval_required',
    });

    for (const provider of providers(projected)) {
      expect(Object.keys(provider)).toEqual(SAFE_PROVIDER_KEYS);
      expect(PRESENTATION_STATES).toContain(provider.presentation.state);
      expect(provider.capabilities).toEqual({
        management: 'unavailable',
        authorization: 'unavailable',
        scopes: 'unavailable',
        dataDirection: 'none',
        sync: 'unavailable',
        lastSync: 'unavailable',
        error: 'unavailable',
        reconnect: 'unavailable',
        mappings: 'unavailable',
        webhookHealth: 'unavailable',
      });
      if (!['retell', 'voice', 'stripe'].includes(provider.key)) {
        expect(provider.presentation).toEqual({ state: 'coming_soon', label: 'Coming soon' });
        expect(provider.authority.connection).toBe('authority_missing');
      }
    }
    for (const key of ['google_maps', 'apple_maps', 'waze']) {
      const provider = byKey(projected, key);
      expect(provider.description).toBe(MAP_PROVIDER_DESCRIPTION);
      expect(provider.presentation).toEqual({ state: 'coming_soon', label: 'Coming soon' });
      expect(provider.authority).toEqual({
        configuration: 'authority_missing',
        connection: 'authority_missing',
        basis: 'catalogue_only_navigation_deferred',
      });
      expect(provider.description).not.toMatch(/preference(?:s)?(?: and launcher logic)? (?:are )?(?:absent|not included)/i);
    }
    expect(byKey(projected, 'jobber').authority.basis).toBe('source_disabled');
    expect(byKey(projected, 'servicetitan').description).toMatch(/read-only/i);
  });

  test('is deeply immutable, deterministic, and cannot be poisoned by a prior caller', () => {
    const first = projectIntegrationCatalogue(canonicalStatuses('active', 'inactive'));
    const firstBytes = JSON.stringify(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.categories)).toBe(true);
    expect(first.categories.every(Object.isFrozen)).toBe(true);
    expect(providers(first).every(Object.isFrozen)).toBe(true);
    expect(providers(first).every(provider => Object.isFrozen(provider.presentation))).toBe(true);
    expect(providers(first).every(provider => Object.isFrozen(provider.authority))).toBe(true);
    expect(providers(first).every(provider => Object.isFrozen(provider.capabilities))).toBe(true);
    expect(() => { first.categories[0].providers[0].name = 'poison'; }).toThrow();

    const second = projectIntegrationCatalogue(canonicalStatuses('active', 'inactive'));
    expect(JSON.stringify(second)).toBe(firstBytes);
    expect(byKey(second, 'retell').name).toBe('Retell');
  });

  test('contains no credential, identifier, tenant, environment, secret, token, metadata, or provider-response fields', () => {
    const projected = projectIntegrationCatalogue(canonicalStatuses('active', 'inactive'));
    const keys = [];
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        keys.push(key);
        walk(child);
      }
    };
    walk(projected);
    expect(keys.join('\n')).not.toMatch(/external|identifier|tenant|organization|user|agent|phone|credential|secret|token|metadata|environment|providerResponse|lastSyncAt/i);
    expect(JSON.stringify(projected)).not.toMatch(/private-id|api[_-]?key|bearer|oauth[_-]?token/i);
  });

  test('reads exactly once through the existing tenant-scoped canonical status authority', async () => {
    const readStatuses = jest.fn(async (_pool, organizationId) => {
      expect(organizationId).toBe('organization-a');
      return canonicalStatuses('active', 'not_provisioned');
    });
    const pool = Object.freeze({ sentinel: true });
    const projected = await readIntegrationCatalogue(pool, 'organization-a', { readStatuses });
    expect(readStatuses).toHaveBeenCalledTimes(1);
    expect(readStatuses).toHaveBeenCalledWith(pool, 'organization-a');
    expect(byKey(projected, 'retell').presentation.label).toBe('Connected');
    expect(byKey(projected, 'voice').presentation.label).toBe('Requires provider approval');
  });

  test.each([
    [null],
    [{}],
    [{ authority: 'wrong', connectors: [] }],
    [canonicalStatuses('unknown', 'active')],
    [{ authority: 'canonical_integration_ownership', connectors: [{ provider: 'retell', status: 'active' }] }],
  ])('fails closed on invalid canonical status input %#', input => {
    expect(() => projectIntegrationCatalogue(input)).toThrow(expect.objectContaining({
      code: 'INTEGRATION_CATALOGUE_INVALID',
      status: 503,
    }));
  });
});
