(function (global) {
  'use strict';

  var STORAGE_KEY = 'northstar_workspace_quick_start_v1';

  function safeStorage(mode) {
    try { return mode === 'demo' ? global.sessionStorage : global.localStorage; }
    catch (_error) { return null; }
  }

  function readState(mode) {
    var storage = safeStorage(mode);
    if (!storage) return {};
    try {
      var value = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_error) { return {}; }
  }

  function writeState(mode, value) {
    var storage = safeStorage(mode);
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (_error) {}
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function stepsFor(mode) {
    if (mode === 'demo') return [
      { id: 'command-center', label: 'See today’s priorities', href: '/demo' },
      { id: 'simulate', label: 'Run one guided scenario', href: '/demo#northstarDemoToolbar' },
      { id: 'leads', label: 'Review the captured lead', href: '/demo/leads' },
      { id: 'polaris', label: 'Ask Polaris about the workspace', href: '/demo/polaris' }
    ];
    return [
      { id: 'command-center', label: 'Review the Command Center', href: '/dashboard' },
      { id: 'business-profile', label: 'Complete the Business Profile', href: '/dashboard/business-profile' },
      { id: 'settings', label: 'Confirm AI and notification settings', href: '/dashboard/settings' },
      { id: 'integrations', label: 'Review integration readiness', href: '/dashboard/integrations' }
    ];
  }

  function init(options) {
    if (document.getElementById('northstarQuickStartButton')) return;
    var mode = options && options.mode === 'demo' ? 'demo' : 'paid';
    var activePage = options && options.activePage || '';
    var state = readState(mode);
    if (activePage) state[activePage] = true;
    try {
      if (mode === 'demo' && global.sessionStorage.getItem('northstarOnboardingSimulated') === 'true') state.simulate = true;
    } catch (_error) {}
    writeState(mode, state);

    var button = element('button', 'northstar-quick-start-button', 'Quick Start');
    button.id = 'northstarQuickStartButton';
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');

    var dialog = element('dialog', 'northstar-quick-start-dialog');
    dialog.id = 'northstarQuickStartDialog';
    dialog.setAttribute('aria-labelledby', 'northstarQuickStartHeading');
    var headingRow = element('div', 'northstar-quick-start-heading');
    var heading = element('h2', '', mode === 'demo' ? 'Explore NorthStar' : 'Finish Workspace Setup');
    heading.id = 'northstarQuickStartHeading';
    var close = element('button', 'northstar-quick-start-close', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close quick start');
    headingRow.append(heading, close);
    var intro = element('p', 'northstar-quick-start-intro', mode === 'demo'
      ? 'A short path through the working shared demo.'
      : 'Complete the essentials before relying on NorthStar operationally.');
    var list = element('ol', 'northstar-quick-start-list');
    var steps = stepsFor(mode);
    steps.forEach(function (step) {
      var item = element('li', state[step.id] ? 'complete' : '');
      var link = element('a', '', step.label);
      link.href = step.href;
      link.dataset.quickStartStep = step.id;
      var status = element('span', 'northstar-quick-start-status', state[step.id] ? 'Complete' : 'Open');
      item.append(link, status);
      list.appendChild(item);
    });
    var completeCount = steps.filter(function (step) { return state[step.id]; }).length;
    var progress = element('p', 'northstar-quick-start-progress', completeCount + ' of ' + steps.length + ' complete');
    dialog.append(headingRow, intro, list, progress);
    document.body.append(button, dialog);

    button.addEventListener('click', function () { dialog.showModal(); });
    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
  }

  global.NorthStarWorkspaceGuidance = Object.freeze({ init: init });
})(window);
