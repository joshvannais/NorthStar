(function (global) {
  'use strict';

  var STORAGE_KEY = 'northstar_workspace_quick_start_v1';
  var SEEN_KEY = 'northstar_workspace_quick_start_seen_v2';

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

  function hasSeenGuide(mode) {
    try { return global.localStorage.getItem(SEEN_KEY + ':' + mode) === 'true'; }
    catch (_error) { return false; }
  }

  function markGuideSeen(mode) {
    try { global.localStorage.setItem(SEEN_KEY + ':' + mode, 'true'); }
    catch (_error) {}
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
    if (document.getElementById('northstarQuickStartDialog')) return;
    var mode = options && options.mode === 'demo' ? 'demo' : 'paid';
    var activePage = options && options.activePage || '';
    var state = readState(mode);
    if (activePage) state[activePage] = true;
    try {
      if (mode === 'demo' && global.sessionStorage.getItem('northstarOnboardingSimulated') === 'true') state.simulate = true;
    } catch (_error) {}
    writeState(mode, state);

    // The guide is an intentional first-arrival experience on Command Center,
    // not a floating control that can cover operational content on every page.
    if (activePage !== 'command-center' || hasSeenGuide(mode)) return;

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
    document.body.appendChild(dialog);

    function dismiss() {
      markGuideSeen(mode);
      if (dialog.open) dialog.close();
      dialog.remove();
    }

    close.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); dismiss(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dismiss(); });
    list.addEventListener('click', function (event) {
      if (event.target.closest('a[data-quick-start-step]')) markGuideSeen(mode);
    });
    global.requestAnimationFrame(function () {
      if (dialog.isConnected && !dialog.open) dialog.showModal();
    });
  }

  global.NorthStarWorkspaceGuidance = Object.freeze({ init: init });
})(window);
