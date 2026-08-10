'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INTEGRATIONS_PATH = path.join(ROOT, 'public', 'dashboard', 'integrations.html');
const SETTINGS_PATH = path.join(ROOT, 'public', 'dashboard', 'settings.html');

function settingsIntegrationsSection(html) {
  const start = html.indexOf('<!-- Integrations Section -->');
  const end = html.indexOf('</main>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('Mission 20 Phase 6C integration catalogue presentation contract', () => {
  const integrations = fs.readFileSync(INTEGRATIONS_PATH, 'utf8');
  const settings = fs.readFileSync(SETTINGS_PATH, 'utf8');

  test('uses only the additive server-projected catalogue and exposes no connection action', () => {
    expect(integrations).toContain("NorthStarAccountSession.fetch('/api/v1/integrations/catalogue'");
    expect(integrations).not.toMatch(/\/api\/v1\/integrations\/status|\/api\/integrations\/jobber|jobber=connected/);
    expect(integrations).not.toMatch(/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]|window\.location\.(?:assign|replace)|window\.open|fetch\([^)]*https?:/i);
    expect(integrations).not.toMatch(/Connect Jobber|Disconnect Jobber|Connect<|>Connect|>Configure</i);
    expect(integrations).toContain("authority: 'northstar_integration_catalogue_v1'");
    expect(integrations).toContain('No connection or provider-management action is available from this read-only catalogue.');
  });

  test('renders dynamic catalogue values only through safe DOM construction', () => {
    expect(integrations).toContain('document.createElement');
    expect(integrations).toContain('.textContent =');
    expect(integrations).not.toMatch(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|eval\s*\(|new Function/);
    for (const id of [
      'integrationCatalogueRoot',
      'integrationLoadingState',
      'integrationEmptyState',
      'integrationErrorState',
      'integrationCategoryList',
      'integrationStatusMessage',
      'refreshIntegrationsBtn',
      'retryIntegrationsBtn',
    ]) {
      expect(integrations).toContain(`id="${id}"`);
    }
    expect(integrations).toMatch(/aria-live="polite"/);
    expect(integrations).toMatch(/role="alert"/);
    expect(integrations).toMatch(/<ul[^>]+id="integrationCategoryList"/);
    expect(integrations).toMatch(/<template id="integrationLoadingCardTemplate"/);
  });

  test('moves focus to visible results only after a keyboard retry succeeds', () => {
    expect(integrations).toContain('id="integrationCatalogueHeading" tabindex="-1"');
    expect(integrations).toContain("var catalogueHeading = document.getElementById('integrationCatalogueHeading');");
    expect(integrations).toContain('error.contains(document.activeElement)');
    expect(integrations).toContain('if (restoreFocusOnSuccess) catalogueHeading.focus();');
    expect(integrations).toMatch(/retryButton\.addEventListener\('click', function\(event\)/);
    expect(integrations).toContain('restoreFocusOnSuccess: event.detail === 0');
  });

  test('keeps exact server status copy and stable machine-order validation without deriving connection state', () => {
    for (const [state, label] of [
      ['available', 'Available'],
      ['coming_soon', 'Coming soon'],
      ['requires_provider_approval', 'Requires provider approval'],
      ['connected', 'Connected'],
      ['syncing', 'Syncing'],
      ['needs_attention', 'Needs attention'],
      ['disconnected', 'Disconnected'],
    ]) expect(integrations).toContain(`${state}: '${label}'`);
    expect(integrations).toContain('provider.presentation.label');
    expect(integrations).toContain('provider.presentation.state');
    expect(integrations).not.toMatch(/connector\.status|(?:active|inactive|not_provisioned|ambiguous)\s*\?\s*['"](?:Connected|Disconnected|Needs attention)/);
    expect(integrations).not.toMatch(/statusLabels\[provider\.authority\./);
  });

  test('Settings preserves accepted IDs/toast while retiring decorative connection claims', () => {
    const section = settingsIntegrationsSection(settings);
    for (const id of [
      'integration-twilio', 'integration-openai', 'integration-elevenlabs',
      'integration-stripe', 'integration-google-cal', 'integration-email',
    ]) expect(section).toContain(`id="${id}"`);
    expect(section).toContain('id="settingsIntegrationsLink"');
    expect(section).toContain('href="/dashboard/integrations"');
    expect(section).toContain("showToast('Twilio integration coming soon')");
    expect(section).not.toMatch(/status-dot|Not connected|>Connected<|OpenAI is active|>Connect<|>Configure</);
    expect(section).toMatch(/Authoritative status is shown in Integrations/g);
  });
});
