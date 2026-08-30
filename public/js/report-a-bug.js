(function (global) {
  'use strict';

  var form = document.getElementById('supportReportForm');
  var formSection = document.getElementById('supportFormSection');
  var authState = document.getElementById('supportAuthState');
  var historyStatus = document.getElementById('supportHistoryStatus');
  var historyList = document.getElementById('supportHistoryList');
  var reloadButton = document.getElementById('supportReload');
  var submitButton = document.getElementById('supportSubmit');
  var progress = document.getElementById('supportSubmitProgress');
  var result = document.getElementById('supportResult');
  var retryIdentity = null;

  function text(tag, className, value) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function date(value) {
    var parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Time unavailable';
  }

  function forwarding(value) {
    if (value === 'delivered') return 'Forwarding accepted by the configured provider';
    if (value === 'retry') return 'Forwarding will retry';
    if (value === 'unavailable') return 'Forwarding unavailable; the case remains preserved';
    return 'Forwarding pending';
  }

  function renderHistory(reports) {
    var fragment = document.createDocumentFragment();
    reports.forEach(function (report) {
      var article = text('article', 'support-case');
      article.dataset.caseId = report.id;
      var heading = text('div', 'support-case-heading');
      var titleGroup = text('div');
      titleGroup.appendChild(text('p', 'support-reference', report.reference));
      titleGroup.appendChild(text('h3', '', report.title));
      heading.appendChild(titleGroup);
      heading.appendChild(text('span', 'support-state', report.stateLabel));
      article.appendChild(heading);
      article.appendChild(text('p', 'support-case-description', report.description));
      var metadata = text('div', 'support-case-meta');
      metadata.appendChild(text('span', '', 'Submitted ' + date(report.submittedAt)));
      metadata.appendChild(text('span', '', forwarding(report.forwarding && report.forwarding.state)));
      article.appendChild(metadata);
      if (report.attachment) {
        var link = text('a', '', 'View sanitized screenshot: ' + report.attachment.filename);
        link.href = report.attachment.url;
        link.target = '_blank';
        link.rel = 'noopener';
        article.appendChild(link);
      }
      var events = text('ol', 'support-case-history');
      (report.history || []).forEach(function (event) {
        events.appendChild(text('li', '', event.stateLabel + ' — ' + event.message + ' (' + date(event.createdAt) + ')'));
      });
      article.appendChild(events);
      fragment.appendChild(article);
    });
    historyList.replaceChildren(fragment);
  }

  function body(response) {
    return response.json().catch(function () { return {}; });
  }

  function errorFrom(response, payload) {
    var message = payload && payload.error && payload.error.message;
    var error = new Error(message || 'The support request could not be completed.');
    error.status = response.status;
    error.code = payload && payload.error && payload.error.code;
    return error;
  }

  function loadHistory() {
    reloadButton.disabled = true;
    historyStatus.textContent = 'Loading durable report history…';
    return global.NorthStarAccountSession.fetch('/api/v1/support/bug-reports', {
      method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' },
    }).then(function (response) {
      return body(response).then(function (payload) {
        if (!response.ok) throw errorFrom(response, payload);
        var reports = Array.isArray(payload.data) ? payload.data : [];
        renderHistory(reports);
        historyStatus.textContent = reports.length
          ? reports.length + (reports.length === 1 ? ' report is shown.' : ' reports are shown.')
          : 'No bug reports have been submitted for this organization.';
      });
    }).catch(function (error) {
      historyList.replaceChildren();
      historyStatus.textContent = error.message || 'Report history is temporarily unavailable.';
    }).finally(function () { reloadButton.disabled = false; });
  }

  function idempotencyKey() {
    if (retryIdentity) return retryIdentity;
    if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
      throw new Error('Secure retry identity is unavailable. Refresh this page and try again.');
    }
    retryIdentity = 'northstar-support-' + global.crypto.randomUUID();
    return retryIdentity;
  }

  function showSuccess(report) {
    result.replaceChildren();
    result.appendChild(text('h3', '', report.replayed ? 'Existing report confirmed' : 'Bug report received'));
    result.appendChild(text('p', 'support-reference', report.reference));
    result.appendChild(text('p', '', 'Submitted ' + date(report.submittedAt) + '. Current state: ' + report.stateLabel + '.'));
    result.appendChild(text('p', '', forwarding(report.forwarding && report.forwarding.state) + '.'));
    result.appendChild(text('p', '', 'Keep this reference and reload organization history for status updates. No response time is promised.'));
    result.hidden = false;
    result.focus();
  }

  form.addEventListener('input', function () {
    retryIdentity = null;
    result.hidden = true;
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    var file = document.getElementById('supportScreenshot').files[0];
    if (file && file.size > 5 * 1024 * 1024) {
      progress.dataset.state = 'error';
      progress.textContent = 'The screenshot must be no larger than 5 MB.';
      return;
    }
    var key;
    try { key = idempotencyKey(); } catch (error) {
      progress.dataset.state = 'error';
      progress.textContent = error.message;
      return;
    }
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    progress.dataset.state = 'progress';
    progress.textContent = 'Preserving your report…';
    var data = new FormData(form);
    global.NorthStarAccountSession.fetch('/api/v1/support/bug-reports', {
      method: 'POST', headers: { Accept: 'application/json', 'Idempotency-Key': key }, body: data,
    }).then(function (response) {
      return body(response).then(function (payload) {
        if (!response.ok) throw errorFrom(response, payload);
        showSuccess(payload.data);
        progress.dataset.state = 'success';
        progress.textContent = 'Report preserved with reference ' + payload.data.reference + '.';
        retryIdentity = null;
        form.reset();
        return loadHistory();
      });
    }).catch(function (error) {
      progress.dataset.state = 'error';
      progress.textContent = (error.message || 'The report was not confirmed.') + ' Retry to check the same submission safely.';
    }).finally(function () {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
    });
  });

  reloadButton.addEventListener('click', loadHistory);

  if (!global.NorthStarAccountSession || typeof global.NorthStarAccountSession.load !== 'function') {
    authState.textContent = 'A signed-in NorthStar organization is required. No report was submitted.';
    return;
  }
  global.NorthStarAccountSession.load().then(function (account) {
    if (!account || !account.user || account.user.status !== 'active' || !account.organization) {
      throw new Error('A verified signed-in NorthStar organization is required.');
    }
    authState.textContent = 'Reports are stored with ' + account.organization.name + '. Email forwarding is shown separately from case receipt.';
    formSection.hidden = false;
    reloadButton.disabled = false;
    return loadHistory();
  }).catch(function (error) {
    authState.textContent = (error && error.message ? error.message : 'Sign-in is required.') + ' No report was submitted.';
    formSection.hidden = true;
    historyStatus.textContent = 'Report history is unavailable without organization access.';
  });
})(window);
