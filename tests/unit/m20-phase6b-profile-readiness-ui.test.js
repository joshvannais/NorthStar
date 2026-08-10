'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'dashboard', 'business-profile.html'), 'utf8');
const STYLES = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');
const ROUTE = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'businessProfile.js'), 'utf8');
const AUTHORITY = fs.readFileSync(path.join(ROOT, 'src', 'services', 'organizationAuthority.js'), 'utf8');

function declarationsFor(source, selector) {
  const selectorStart = source.indexOf(selector);
  if (selectorStart < 0) throw new Error('Missing CSS selector: ' + selector);
  const open = source.indexOf('{', selectorStart);
  const close = source.indexOf('}', open);
  if (open < 0 || close < 0) throw new Error('Incomplete CSS rule: ' + selector);
  return source.slice(open + 1, close);
}

function declarationValue(declarations, property) {
  const match = declarations.match(new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)', 'i'));
  if (!match) throw new Error('Missing CSS declaration: ' + property);
  return match[1].trim();
}

function themeVariables(theme) {
  const result = {};
  for (const selector of theme === 'dark' ? [':root {', '[data-theme="dark"] {'] : [':root {']) {
    const block = declarationsFor(STYLES, selector);
    for (const match of block.matchAll(/--([\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function resolveColor(value, theme) {
  const variable = value.match(/^var\(--([\w-]+)\)$/);
  if (!variable) return value;
  const resolved = themeVariables(theme)[variable[1]];
  if (!resolved) throw new Error('Missing theme color token: ' + variable[1]);
  return resolved;
}

function parseColor(value) {
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) };
  throw new Error('Unsupported CSS color: ' + value);
}

function composite(foreground, background) {
  return {
    r: (foreground.r * foreground.a) + (background.r * (1 - foreground.a)),
    g: (foreground.g * foreground.a) + (background.g * (1 - foreground.a)),
    b: (foreground.b * foreground.a) + (background.b * (1 - foreground.a)),
    a: 1,
  };
}

function luminance(color) {
  const channels = [color.r, color.g, color.b].map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(first, second) {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function stateColor(theme, state) {
  const stateSelectors = {
    missing: '.bp-readiness-state[data-state="missing"],',
    authority_unavailable: '.bp-readiness-state[data-state="authority_unavailable"] {',
    recommended: '.bp-readiness-state[data-state="recommended"],',
    needs_review: '.bp-readiness-state[data-state="needs_review"] {',
    reviewed: '.bp-readiness-state[data-state="reviewed"] {',
    not_applicable: '.bp-readiness-state {',
  };
  const selector = theme === 'dark' && state !== 'not_applicable'
    ? '[data-theme="dark"] ' + stateSelectors[state]
    : stateSelectors[state];
  const declarations = declarationsFor(HTML, selector);
  return parseColor(resolveColor(declarationValue(declarations, 'color'), theme));
}

function pendingColor(theme) {
  const selector = theme === 'dark'
    ? '\n    [data-theme="dark"] .bp-readiness-pending {'
    : '\n    .bp-readiness-pending {';
  return parseColor(resolveColor(declarationValue(declarationsFor(HTML, selector), 'color'), theme));
}

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

  test('keeps every readiness state, pending action, and error at WCAG 2.2 AA contrast in both themes', () => {
    const states = ['missing', 'authority_unavailable', 'recommended', 'needs_review', 'reviewed', 'not_applicable'];
    const expectedLightColors = {
      missing: '#991b1b',
      authority_unavailable: '#991b1b',
      recommended: '#8a5a00',
      needs_review: '#8a5a00',
      reviewed: '#047857',
      not_applicable: '#334155',
    };
    const expectedDarkColors = {
      missing: '#fca5a5',
      authority_unavailable: '#fca5a5',
      recommended: '#fbbf24',
      needs_review: '#fbbf24',
      reviewed: '#6ee7b7',
      not_applicable: '#cdd1da',
    };

    expect(HTML).toContain('.bp-readiness-state[data-state="missing"], .bp-readiness-state[data-state="authority_unavailable"] { color: #991b1b; }');
    expect(HTML).toContain('.bp-readiness-state[data-state="recommended"], .bp-readiness-state[data-state="needs_review"] { color: #8a5a00; }');
    expect(HTML).toContain('.bp-readiness-state[data-state="reviewed"] { color: #047857; }');
    expect(HTML).toContain('\n    .bp-readiness-pending { font-weight: 600; color: var(--brand-700); }\n');
    expect(declarationValue(declarationsFor(HTML, '.bp-validation-error {'), 'color')).toBe('#991b1b');

    for (const theme of ['light', 'dark']) {
      const background = parseColor(themeVariables(theme)['neutral-50']);
      const expectedColors = theme === 'light' ? expectedLightColors : expectedDarkColors;
      for (const state of states) {
        const foreground = stateColor(theme, state);
        expect('#' + [foreground.r, foreground.g, foreground.b]
          .map(channel => channel.toString(16).padStart(2, '0')).join('')).toBe(expectedColors[state]);
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }

      const pendingForeground = pendingColor(theme);
      expect('#' + [pendingForeground.r, pendingForeground.g, pendingForeground.b]
        .map(channel => channel.toString(16).padStart(2, '0')).join('')).toBe(
          theme === 'light' ? '#6d5005' : '#fbbf24');
      expect(contrast(pendingForeground, background)).toBeGreaterThanOrEqual(4.5);

      const errorDeclarations = declarationsFor(HTML, '.bp-validation-error {');
      const errorColorValue = theme === 'dark'
        ? declarationValue(declarationsFor(HTML, '[data-theme="dark"] #profileReadinessError,'), 'color')
        : declarationValue(errorDeclarations, 'color');
      const errorForeground = parseColor(resolveColor(errorColorValue, theme));
      const errorBackground = composite(parseColor(declarationValue(errorDeclarations, 'background')), background);
      expect(contrast(errorForeground, errorBackground)).toBeGreaterThanOrEqual(4.5);
    }
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
