'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Mission 20 Part 2J additive Phase 2 ratification contract', () => {
  let businessProfile;
  let settings;
  let team;
  let integrations;
  let accountRoute;

  beforeAll(() => {
    businessProfile = source('public/dashboard/business-profile.html');
    settings = source('public/dashboard/settings.html');
    team = source('public/dashboard/team.html');
    integrations = source('public/dashboard/integrations.html');
    accountRoute = source('src/routes/account.js');
  });

  test.each([
    ['business-profile.html', () => businessProfile],
    ['settings.html', () => settings],
    ['team.html', () => team],
    ['integrations.html', () => integrations],
  ])('%s provides a keyboard skip target and an announced toast', (_name, value) => {
    const html = value();
    expect(html).toMatch(/class=["'][^"']*skip-link[^"']*["'][^>]*href=["']#mainContent["']/);
    expect(html).toMatch(/<main[^>]*id=["']mainContent["'][^>]*tabindex=["']-1["']/);
    expect(html).toMatch(/id=["']toast["'][^>]*role=["']status["'][^>]*aria-live=["']polite["'][^>]*aria-atomic=["']true["']/);
  });

  test('Business Profile exposes a real heading, keyboard tabs, and fail-closed load state', () => {
    expect(businessProfile).toMatch(/<h1[^>]*class=["']bp-title["'][^>]*>[^<]*Business Profile<\/h1>/);
    expect(businessProfile).toMatch(/id=["']businessProfileRoot["'][^>]*data-state=["']loading["'][^>]*aria-busy=["']true["']/);
    expect(businessProfile).toMatch(/id=["']businessProfileStatus["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/);
    expect(businessProfile).toMatch(/id=["']bpNav["'][^>]*role=["']tablist["'][^>]*aria-label=/);
    expect(businessProfile).toMatch(/function initializeProfileAccessibility\(\)[\s\S]*setAttribute\('role', 'tab'\)[\s\S]*setAttribute\('role', 'tabpanel'\)/);
    expect(businessProfile).toMatch(/function handleProfileTabKeydown\(event\)[\s\S]*ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
    expect(businessProfile).toMatch(/function setProfileInteractionState\(state, message\)[\s\S]*aria-busy[\s\S]*profileCanEdit[\s\S]*disabled/);
    expect(businessProfile).toMatch(/function loadProfile\(\)[\s\S]*setProfileInteractionState\('loading'/);
    expect(businessProfile).toMatch(/renderProfile\(profileData\);[\s\S]*associateProfileLabels\(document\);[\s\S]*setProfileInteractionState\('ready'/);
    expect(businessProfile).toMatch(/setProfileInteractionState\('error'/);
  });

  test('Business Profile associates every static and dynamic editor with an accessible name', () => {
    expect(businessProfile).toMatch(/function associateProfileLabels\(root\)[\s\S]*querySelectorAll\('\.bp-field > label:not\(\.bp-toggle\)'\)[\s\S]*label\.htmlFor = control\.id/);
    expect(businessProfile).toMatch(/function appendLabeledInput\([\s\S]*input\.id = stableRowId\('profile-field'\);[\s\S]*labelElement\.htmlFor = input\.id/);
    expect(businessProfile).toMatch(/function appendServiceField\([\s\S]*input\.id = stableRowId\('service-field'\);[\s\S]*label\.htmlFor = input\.id/);
    expect(businessProfile).toMatch(/function appendTime\(className, value, fieldLabel\)[\s\S]*aria-label[\s\S]*fieldLabel \+ ' for ' \+ dayLabel/);
    expect(businessProfile).toMatch(/lunch\.setAttribute\('aria-label', 'Lunch hours for ' \+ dayLabel\)/);
  });

  test('Business Profile toggles stay native, focusable, and visibly focused', () => {
    expect(businessProfile).not.toMatch(/\.bp-field \.bp-toggle input\s*\{\s*display:\s*none/);
    expect(businessProfile).toMatch(/\.bp-field \.bp-toggle input\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/);
    expect(businessProfile).toMatch(/\.bp-field \.bp-toggle input:focus-visible \+ \.slider/);
    expect(businessProfile).toMatch(/\.bp-save-btn:disabled\s*\{[^}]*opacity:\s*1[^}]*color:\s*var\(--neutral-700\)/);
  });

  test('Settings has unique IDs and preserves one bidirectionally synchronized companyInfo authority', () => {
    expect(settings.match(/id=["']companyInfo["']/g)).toHaveLength(1);
    expect(settings.match(/id=["']companyInfoAiContext["']/g)).toHaveLength(1);
    expect(settings).toMatch(/function synchronizeCompanyInfoControls\(source\)[\s\S]*companyInfoAiContext[\s\S]*companyInfo/);
    expect(settings).toMatch(/companyInfoAiContext[^\n]*addEventListener\('input'/);
    expect(settings).toMatch(/renderSettingsState\(\)[\s\S]*synchronizeCompanyInfoControls\(document\.getElementById\('companyInfo'\)\)/);
    expect(settings).toMatch(/const fields = \[[^\]]*'companyInfo'/);
    expect(settings).not.toMatch(/<\/details>\s*<\/div>\s*<\/div>\s*<!-- Integrations Section -->/);
  });

  test('Settings retains accepted preferences and accessible controls without duplicate integration or import surfaces', () => {
    for (const key of ['companyName', 'companyPhone', 'services', 'companyInfo', 'greeting', 'smartRouting', 'contacts']) {
      expect(accountRoute).toMatch(new RegExp(`['"]${key}['"]`));
    }
    for (const id of ['integration-twilio', 'integration-openai', 'integration-elevenlabs', 'integration-stripe', 'integration-google-cal', 'integration-email']) {
      expect(settings).not.toContain(`id="${id}"`);
    }
    expect(settings).toMatch(/id=["']smartRoutingLabel["'][^>]*>AI answers unknown callers only/);
    expect(settings).toMatch(/id=["']smartRouting["'][^>]*aria-labelledby=["']smartRoutingLabel["']/);
    expect(settings).toMatch(/id=["']contactName["'][^>]*aria-label=["']Known contact name["']/);
    expect(settings).toMatch(/id=["']contactPhone["'][^>]*aria-label=["']Known contact phone number["']/);
    expect(settings).not.toMatch(/id=["']importStatus["']/);
    expect(settings).not.toMatch(/Import contacts from your phone/);
    expect(settings).toMatch(/remove\.setAttribute\('aria-label', 'Remove known contact ' \+ contact\.name\)/);
  });

  test('Team assigns stable accessible names and renders explicit loading and error states', () => {
    expect(team).toMatch(/var generatedControlId = 0;/);
    expect(team).toMatch(/function field\(labelText, control\)[\s\S]*if \(!control\.id\)[\s\S]*generatedControlId[\s\S]*label\.htmlFor = control\.id/);
    expect(team).toMatch(/id=["']skillsList["'][^>]*>[\s\S]*Loading skills/);
    expect(team).toMatch(/id=["']crewsList["'][^>]*>[\s\S]*Loading crews/);
    expect(team).toMatch(/id=["']policiesList["'][^>]*>[\s\S]*Loading workforce policies/);
    expect(team).toMatch(/function renderWorkforceError\(message\)[\s\S]*membersList[\s\S]*skillsList[\s\S]*crewsList[\s\S]*policiesList/);
    expect(team).toMatch(/function renderWorkforceError\(message\)[\s\S]*invitationsPanel[\s\S]*invitationsList/);
    expect(team).toMatch(/empty\(document\.getElementById\(id\), unavailable, 'wf-error'\)/);
    expect(team).toMatch(/className === 'wf-error'[\s\S]*setAttribute\('role', 'alert'\)/);
    expect(team).toMatch(/function setWorkforceLoading\(initial\)[\s\S]*aria-busy', 'true'[\s\S]*if \(!initial\) return/);
    expect(team).toMatch(/async function loadData\(initial\)\s*{\s*setWorkforceLoading\(initial\);[\s\S]*renderWorkforceError/);
  });

  test('Integrations retains unavailable meaning without opacity-driven contrast loss', () => {
    expect(integrations).toMatch(/\.integration-status\[data-status="coming_soon"\],[\s\S]*?background:\s*var\(--neutral-100\)[^}]*color:\s*var\(--neutral-700\)/);
    expect(integrations).toMatch(/\.integration-card\s*\{[^}]*border:\s*1px solid var\(--neutral-200\)/);
    expect(integrations).not.toMatch(/\.integration-card\s*\{[^}]*opacity:/);
    expect(integrations).not.toContain('data-connector-availability="unavailable"');
    expect(integrations).not.toContain('jobber-action');
    expect(integrations).toContain('id="integrationCatalogueRoot" data-state="loading" aria-busy="true"');
  });
});
