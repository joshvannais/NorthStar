'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const source = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function displayProjection() {
  const sandbox = { window: {} };
  vm.runInNewContext(source('public/js/display-projection.js'), sandbox, {
    filename: 'public/js/display-projection.js',
  });
  return sandbox.window.NorthStarDisplayProjection;
}

describe('Post-Mission 22 employee and Command Center visual corrections', () => {
  test('keeps the Today header at the true top and removes duplicate count and accent painters', () => {
    const html = source('public/dashboard/today.html');
    const css = source('public/css/today.css');

    expect(html).not.toContain('id="todayWorkCount"');
    expect(html).toContain('Personal Work Only');
    expect(html).toContain('Read-only View');
    expect(css).toMatch(/\.today-header\s*\{\s*position:\s*sticky;\s*top:\s*0;\s*z-index:\s*300;/);
    expect(css).toMatch(/\.today-page\s*>\s*\.mobile-header\s*\{[\s\S]*position:\s*fixed\s*!important;[\s\S]*top:\s*0\s*!important;/);
    expect(css).toMatch(/\.today-page\s+\.app-layout\s*\{\s*padding-top:\s*calc\(73px \+ env\(safe-area-inset-top\)\)\s*!important;/);
    expect(css).toMatch(/\.today-card-accent\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.today-header \.demo-dashboard-brand\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.today-header #todayAuthority[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.today-page \.app-layout > \.sidebar[\s\S]*position:\s*static;[\s\S]*min-height:\s*100vh;/);
    expect(css).toMatch(/@media \(min-width:\s*769px\)[\s\S]*\.today-page \.today-main\s*\{\s*margin-top:\s*16px;/);
    expect(css).toMatch(/\.today-disclosure\[open\][\s\S]*border-top:\s*0/);
    expect(css).toMatch(/summary:focus-visible\s*\{[\s\S]*outline:\s*0;[\s\S]*box-shadow:\s*inset/);
  });

  test('keeps internal knowledge keys out of presentation and uses the approved type stack', () => {
    const page = source('public/js/knowledge-management.js');
    const css = source('public/css/knowledge-management.css');

    expect(page).not.toContain("node('span', 'km-item-key', item.canonicalKey)");
    expect(page).not.toContain("node('p', 'km-item-key', detail.entry.canonicalKey)");
    expect(page).toContain('detailDisclosed: false');
    expect(page).toContain('if (!state.detailDisclosed)');
    expect(page).toContain('Choose this knowledge item to inspect its exact version, provenance, lifecycle, and synchronization details.');
    expect(css).toMatch(/\.km-item-key, \.km-mono\s*\{\s*font-family:\s*var\(--font-body, inherit\);/);
    expect(css).not.toMatch(/\.km-item-key, \.km-mono\s*\{[^}]*monospace/);
  });

  test('ratifies current Scheduling Authority instead of the retired direct Calendar event control', () => {
    const browser = source('tests/browser/command-center-parity-prelude.js');

    expect(browser).toContain('async function exerciseCurrentSchedulingAuthority(page, viewport)');
    expect(browser).toContain("getByRole('button', { name: 'Create non-capability preview' })");
    expect(browser).toContain("getByRole('button', { name: 'Approve current preview' })");
    expect(browser).toContain("getByRole('button', { name: 'Cancel scheduling action' })");
    expect(browser).toContain("page.locator('.cal-new-event-btn').count()");
    expect(browser).not.toContain("page.locator('.cal-new-event-btn').click()");
    expect(browser).toContain("mode === 'paid' ? PAID_NAV_ROUTES.length : ROUTES.length");
  });

  test('uses a single NorthStar lockup in the desktop Command Center shell', () => {
    const shared = source('public/css/site-professionalism.css');

    expect(shared).toMatch(/@media \(min-width:\s*769px\)[\s\S]*\.command-center-blueprint-header \.demo-dashboard-brand\s*\{\s*display:\s*none\s*!important;/);
    expect(shared).toMatch(/\.command-center-blueprint-header \.demo-dashboard-header-actions\s*\{[\s\S]*justify-content:\s*flex-end;/);
  });

  test('capitalizes projected Today labels and keeps one appointment count authority', () => {
    const page = source('public/js/today-page.js');

    expect(page).toContain("replace(/[_-]+/g, ' ')");
    expect(page).toContain("letter.toUpperCase()");
    expect(page).toContain("' · Personal Work Only'");
    expect(page).not.toContain("byId('todayWorkCount')");
    expect(page).toContain("byId('todayRefresh').hidden = !panel.hidden && action !== false");
    expect(page).toContain("byId('todayStatus').classList.toggle('sr-only', !panel.hidden)");
    expect(page).toContain("'Owner Operator · Personal Work Only'");
  });

  test('keeps hostile authority bytes out of the Today and Command Center display projections', () => {
    const html = source('public/dashboard/today.html');
    const today = source('public/js/today-page.js');
    const command = source('public/js/command-center-page.js');

    for (const placeholder of ['Job title unavailable', 'Employee name unavailable', 'Customer name unavailable', 'Service location unavailable']) {
      expect(today).toContain(placeholder);
    }
    expect(html).toMatch(/display-projection\.js[\s\S]*today-shell\.js[\s\S]*today-page\.js/);
    expect(today).not.toContain('function markupLike(value)');
    expect(today).toContain('function presentationText(value, fallback)');
    expect(today).toContain('return displayProjection().text(value, fallback)');
    expect(today).toContain("return displayProjection().location(location, 'Service location unavailable')");
    expect(command).not.toContain('function markupLike(value)');
    expect(command).toContain('function presentationString(value, fallback)');
    expect(command).toContain("return displayProjection().text(text, fallback || '')");
    for (const consumer of [today, command]) {
      expect(consumer).not.toMatch(/on\[a-z\].*=/);
      expect(consumer).toContain('DISPLAY_PROJECTION_UNAVAILABLE');
    }
    expect(command).toContain("presentationString(record.customer && record.customer.name, 'Customer name unavailable')");
    expect(command).toContain("presentationString(record.work && record.work.title, 'Job title unavailable')");
  });

  test('projects Calendar and scheduling-dialog labels through one presentation-only contract', () => {
    const html = source('public/dashboard/calendar.html');
    const dashboard = source('public/demo-dashboard.html');
    const projection = source('public/js/display-projection.js');
    const calendar = source('public/js/calendar-engine.js');
    const approval = source('public/js/scheduling-approval-ui.js');

    expect(html).toMatch(/display-projection\.js[\s\S]*scheduling-approval-ui\.js[\s\S]*calendar-engine\.js/);
    expect(html).toContain('<body class="calendar-page">');
    expect(html).toMatch(/body\.calendar-page > \.mobile-header\s*\{[\s\S]*position:\s*fixed\s*!important;[\s\S]*top:\s*0\s*!important;/);
    expect(html).toMatch(/body\.calendar-page > \.dashboard-layout\s*\{[\s\S]*padding-top:\s*calc\(73px \+ env\(safe-area-inset-top\)\)\s*!important;/);
    expect(dashboard).toMatch(/display-projection\.js[\s\S]*scheduling-approval-ui\.js/);
    expect(projection).toContain('NorthStarDisplayProjection');
    expect(projection).toContain('function markupLike(value)');
    expect(projection).toContain('function location(value, fallback)');
    for (const placeholder of [
      'Customer name unavailable', 'Job title unavailable', 'Employee name unavailable',
      'Crew name unavailable', 'Service location unavailable',
    ]) expect(calendar + approval).toContain(placeholder);
    expect(calendar).toContain("calendarRecordLabel(record.customer && record.customer.name, 'Customer name unavailable', 'name')");
    expect(calendar).toContain("calendarRecordLabel(record.work && record.work.title, 'Job title unavailable', 'role')");
    expect(calendar).toContain("calendarDisplayProjection().text(record.customer && record.customer.phone, 'Phone unavailable')");
    expect(calendar).toContain("calendarDisplayProjection().location(record.customer && record.customer.address, 'Service location unavailable')");
    expect(calendar).toContain("calendarDisplayProjection().text(presentation && presentation.serviceText, 'Service type unavailable')");
    expect(calendar).toContain('item.dataset.appointmentId = record.appointmentId');
    expect(approval).toContain("displayProjection().text(match.label, target.kind === 'profile' ? 'Employee name unavailable' : 'Crew name unavailable')");
    expect(approval).toContain("displayProjection().text(entry.label,");
    expect(approval).toContain("displayProjection().text(active.reason.value.trim(), 'Approval reason unavailable')");
  });

  test('keeps legitimate contractor equals and data labels while neutralizing markup-like labels', () => {
    const projection = displayProjection();
    const legitimate = [
      'Zone=Kitchen',
      'Stone=Quartz',
      'Someone=Assigned',
      'Data: cabling',
      'data: reporting',
      '12 Stone=Quartz Way',
      'Onsite=Yes',
      'OnCall=Available',
      'One=1',
      'Only=Scheduled',
      'Online=Available',
      'Onboarding=Complete',
      'Once=Confirmed',
      'Ongoing=Yes',
      'Owner=Operator',
      'On Route=Yes',
      'on call = available',
      'contentvisibilityautostatechange=Enabled',
      'oncontentvisibilityautostatechange-state=review',
      'myonerror=review',
    ];
    for (const value of legitimate) {
      expect(projection.markupLike(value)).toBe(false);
      expect(projection.text(value, 'Job title unavailable')).toBe(value);
    }
    expect(projection.location('12 Stone=Quartz Way', 'Service location unavailable'))
      .toBe('12 Stone=Quartz Way');
    expect(projection.location({ street: '12 Stone=Quartz Way', city: 'Zone=Kitchen' }, 'Service location unavailable'))
      .toBe('12 Stone=Quartz Way, Zone=Kitchen');

    for (const value of [
      '<img src=x onerror="globalThis.compromised=true">',
      'onerror=globalThis.compromised=true',
      'ONLOAD = globalThis.compromised=true',
      'onclick=handleAssignment',
      'javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<svg onload=alert(1)>',
      '&lt;img src=x&gt;',
      '&#60;img src=x&gt;',
      '&#x3c;img src=x&gt;',
    ]) {
      expect(projection.markupLike(value)).toBe(true);
      expect(projection.text(value, 'Job title unavailable')).toBe('Job title unavailable');
    }
  });

  test('classifies the complete audited Chrome and WebKit event-handler union without broad on-prefix filtering', () => {
    const projection = displayProjection();
    const independentlyEnumeratedMissingHandlers = [
      'onappinstalled', 'onbeforecopy', 'onbeforecut', 'onbeforeinstallprompt', 'onbeforeload',
      'onbeforepaste', 'onbeforexrselect', 'oncontentvisibilityautostatechange', 'onencrypted',
      'onenterpictureinpicture', 'onfreeze', 'ongamepadconnected', 'ongamepaddisconnected',
      'onleavepictureinpicture', 'onorientationchange', 'onpointerlockchange', 'onpointerlockerror',
      'onprerenderingchange', 'onreadystatechange', 'onresume', 'onscrollsnapchange',
      'onscrollsnapchanging', 'onsearch', 'ontouchforcechange', 'onwaitingforkey',
      'onwebkitanimationend', 'onwebkitanimationiteration', 'onwebkitanimationstart',
      'onwebkitfullscreenchange', 'onwebkitfullscreenerror', 'onwebkitmouseforcechanged',
      'onwebkitmouseforcedown', 'onwebkitmouseforceup', 'onwebkitmouseforcewillbegin',
      'onwebkittransitionend',
    ];
    for (const name of independentlyEnumeratedMissingHandlers) {
      expect(projection.markupLike(`${name}=handler`)).toBe(true);
      expect(projection.text(`${name}=handler`, 'Job title unavailable')).toBe('Job title unavailable');
    }
    for (const value of [
      'onclick=handler',
      'ONCONTENTVISIBILITYAUTOSTATECHANGE = handler',
      'onscrollsnapchange\t=handler',
      'x,onreadystatechange=x',
      '(onfreeze=x',
      'x/onresume=x',
      '[onsearch=x',
      'onwaitingforkey&#x3d;x',
      'onwaitingforkey&#61;x',
    ]) expect(projection.markupLike(value)).toBe(true);
    for (const value of [
      'Onsite=Yes', 'OnCall=Available', 'One=1', 'Only=Scheduled',
      'oncontentvisibilityautostatechange-state=review', 'myonerror=review',
      'on waitingforkey=review', 'contentvisibilityautostatechange=Enabled',
    ]) expect(projection.markupLike(value)).toBe(false);
  });

  test('uses a clear shared theme switch and a real themed Today sign-out button', () => {
    const theme = source('public/js/theme.js');
    const shell = source('public/js/today-shell.js');
    const shared = source('public/css/site-professionalism.css');
    const today = source('public/css/today.css');

    expect(theme).toContain('northstar-theme-switch');
    expect(theme).toContain('northstar-theme-sun');
    expect(theme).toContain('northstar-theme-moon');
    expect(theme).toContain("button.setAttribute('data-current-theme', theme)");
    expect(shell).toContain("node('button', 'today-sign-out')");
    expect(shell).toContain("control.setAttribute('aria-disabled', 'true')");
    expect(shared).toMatch(/\.northstar-theme-switch\s*\{[\s\S]*width:\s*76px\s*!important;[\s\S]*height:\s*38px\s*!important;[\s\S]*border-radius:\s*999px/);
    expect(shared).toMatch(/\.northstar-theme-switch::before\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px;/);
    expect(shared).toMatch(/data-current-theme="dark"\]::before\s*\{\s*transform:\s*translateX\(38px\)/);
    expect(today).toContain('.today-sign-out');
    expect(today).toContain('.today-sign-out:disabled');
  });

  test('Quick Start is a one-time centered Command Center guide, not a floating page overlay', () => {
    const guidance = source('public/js/workspace-guidance.js');
    const guidanceCss = source('public/css/workspace-guidance.css');
    expect(guidance).toContain("activePage === 'command-center' && !hasSeenGuide(mode, accountKey)");
    expect(guidance).toContain("global.localStorage.setItem(seenStorageKey(mode, accountKey), 'true')");
    expect(guidance).toContain("document.querySelectorAll('[data-quick-start-reopen]')");
    expect(guidanceCss).not.toContain('.northstar-quick-start-button');
    expect(guidanceCss).toMatch(/\.northstar-quick-start-dialog\s*\{[\s\S]*inset:\s*50% auto auto 50%;[\s\S]*transform:\s*translate\(-50%, -50%\)/);
  });

  test('uses customer-facing scheduling language and removes the paid ready sentence without a gap', () => {
    const html = source('public/demo-dashboard.html');
    const page = source('public/js/command-center-page.js');
    const contract = source('public/js/command-center-contract.js');
    const calendar = source('public/js/calendar-engine.js');
    const scheduling = source('public/css/scheduling-approval.css');

    expect(html).toContain('Scheduling Overview');
    for (const value of [html, page, contract, calendar]) {
      expect(value).not.toMatch(/canonical scheduling|canonical appointments/i);
    }
    expect(page).not.toContain('The current tenant workspace is ready.');
    expect(page).not.toContain('Demo data · account-free');
    expect(page).not.toContain('Canonical owner and dispatcher');
    expect(page).not.toContain('workspace is current');
    expect(page).not.toContain('Workspace ready');
    expect(page).not.toContain('Session ready');
    expect(page).not.toContain('The isolated workspace is ready.');
    expect(page).toContain("byId('commandCenterAuthority').textContent = demo ? 'Demo Data' : 'Workspace Data';");
    expect(page).toContain("byId('commandCenterStatePill').hidden = true;");
    expect(page).toContain('status.hidden = !message');
    expect(page).toContain("definition.textContent = 'Review current scheduling records in ' + overview.timeZone + '.';");
    expect(page).not.toContain("definition.textContent = 'Showing ' + page.shown + ' of ' + page.total + ' appointments");
    expect(page).not.toContain('overview.definitions[schedulingCategory]');
    expect(scheduling).toMatch(/\.m22-authority-heading > div\s*\{\s*display:\s*grid;\s*gap:\s*6px;/);
    expect(calendar).not.toContain('New work originates from');
    expect(calendar).not.toContain('Server categories:');
    expect(calendar).toContain('Review appointments and approve schedule changes.');
    expect(calendar).toContain("calendarTitleCaseLabel(state)");
  });

  test('matches the Today read-only control typography and keeps compact dates out of visible timezone wrapping', () => {
    const today = source('public/css/today.css');
    const command = source('public/js/command-center-page.js');
    const commandCss = source('public/css/demo-dashboard.css');

    expect(today).toMatch(/\.today-refresh\s*\{[\s\S]*font-size:\s*13px;[\s\S]*font-weight:\s*600;/);
    expect(today).toMatch(/\.today-readonly-badge\s*\{[\s\S]*min-height:\s*44px;[\s\S]*font-size:\s*13px;[\s\S]*font-weight:\s*600;[\s\S]*justify-content:\s*center;/);
    expect(today).toMatch(/\.today-state-badge,[\s\S]*font-family:\s*var\(--font-body, inherit\);[\s\S]*font-weight:\s*600;/);
    expect(command).toContain('function formatCompactDate(value, suppliedTimeZone)');
    expect(command).toContain("time.title = fullDate || date");
    expect(command).not.toContain("+ ' (' + timeZone + ')'" );
    expect(command).not.toContain("summary.appendChild(element('div', '', 'The chart remains empty");
    expect(commandCss).toMatch(/\.command-center-blueprint-header\s*\{\s*position:\s*sticky;\s*top:\s*0;\s*z-index:\s*300;/);
  });

  test('keeps Reload actions consistently separated from state copy and card boundaries', () => {
    const css = source('public/css/today.css');

    expect(css).toMatch(/\.today-state-panel\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*justify-items:\s*center;[\s\S]*gap:\s*20px;[\s\S]*text-align:\s*center;/);
    expect(css).toMatch(/\.today-state-copy\s*\{[\s\S]*gap:\s*10px;/);
    expect(css).toMatch(/\.today-state-action\s*\{[\s\S]*justify-self:\s*center;[\s\S]*margin-top:\s*2px;/);
    expect(css).toMatch(/@media \(max-width:\s*768px\)[\s\S]*\.today-state-action\s*\{\s*width:\s*min\(100%, 360px\);[\s\S]*margin-top:\s*0;/);
  });

  test('uses structured scheduling state rows and deduplicated attention indicators', () => {
    const html = source('public/demo-dashboard.html');
    const page = source('public/js/command-center-page.js');
    const css = source('public/css/scheduling-approval.css');

    expect(html).toContain('Owner and Dispatcher Overview');
    for (const label of ['Assignment', 'Schedule', 'Dispatch']) {
      expect(page).toContain(`schedulingStateItem('${label}'`);
    }
    expect(page).toContain('Array.from(new Set(attention))');
    expect(css).toContain('.m22-state-summary');
    expect(css).toContain('.m22-record-status');
  });

  test('groups repeated customer work without repeating unavailable timestamps', () => {
    const page = source('public/js/command-center-page.js');

    expect(page).toContain('groupByCustomer');
    expect(page).toContain('customerCell.rowSpan = group.records.length');
    expect(page).toContain('command-center-customer-record-count');
    expect(page).not.toContain('Recorded time unavailable');
  });

  test('reflows the mobile lead table into complete grouped customer cards', () => {
    const html = source('public/demo-dashboard.html');
    const css = source('public/css/demo-dashboard.css');
    const page = source('public/js/command-center-page.js');

    expect(html).toContain('id="commandCenterLeadCards"');
    expect(css).not.toMatch(/\.demo-table-wrap table\s*\{[^}]*760px/);
    expect(css).toMatch(/\.demo-leads-panel \.demo-table-wrap\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.command-center-mobile-leads\s*\{\s*display:\s*grid/);
    expect(page).toContain("element('article', 'command-center-mobile-customer')");
    for (const label of ['Recorded Value', 'Status', 'Next Action']) expect(page).toContain(`'${label}'`);
  });

  test('splits camel-case owner labels and supplies accessible dark operational colors', () => {
    const page = source('public/js/command-center-page.js');
    const today = source('public/css/today.css');
    const scheduling = source('public/css/scheduling-approval.css');

    expect(page).toContain("replace(/([a-z0-9])([A-Z])/g, '$1 $2')");
    expect(today).toMatch(/\[data-theme="dark"\] \.today-scope-note > span,[\s\S]*\.today-detail-label,[\s\S]*\.today-disclosure summary::after\s*\{\s*color:\s*var\(--brand-200\)/);
    expect(scheduling).toMatch(/\[data-theme="dark"\][\s\S]*\.m22-state-chip\[data-state="at_risk"\][\s\S]*color:\s*#fde68a/);
  });
});
