'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Pre-Mission-23 P3 operational interaction and layout contract', () => {
  test('keeps Command Center terminology compact and customer-facing', () => {
    const html = read('public/demo-dashboard.html');
    const page = read('public/js/command-center-page.js');
    const css = read('public/css/pre-m23-p3.css');

    expect(page).toContain("byId('commandCenterAuthority').textContent = demo ? 'Demo Data' : 'Workspace Data'");
    expect([html, page].join('\n')).not.toMatch(/current tenant workspace is ready/i);
    expect(page).not.toContain('role-authorized tenant projections');
    expect(page).not.toContain("source: 'Command Center canonical overview'");
    expect(css).toMatch(/\.command-center-record-link\s*\{[^}]*text-decoration:\s*none/);
    expect(css).toMatch(/\.demo-status-panel\s*\{[^}]*padding:\s*var\(--northstar-card-padding\)/);
    expect(css).toMatch(/\.m22-state-summary\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  });

  test('keeps the demo scenario compact, persistent, guided, and returns to its control', () => {
    const runtime = read('public/js/demo-runtime.js');

    expect(runtime).toContain('northstarDemoScenarioPreferences');
    expect(runtime).toContain('Urgent missed-call recovery');
    expect(runtime).toContain('High-value estimate');
    expect(runtime).toContain('Schedule conflict and follow-up');
    expect(runtime).toContain("global.history.scrollRestoration = 'manual'");
    expect(runtime).toContain("toolbar.scrollIntoView({ block: 'start', behavior: 'auto' })");
    expect(runtime).toContain('restoreToolbarScrollMode');
    expect(runtime).not.toContain("toolbar.scrollIntoView({ block: 'start', behavior: 'smooth' })");
    expect(runtime).toContain("summary.focus({ preventScroll: true })");
    expect(runtime).toContain("details.open = false");
  });

  test('gives customer detail a real modal boundary and useful unavailable/action explanations', () => {
    const detail = read('public/js/customer-detail.js');
    const card = read('public/js/customer-card.js');
    const css = read('public/css/pre-m23-p3.css');

    expect(detail).toContain('function trapDrawerFocus(event)');
    expect(detail).toContain('function setBackgroundInert(inert)');
    expect(detail).toContain('id="cdMissingSummary"');
    expect(detail).toContain('id="cdPolarisActionReason"');
    expect(detail).toContain('Demo Calendar is read-only');
    expect(card).toContain('role="button" tabindex="0"');
    expect(card).toContain("var unavailableActionsId = 'northstarUnavailableLeadActions-' + index");
    expect(card).toContain("disabled aria-describedby=\"' + unavailableActionsId + '\"");
    expect(css).toMatch(/\.customer-drawer\s*\{[^}]*width:\s*min\(920px/);
  });

  test('restores the communications baseline and discloses advanced filters', () => {
    const html = read('public/dashboard/communications.html');
    const card = read('public/js/customer-card.js');

    expect(html).toContain('Advanced filters');
    expect(html).toContain("curSort = 'newest'");
    expect(html).toContain("closeFilterDropdown()");
    expect(html).toContain('communicationKinds');
    for (const label of ['Call', 'Message', 'Summary', 'Follow-up']) expect(card).toContain(label);
  });

  test('uses one readable Calendar contract with durable existing scheduling authority', () => {
    const html = read('public/dashboard/calendar.html');
    const engine = read('public/js/calendar-engine.js');
    const overview = read('src/scheduling/overviewRepository.js');
    const css = read('public/css/pre-m23-p3.css');

    expect(html).toContain('/css/pre-m23-p3.css');
    expect(engine).toContain('Create scheduled work');
    expect(engine).toContain('Demo Calendar is read-only');
    expect(engine).toContain('data-calendar-context-match');
    expect(overview).toContain('opportunityId: item.ids.opportunity');
    expect(css).toMatch(/\.cal-kpi-bar\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
    expect(css).toMatch(/\.cal-kpi-pill\s*\{[^}]*min-height:\s*88px/);
    expect(css).toMatch(/\.cal-title\s*\{[^}]*font-size:\s*var\(--northstar-page-title-size\)/);
  });

  test('auto-opens Quick Start once and preserves a permanent non-floating reopen action', () => {
    const guidance = read('public/js/workspace-guidance.js');
    const nav = read('public/js/nav-component.js');
    const css = read('public/css/workspace-guidance.css');

    expect(guidance).toContain('function openGuide(trigger)');
    expect(guidance).toContain("document.querySelectorAll('[data-quick-start-reopen]')");
    expect(nav).toContain('data-quick-start-reopen');
    expect(css).not.toContain('position: fixed; bottom:');
    expect(guidance).toContain("activePage === 'command-center' && isCommandCenterPath(mode) && !hasSeenGuide(mode, accountKey)");
  });

  test('keeps OBS-01 inactive pending the narrow privacy decision', () => {
    const proposal = read('docs/pre-m23-p3-observability-decision.md');
    const telemetry = read('public/js/product-telemetry.js');

    expect(proposal).toContain('Status: approval required; telemetry must remain inactive');
    expect(proposal).toContain('No customer, employee, message, transcript, job, address, phone, email, or free-text content');
    expect(proposal).toContain('Retention decision required');
    expect(telemetry).toContain('northstar_telemetry_consent_v1');
  });
});
