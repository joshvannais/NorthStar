'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Pre-Mission-23 P4 administrative information architecture', () => {
  const team = read('public/dashboard/team.html');
  const profile = read('public/dashboard/business-profile.html');
  const settings = read('public/dashboard/settings.html');
  const integrations = read('public/dashboard/integrations.html');
  const knowledge = read('public/js/knowledge-management.js');
  const accountRoute = read('src/routes/account.js');
  const accountRepository = read('src/accounts/repository.js');
  const server = read('src/server.js');
  const navigation = read('public/js/nav-component.js');

  test.each([
    ['Team', team], ['Business Profile', profile], ['Settings', settings], ['Integrations', integrations],
  ])('%s inline scripts remain syntactically valid', (_label, html) => {
    const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1]).filter(source => source.trim());
    inline.forEach(source => expect(() => new vm.Script(source)).not.toThrow());
  });

  test('ADM-01..02 Team is full-width and summary-first without demo editors', () => {
    expect(team).toContain('class="wf-overview"');
    expect(team).toContain('id="workforceSummary"');
    expect(team).toMatch(/\.wf-shell\{[^}]*width:100%/);
    expect(team).toContain("if (isDemoMode()) return 'Demo preview · Read only';");
  });

  test('ADM-03..06 Business Profile has a text-only title, concise state, and full-width rail', () => {
    expect(profile).toContain('<h1 class="bp-title">Business Profile</h1>');
    expect(profile).not.toContain('⚙️ Business Profile');
    expect(profile).not.toContain('This Business Profile is protected by your account role.');
    expect(profile).toMatch(/\.bp-container\s*\{[^}]*width:\s*100%[^}]*max-width:\s*var\(--northstar-rail-max/);
    expect(profile).toContain('id="businessProfileRole"');
  });

  test('ADM-07..09 canonical redirects remain mode-safe and Business Profile has seven groups', () => {
    expect(server).toContain("res.redirect(301, '/dashboard/settings#ai-settings')");
    expect(server).toContain("res.redirect(301, '/demo/settings#ai-settings')");
    expect(server).toContain("res.redirect(301, '/dashboard/business-profile?section=company#business-number')");
    expect(server).toContain("res.redirect(301, '/demo/business-profile?section=company#business-number')");
    expect((profile.match(/class="bp-nav-group"/g) || [])).toHaveLength(7);
    expect(navigation.match(/id:\s*'settings'/g)).toHaveLength(1);
  });

  test('ADM-10 and ADM-20 Settings has a compact notification grid and explicit save authority states', () => {
    expect(settings).toContain('class="notification-preference-grid"');
    expect(settings).toContain('id="settingsRoleBadge"');
    expect(settings).toContain('id="settingsDirtyStatus"');
    expect(settings).toContain('id="reloadSettingsBtn"');
    expect(settings).toContain('expectedVersion: settingsVersion');
    expect(accountRoute).toContain('preferences_version_conflict');
    expect(accountRepository).toContain('preference_version');
  });

  test('ADM-11..16 knowledge defaults to plain language and gates exact evidence explicitly', () => {
    expect(settings).not.toContain('Exact latest versions');
    expect(profile).not.toContain('Exact latest versions');
    expect(knowledge).toContain("'Advanced evidence'");
    expect(knowledge).toContain("'Update this information'");
    expect(knowledge).toContain("return 'Business identity';");
    expect(knowledge).not.toContain("node('span', 'km-item-key', 'Version '");
    expect(knowledge).toContain('Existing history stays unchanged.');
  });

  test('ADM-17..19 every integration category and both map scopes are disclosures', () => {
    expect(integrations).toContain("createElement('details', 'integration-category-details')");
    expect(integrations).not.toContain('if (plannedOnly) {');
    expect(integrations).toContain('integrationDisclosureKey');
    expect(integrations).toContain('<details class="map-preference-scope" id="mapPreferencesOrganization"');
    expect(integrations).toContain('<details class="map-preference-scope" id="mapPreferencesUser"');
    expect(integrations).toContain("categoryItem.dataset.availability = plannedOnly ? 'planned' : 'mixed';");
  });
});
