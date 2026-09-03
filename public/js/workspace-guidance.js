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

  function seenStorageKey(mode, accountKey) {
    return SEEN_KEY + ':' + mode + ':' + String(accountKey || mode);
  }

  function isCommandCenterPath(mode) {
    var pathname = String(global.location && global.location.pathname || '').replace(/\/$/, '') || '/';
    return mode === 'demo'
      ? pathname === '/demo' || pathname === '/demo/command-center'
      : pathname === '/dashboard' || pathname === '/dashboard/command-center';
  }

  function hasSeenGuide(mode, accountKey) {
    try { return global.localStorage.getItem(seenStorageKey(mode, accountKey)) === 'true'; }
    catch (_error) { return false; }
  }

  function markGuideSeen(mode, accountKey) {
    try { global.localStorage.setItem(seenStorageKey(mode, accountKey), 'true'); }
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
      { id: 'simulate', label: 'Run a guided scenario', href: '/demo#northstarDemoToolbar' },
      { id: 'leads', label: 'Review the result', href: '/demo/leads' }
    ];
    return [
      { id: 'command-center', label: 'Review today’s priorities', href: '/dashboard' },
      { id: 'business-profile', label: 'Add your business essentials', href: '/dashboard/business-profile' },
      { id: 'settings', label: 'Confirm workspace settings', href: '/dashboard/settings' }
    ];
  }

  function init(options) {
    if (document.getElementById('northstarQuickStartDialog')) return;
    var mode = options && options.mode === 'demo' ? 'demo' : 'paid';
    var activePage = options && options.activePage || '';
    var accountKey = options && options.accountKey || mode;
    var state = readState(mode);
    if (activePage) state[activePage] = true;
    try {
      if (mode === 'demo' && global.sessionStorage.getItem('northstarOnboardingSimulated') === 'true') state.simulate = true;
    } catch (_error) {}
    writeState(mode, state);

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
      ? 'Three quick steps show how one call becomes organized work.'
      : 'Three quick steps prepare your workspace for daily use.');
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

    var returnFocus = null;
    function dismiss() {
      markGuideSeen(mode, accountKey);
      if (dialog.open) dialog.close();
      if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll:true });
      returnFocus = null;
    }

    function openGuide(trigger) {
      var mobileTrigger = trigger && trigger.closest && trigger.closest('#mobileMenu');
      if (mobileTrigger && global.NavComponent && typeof global.toggleMobileMenu === 'function') {
        global.toggleMobileMenu();
        returnFocus = document.getElementById('navHamburgerBtn');
      } else {
        returnFocus = trigger && typeof trigger.focus === 'function' ? trigger : document.activeElement;
      }
      if (!dialog.open) dialog.showModal();
      global.requestAnimationFrame(function() { if (close.isConnected) close.focus({ preventScroll:true }); });
    }

    close.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); dismiss(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dismiss(); });
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var focusable = Array.prototype.slice.call(dialog.querySelectorAll('a[href],button:not([disabled])'));
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll:true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll:true });
      }
    });
    list.addEventListener('click', function (event) {
      if (event.target.closest('a[data-quick-start-step]')) markGuideSeen(mode, accountKey);
    });
    document.querySelectorAll('[data-quick-start-reopen]').forEach(function(trigger) {
      trigger.addEventListener('click', function() { openGuide(trigger); });
    });
    if (activePage === 'command-center' && isCommandCenterPath(mode) && !hasSeenGuide(mode, accountKey)) {
      global.requestAnimationFrame(function () { if (dialog.isConnected) openGuide(null); });
    }
  }

  global.NorthStarWorkspaceGuidance = Object.freeze({ init: init });
})(window);
