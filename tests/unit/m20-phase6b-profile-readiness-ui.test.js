'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', 'business-profile.html'), 'utf8');
const ROUTE = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'businessProfile.js'), 'utf8');
const AUTHORITY = fs.readFileSync(path.join(ROOT, 'src', 'services', 'organizationAuthority.js'), 'utf8');

describe('Mission 20 Phase 6B Profile Readiness presentation contract', () => {
  test('renders the exact Polaris guidance directly beneath the Business Profile heading', () => {
    const guidance = 'Help Polaris understand your business. Polaris works best with a complete, accurate, and up-to-date Business Profile. The more relevant detail you provide, the better Polaris can tailor its recommendations to your business.';
    expect(HTML).toContain('<h1 class="bp-title">⚙️ Business Profile</h1>\n            <p id="polarisProfileGuidance" class="bp-guidance">' + guidance + '</p>');
    expect(HTML.match(new RegExp(guidance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
  });

  test('uses a dedicated accessible readiness region with loading, empty, error, reload, save, and live states', () => {
    expect(HTML).toMatch(/<section[^>]*id="profileReadiness"[^>]*aria-labelledby="profileReadinessHeading"[^>]*aria-describedby="profileReadinessDescription"[^>]*aria-busy="true"/);
    expect(HTML).toContain('<h2 id="profileReadinessHeading" class="bp-readiness-title" tabindex="-1">Profile Readiness</h2>');
    expect(HTML).toMatch(/id="profileReadinessStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    expect(HTML).toMatch(/id="profileReadinessError"[^>]*role="alert"[^>]*tabindex="-1"/);
    expect(HTML).toContain('id="profileReadinessEmpty"');
    expect(HTML).toMatch(/id="profileReadinessList"[^>]*role="list"[^>]*aria-label="Profile Readiness items"/);
    expect(HTML).toMatch(/id="profileReadinessLive"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(HTML).toContain('id="reloadProfileReadinessBtn"');
    expect(HTML).toContain('id="saveProfileReadinessBtn"');
  });

  test('keeps readiness separate from integration state and never renders a decorative completion measure', () => {
    const region = HTML.slice(HTML.indexOf('<section class="bp-card bp-readiness"'), HTML.indexOf('<!-- Navigation Tabs -->'));
    expect(region).toContain('Profile Readiness is separate from integration status');
    expect(region).not.toMatch(/progress|meter|score|percentage|points|connected|disconnected|syncing/i);
    expect(HTML.slice(HTML.indexOf('function loadProfileReadiness'))).not.toContain('/api/v1/integrations/status');
  });

  test('renders server text through DOM text nodes and submits only the exact action envelope', () => {
    const start = HTML.indexOf('function renderProfileReadiness');
    const end = HTML.indexOf('function updateProfileReadinessActionState', start);
    const render = HTML.slice(start, end);
    expect(render).toContain('heading.textContent = item.label');
    expect(render).toContain('help.textContent = item.help');
    expect(render).toContain('reason.textContent = reasonText');
    expect(render).toContain('list.replaceChildren(fragment)');
    expect(render).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(HTML).toContain("profileRequest('/api/v1/business-profile/profileReadiness'");
    expect(HTML).toContain('body: JSON.stringify({ expectedVersion: expectedVersion, changes: changes })');
    expect(HTML).not.toMatch(/body:\s*JSON\.stringify\(\{\s*expectedVersion:[^}]*lastReviewedAt/);
    expect(HTML).not.toMatch(/body:\s*JSON\.stringify\(\{\s*expectedVersion:[^}]*reviewedValueHash/);
  });

  test('keeps owner and admin controls separate from member and viewer read-only rendering', () => {
    expect(HTML).toMatch(/profileCanEdit = role === 'owner' \|\| role === 'admin'/);
    expect(HTML).toMatch(/button\.disabled = !interactive \|\| !profileCanEdit/);
    expect(HTML).toContain("profileCanEdit ? 'Save readiness' : 'Read-only readiness'");
    expect(HTML).toContain('Business Profile changed. Your pending readiness choices remain visible');
    expect(HTML).toContain("reload.focus()");
  });

  test('mounts dedicated read and write routes before the generic section handlers', () => {
    const put = ROUTE.indexOf("router.put('/profileReadiness'");
    const genericPut = ROUTE.indexOf("router.put('/:section'");
    const get = ROUTE.indexOf("router.get('/profileReadiness'");
    const genericGet = ROUTE.indexOf("router.get('/:section'");
    expect(put).toBeGreaterThan(0);
    expect(get).toBeGreaterThan(0);
    expect(put).toBeLessThan(genericPut);
    expect(get).toBeLessThan(genericGet);
    expect(ROUTE.slice(put, genericPut)).toContain("requireAccountMutation, requirePermission('settings', 'update')");
    expect(ROUTE.slice(get, genericGet)).toContain('requireTenantAccess');
    expect(ROUTE).toContain('delete editable.profile.profileReadiness');
  });

  test('contains readiness in every other authority write and permits only the dedicated transaction to change it', () => {
    expect(AUTHORITY).toContain("preserveTopLevelField(mutationCandidate, activeRawProfile, 'profileReadiness')");
    expect(AUTHORITY).toContain("'PROFILE_READINESS_ROUTE_REQUIRED'");
    expect(AUTHORITY).toContain('const writesProfileReadiness = Array.isArray(input.profileReadinessChanges)');
    expect(AUTHORITY).toContain('rawProfile = applyProfileReadinessChanges(');
    expect(AUTHORITY).toMatch(/SELECT id FROM organizations WHERE id = \$1 FOR UPDATE[\s\S]*expectedVersion[\s\S]*applyProfileReadinessChanges/);
  });
});
