'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INTEGRATIONS_PATH = path.join(ROOT, 'public', 'dashboard', 'integrations.html');
const MAP_CATALOGUE_BASIS =
  'Connection catalogue only; provider preferences are managed below; ' +
  'destination-launch/navigation actions are deferred';

describe('Mission 20 Phase 6D map preference presentation contract', () => {
  const html = fs.readFileSync(INTEGRATIONS_PATH, 'utf8');

  test('adds a separate canonical preference panel without weakening the read-only catalogue', () => {
    expect(html).toContain('id="mapPreferencesRoot"');
    expect(html).toContain('id="mapPreferencesHeading"');
    expect(html).toContain('Map launch preferences');
    expect(html).toContain('No map is opened from this page. Navigation launch behavior is not included.');
    expect(html).toContain('No connection or provider-management action is available from this read-only catalogue.');
    expect(html).toContain(
      `catalogue_only_navigation_deferred: '${MAP_CATALOGUE_BASIS}'`
    );
    expect(html).toContain('Choose which supported map providers should be available');
    expect(html).toContain("NorthStarAccountSession.json('/api/account/map-preferences', { method: 'GET' })");
    expect(html).toContain("NorthStarAccountSession.json('/api/account/map-preferences/organization'");
    expect(html).toContain("NorthStarAccountSession.json('/api/account/map-preferences/me'");
    expect(html).not.toMatch(/https?:\/\/(?:maps|www\.google|maps\.apple|waze)|window\.open|window\.location\.(?:assign|replace)|target=["']_blank/i);
    expect(html).not.toMatch(/Catalogue metadata only; (?:navigation )?preference(?:s)? and launcher logic (?:are )?(?:absent|not included)/i);
  });

  test('uses exact provider names and neutral navigation glyphs without official marks or partnership language', () => {
    for (const name of ['Google Maps', 'Apple Maps', 'Waze']) expect(html).toContain(name);
    expect(html).toContain('class="map-provider-glyph" aria-hidden="true">↗</span>');
    expect(html).not.toMatch(/google-logo|apple-logo|waze-logo|official logo|partnered with|powered by/i);
    expect(html).not.toMatch(/<img[^>]+(?:google|apple|waze)/i);
  });

  test('contains truthful role, inheritance, loading, error, retry, stale, save, reload, and live-region states', () => {
    for (const id of [
      'mapPreferencesLoading', 'mapPreferencesError', 'mapPreferencesRetry',
      'mapPreferencesOrganization', 'mapPreferencesUser', 'mapPreferencesStatus',
      'saveOrganizationMapPreferences', 'saveUserMapPreferences', 'inheritMapPreferences',
    ]) expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain('canUpdateOrganization');
    expect(html).toContain('canUpdateSelf');
    expect(html).toContain('inheritsOrganization');
    expect(html).toMatch(/version conflict|changed; reload/i);
    expect(html).toContain('window.NorthStarMapPreferences = Object.freeze');
  });

  test('renders persisted values through safe fixed controls and never through HTML injection', () => {
    expect(html).toContain('mapPreferenceContract');
    expect(html).toContain('google_maps');
    expect(html).toContain('apple_maps');
    expect(html).toContain('waze');
    expect(html).toContain('.textContent =');
    expect(html).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|eval\s*\(|new Function/);
  });
});
