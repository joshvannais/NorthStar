'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MODULE_PATH = path.join(ROOT, 'public', 'js', 'navigation-launcher.js');

function preferenceDocument(defaultProvider = 'google_maps', overrides = {}) {
  return {
    providers: {
      google_maps: { enabled: true, visible: true },
      apple_maps: { enabled: true, visible: true },
      waze: { enabled: true, visible: true },
      ...(overrides.providers || {}),
    },
    defaultProvider,
  };
}

function responseWith(preferences = preferenceDocument()) {
  return {
    success: true,
    data: {
      authority: 'canonical_map_preferences_v1',
      contractVersion: 1,
      providers: [
        { key: 'google_maps', name: 'Google Maps' },
        { key: 'apple_maps', name: 'Apple Maps' },
        { key: 'waze', name: 'Waze' },
      ],
      organization: {
        version: 2,
        preferences: preferenceDocument(),
        source: 'user',
        updatedAt: '2026-08-11T12:00:00.000Z',
      },
      user: {
        version: 3,
        mode: 'override',
        hasStoredAuthority: true,
        preferences,
        updatedAt: '2026-08-11T12:05:00.000Z',
      },
      effective: {
        source: 'user_override',
        inheritsOrganization: false,
        organizationVersion: 2,
        userVersion: 3,
        preferences,
      },
      permissions: { canUpdateOrganization: false, canUpdateSelf: true },
    },
    requestId: 'phase6e-request-id',
  };
}

function loadContract() {
  jest.resetModules();
  return require(MODULE_PATH);
}

describe('Mission 20 Phase 6E navigation URL and authority contract', () => {
  test('publishes one fixed provider vocabulary and exact official address URL forms', () => {
    const contract = loadContract();
    expect(contract.AUTHORITY).toBe('canonical_map_preferences_v1');
    expect(contract.PROVIDERS).toEqual([
      { key: 'google_maps', name: 'Google Maps' },
      { key: 'apple_maps', name: 'Apple Maps' },
      { key: 'waze', name: 'Waze' },
    ]);

    const destination = contract.normalizeDestination({
      address: {
        line1: '100 Cedar Lane',
        city: 'Testville',
        state: 'NY',
        postalCode: '10001',
        country: 'US',
      },
    });
    expect(destination).toEqual({
      address: '100 Cedar Lane, Testville, NY 10001, US',
      verifiedCoordinates: null,
    });
    expect(Object.isFrozen(destination)).toBe(true);

    const encoded = '100%20Cedar%20Lane%2C%20Testville%2C%20NY%2010001%2C%20US';
    expect(contract.buildNavigationUrl('apple_maps', destination))
      .toBe(`https://maps.apple.com/?daddr=${encoded}&dirflg=d`);
    expect(contract.buildNavigationUrl('google_maps', destination))
      .toBe(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
    expect(contract.buildNavigationUrl('waze', destination))
      .toBe(`https://waze.com/ul?q=${encoded}&navigate=yes`);
  });

  test('uses only explicitly verified finite in-range coordinates while retaining the address authority', () => {
    const contract = loadContract();
    const destination = contract.normalizeDestination({
      address: '500 Main St, Hartford, CT 06103',
      verifiedCoordinates: { verified: true, latitude: 41.7658, longitude: -72.6734 },
    });
    expect(destination).toEqual({
      address: '500 Main St, Hartford, CT 06103',
      verifiedCoordinates: { latitude: 41.7658, longitude: -72.6734 },
    });
    expect(contract.buildNavigationUrl('apple_maps', destination))
      .toBe('https://maps.apple.com/?daddr=41.7658%2C-72.6734&dirflg=d');
    expect(contract.buildNavigationUrl('google_maps', destination))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=41.7658%2C-72.6734');
    expect(contract.buildNavigationUrl('waze', destination))
      .toBe('https://waze.com/ul?ll=41.7658%2C-72.6734&navigate=yes');

    for (const coordinates of [
      { verified: false, latitude: 41, longitude: -72 },
      { verified: true, latitude: 91, longitude: -72 },
      { verified: true, latitude: 41, longitude: -181 },
      { verified: true, latitude: NaN, longitude: -72 },
      { verified: true, latitude: 41, longitude: Infinity },
      { verified: true, latitude: '41', longitude: -72 },
    ]) {
      expect(() => contract.normalizeDestination({
        address: '500 Main St, Hartford, CT 06103', verifiedCoordinates: coordinates,
      })).toThrow(/destination/i);
    }
  });

  test('fails closed on missing, malformed, overlong, control-bearing, scheme-like, and structurally hostile destinations', () => {
    const contract = loadContract();
    const invalid = [
      {},
      { address: '' },
      { address: '   ' },
      { address: 'javascript:alert(1)' },
      { address: 'data:text/html,hello' },
      { address: 'file:///tmp/site' },
      { address: 'https://attacker.example/jobsite' },
      { address: '<img src=x onerror=alert(1)>' },
      { address: '10 Main St\nLocation: attacker.example' },
      { address: 'x'.repeat(513) },
      { address: ['10 Main St'] },
      { address: { line1: '10 Main St', city: 'Hartford', unexpected: 'poison' } },
      { address: { city: 'Hartford', state: 'CT' } },
      { address: Object.assign(Object.create({ inherited: true }), { line1: '10 Main St' }) },
      { address: '10 Main St', unexpected: true },
    ];
    for (const candidate of invalid) {
      expect(() => contract.normalizeDestination(candidate)).toThrow(/destination/i);
    }

    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'address', {
      enumerable: true,
      get() { getterCalls += 1; return '10 Main St'; },
    });
    expect(() => contract.normalizeDestination(accessor)).toThrow(/destination/i);
    expect(getterCalls).toBe(0);
  });

  test('strictly validates the complete accepted preference response and computes only usable launch choices', () => {
    const contract = loadContract();
    const preferences = preferenceDocument('apple_maps', {
      providers: {
        google_maps: { enabled: false, visible: true },
        apple_maps: { enabled: true, visible: false },
        waze: { enabled: true, visible: true },
      },
    });
    const parsed = contract.parsePreferenceResponse(responseWith(preferences));
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.providers.waze)).toBe(true);
    expect(contract.selectLaunchPolicy(parsed)).toEqual({
      defaultProvider: null,
      usableProviders: ['waze'],
      chooserProviders: ['waze'],
    });

    const direct = contract.parsePreferenceResponse(responseWith(preferenceDocument('google_maps')));
    expect(contract.selectLaunchPolicy(direct)).toEqual({
      defaultProvider: 'google_maps',
      usableProviders: ['google_maps', 'apple_maps', 'waze'],
      chooserProviders: ['apple_maps', 'waze'],
    });
  });

  test.each([
    ['wrong authority', body => { body.data.authority = 'browser_cache'; }],
    ['unknown envelope field', body => { body.extra = true; }],
    ['unknown data field', body => { body.data.targetUserId = 'someone-else'; }],
    ['provider reorder', body => { body.data.providers.reverse(); }],
    ['provider rename', body => { body.data.providers[0].name = 'Google'; }],
    ['unknown effective field', body => { body.data.effective.organizationId = 'poison'; }],
    ['disabled default', body => { body.data.effective.preferences.providers.google_maps.enabled = false; }],
    ['nonboolean visibility', body => { body.data.effective.preferences.providers.waze.visible = 1; }],
    ['unbounded request id', body => { body.requestId = 'x'.repeat(257); }],
  ])('rejects preference poison: %s', (_label, mutate) => {
    const contract = loadContract();
    const body = responseWith();
    mutate(body);
    expect(() => contract.parsePreferenceResponse(body)).toThrow(/preference/i);
  });

  test('never accepts an unintended scheme, host, path, query, origin, or overlong URL', () => {
    const contract = loadContract();
    const destination = contract.normalizeDestination({ address: '100 Cedar Lane, Testville, NY' });
    const valid = contract.buildNavigationUrl('google_maps', destination);
    expect(contract.validateNavigationUrl('google_maps', valid)).toBe(valid);
    for (const candidate of [
      'javascript:alert(1)',
      'http://www.google.com/maps/dir/?api=1&destination=x',
      'https://evil.example/maps/dir/?api=1&destination=x',
      'https://www.google.com/maps/search/?api=1&destination=x',
      'https://www.google.com/maps/dir/?api=1&origin=here&destination=x',
      'https://www.google.com/maps/dir/?api=1&destination=x&tracking=1',
      'https://www.google.com/maps/dir/?api=2&destination=x',
      `https://www.google.com/maps/dir/?api=1&destination=${'x'.repeat(2050)}`,
    ]) {
      expect(() => contract.validateNavigationUrl('google_maps', candidate)).toThrow(/navigation URL/i);
    }
    expect(() => contract.buildNavigationUrl('unknown_provider', destination)).toThrow(/provider/i);
  });
});

describe('Mission 20 Phase 6E mounted source ownership', () => {
  test('mounts one shared launcher on both genuine canonical location presentations and nowhere decorative', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');
    const lead = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', 'lead.html'), 'utf8');
    const customer = fs.readFileSync(path.join(ROOT, 'public', 'js', 'customer-detail.js'), 'utf8');
    const calendar = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', 'calendar.html'), 'utf8');
    const profile = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', 'business-profile.html'), 'utf8');
    const demo = fs.readFileSync(path.join(ROOT, 'public', 'demo-dashboard.html'), 'utf8');

    expect(lead).toContain('id="leadNavigationLauncher"');
    expect(lead).toContain('NorthStarNavigationLauncher.mount');
    expect(customer).toContain('id="cdNavigationLauncher"');
    expect(customer).toContain('NorthStarNavigationLauncher.mount');
    for (const host of ['leads.html', 'communications.html', 'command-center.html']) {
      const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', host), 'utf8');
      expect(html).toContain('<script src="/js/navigation-launcher.js"></script>');
      expect(html.indexOf('/js/navigation-launcher.js')).toBeLessThan(html.indexOf('/js/customer-detail.js'));
    }
    expect(lead).toContain('<script src="/js/navigation-launcher.js"></script>');
    expect(calendar).not.toContain('navigation-launcher.js');
    expect(profile).not.toContain('navigation-launcher.js');
    expect(demo).not.toContain('navigation-launcher.js');
    expect(source).toContain("'/api/account/map-preferences'");
  });

  test('keeps all external destinations source-owned, click-gated, opener-safe, and absent from host markup', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');
    const hosts = [
      path.join(ROOT, 'public', 'dashboard', 'lead.html'),
      path.join(ROOT, 'public', 'js', 'customer-detail.js'),
      path.join(ROOT, 'public', 'dashboard', 'leads.html'),
      path.join(ROOT, 'public', 'dashboard', 'communications.html'),
      path.join(ROOT, 'public', 'dashboard', 'command-center.html'),
    ].map(file => fs.readFileSync(file, 'utf8')).join('\n');

    expect(source).toContain('event.isTrusted');
    expect(source).toContain("global.open(url, '_blank', 'noopener,noreferrer')");
    expect(source).toContain('opened.opener = null');
    expect(source).toContain('textContent');
    expect(source).not.toMatch(/createElement\(['"]a['"]\)|\.href\s*=|preload|prefetch/i);
    expect(hosts).not.toMatch(/https?:\/\/(?:maps\.apple\.com|www\.google\.com\/maps|(?:www\.)?waze\.com)/i);
    expect(hosts).not.toMatch(/window\.open\s*\(/);
  });
});
