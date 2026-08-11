'use strict';

const {
  AUTHORITY,
  CONTRACT_VERSION,
  PROVIDERS,
  defaultPreferenceDocument,
  parseOrganizationWrite,
  parseUserWrite,
  projectMapPreferences,
} = require('../../src/mapPreferences/contract');

function preferences(overrides = {}) {
  return {
    providers: {
      google_maps: { enabled: true, visible: true },
      apple_maps: { enabled: true, visible: true },
      waze: { enabled: true, visible: true },
      ...(overrides.providers || {}),
    },
    defaultProvider: overrides.defaultProvider || 'google_maps',
  };
}

function organizationRow(overrides = {}) {
  return {
    organization_id: 'organization-a',
    google_maps_enabled: true,
    google_maps_visible: true,
    apple_maps_enabled: true,
    apple_maps_visible: true,
    waze_enabled: true,
    waze_visible: true,
    default_provider: 'google_maps',
    version: '1',
    authority_source: 'system_default',
    updated_at: new Date('2026-08-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Mission 20 Phase 6D canonical map preference contract', () => {
  test('publishes one immutable fixed provider vocabulary and deterministic default', () => {
    expect(AUTHORITY).toBe('canonical_map_preferences_v1');
    expect(CONTRACT_VERSION).toBe(1);
    expect(PROVIDERS).toEqual([
      { key: 'google_maps', name: 'Google Maps' },
      { key: 'apple_maps', name: 'Apple Maps' },
      { key: 'waze', name: 'Waze' },
    ]);
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
    expect(PROVIDERS.every(Object.isFrozen)).toBe(true);
    expect(defaultPreferenceDocument()).toEqual(preferences());
  });

  test('accepts exact organization writes while visibility remains independent of enabled', () => {
    const input = {
      expectedVersion: 7,
      preferences: preferences({
        providers: {
          google_maps: { enabled: false, visible: true },
          apple_maps: { enabled: true, visible: false },
          waze: { enabled: true, visible: true },
        },
        defaultProvider: 'apple_maps',
      }),
    };
    expect(parseOrganizationWrite(input)).toEqual(input);
  });

  test.each([
    null,
    {},
    { expectedVersion: 0, preferences: preferences() },
    { expectedVersion: 1, preferences: { ...preferences(), unexpected: true } },
    { expectedVersion: 1, preferences: { providers: {}, defaultProvider: 'google_maps' } },
    { expectedVersion: 1, preferences: preferences({ providers: { google_maps: { enabled: 1, visible: true } } }) },
    { expectedVersion: 1, preferences: preferences({ providers: { google_maps: { enabled: false, visible: true } } }) },
    { expectedVersion: 1, preferences: preferences({ defaultProvider: 'unsupported' }) },
  ])('rejects malformed or default-disabled organization input %#', input => {
    expect(() => parseOrganizationWrite(input)).toThrow(expect.objectContaining({
      code: 'MAP_PREFERENCES_INVALID', status: 400,
    }));
  });

  test('supports an exact complete self override and an explicit inherit state', () => {
    const override = { expectedVersion: 0, mode: 'override', preferences: preferences() };
    const inherit = { expectedVersion: 4, mode: 'inherit' };
    expect(parseUserWrite(override)).toEqual(override);
    expect(parseUserWrite(inherit)).toEqual(inherit);
  });

  test.each([
    { expectedVersion: 0, mode: 'inherit', preferences: preferences() },
    { expectedVersion: 0, mode: 'override' },
    { expectedVersion: -1, mode: 'inherit' },
    { expectedVersion: 0, mode: 'other' },
    { expectedVersion: 0, mode: 'override', preferences: preferences(), userId: 'other-user' },
  ])('rejects ambiguous, partial, or targetable self input %#', input => {
    expect(() => parseUserWrite(input)).toThrow(expect.objectContaining({
      code: 'MAP_PREFERENCES_INVALID', status: 400,
    }));
  });

  test('projects truthful organization inheritance for a user with no stored row', () => {
    const projected = projectMapPreferences({
      organization: organizationRow(), user: null, role: 'viewer',
    });
    expect(projected).toEqual({
      authority: 'canonical_map_preferences_v1',
      contractVersion: 1,
      providers: PROVIDERS,
      organization: {
        version: 1,
        preferences: preferences(),
        source: 'system_default',
        updatedAt: '2026-08-10T00:00:00.000Z',
      },
      user: {
        version: 0,
        mode: 'inherit',
        hasStoredAuthority: false,
        preferences: null,
        updatedAt: null,
      },
      effective: {
        source: 'organization',
        inheritsOrganization: true,
        organizationVersion: 1,
        userVersion: 0,
        preferences: preferences(),
      },
      permissions: { canUpdateOrganization: false, canUpdateSelf: true },
    });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.effective.preferences.providers.google_maps)).toBe(true);
  });

  test('projects a complete user override without mutating the organization document', () => {
    const row = organizationRow();
    const projected = projectMapPreferences({
      organization: row,
      user: {
        mode: 'override',
        google_maps_enabled: false,
        google_maps_visible: true,
        apple_maps_enabled: true,
        apple_maps_visible: false,
        waze_enabled: false,
        waze_visible: false,
        default_provider: 'apple_maps',
        version: '3',
        updated_at: new Date('2026-08-10T01:00:00.000Z'),
      },
      role: 'admin',
    });
    expect(projected.organization.preferences).toEqual(preferences());
    expect(projected.user).toMatchObject({ version: 3, mode: 'override', hasStoredAuthority: true });
    expect(projected.effective).toMatchObject({
      source: 'user_override', inheritsOrganization: false, organizationVersion: 1, userVersion: 3,
    });
    expect(projected.effective.preferences).toEqual({
      providers: {
        google_maps: { enabled: false, visible: true },
        apple_maps: { enabled: true, visible: false },
        waze: { enabled: false, visible: false },
      },
      defaultProvider: 'apple_maps',
    });
    expect(projected.permissions).toEqual({ canUpdateOrganization: true, canUpdateSelf: true });
  });

  test.each([
    { organization: null, user: null, role: 'owner' },
    { organization: organizationRow({ version: '0' }), user: null, role: 'owner' },
    { organization: organizationRow({ default_provider: 'waze', waze_enabled: false }), user: null, role: 'owner' },
    { organization: organizationRow(), user: { mode: 'override', version: '1' }, role: 'owner' },
    { organization: organizationRow(), user: null, role: 'unsupported' },
  ])('fails closed on invalid persisted authority %#', input => {
    expect(() => projectMapPreferences(input)).toThrow(expect.objectContaining({
      code: 'MAP_PREFERENCES_AUTHORITY_INVALID', status: 503,
    }));
  });
});
