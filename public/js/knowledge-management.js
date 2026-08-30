(function (global) {
  'use strict';

  var mounts = document.querySelectorAll('[data-knowledge-management]');
  if (!mounts.length) return;

  var STATUS_LABELS = Object.freeze({
    approved: 'Approved', current: 'Current / in sync', dead: 'Dead letter',
    draft: 'Draft', drifted: 'Drift detected', pending: 'Pending / stale',
    published: 'Published', read_only: 'Read only', reconciliation_needed: 'Reconciliation needed',
    retrying: 'Retrying', review: 'In review', stale: 'Stale', suspended: 'Suspended',
  });
  var FILTERS = Object.freeze([
    { key: 'category', label: 'Category', values: ['fact', 'override', 'policy', 'faq', 'guidance', 'constraint', 'generated_knowledge', 'disclosure'] },
    { key: 'workflowStatus', label: 'Workflow', values: ['draft', 'review', 'approved', 'published'] },
    { key: 'sensitivity', label: 'Sensitivity', values: ['public', 'internal', 'restricted', 'legal'] },
    { key: 'source', label: 'Source', values: ['business_profile', 'service_catalogue', 'workforce', 'asset_catalogue', 'policy_override', 'human_input', 'system_generation', 'imported_record'] },
    { key: 'applicability', label: 'Applicability', values: ['customer', 'internal', 'workforce', 'voice_runtime', 'integration_adapter'] },
  ]);

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function append(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      if (arguments[index]) parent.appendChild(arguments[index]);
    }
    return parent;
  }

  function titleCase(value) {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function shortDigest(value) {
    var text = String(value || '');
    return text.length > 16 ? text.slice(0, 12) + '…' + text.slice(-4) : text;
  }

  function when(value) {
    if (!value) return 'Not recorded';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function badge(value) {
    var normalized = String(value || 'unknown');
    var item = node('span', 'km-badge', STATUS_LABELS[normalized] || titleCase(normalized));
    item.dataset.state = normalized;
    return item;
  }

  function definition(rows) {
    var list = node('dl', 'km-definition');
    rows.forEach(function (row) {
      append(list, node('dt', '', row[0]), node('dd', row[2] || '', row[1] === null || row[1] === undefined ? 'Not recorded' : row[1]));
    });
    return list;
  }

  function parseResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok || !body || body.success !== true) {
        var detail = body && body.error;
        var message = detail && typeof detail === 'object' ? detail.message : detail;
        var error = new Error(message || 'Knowledge Management request failed.');
        error.code = detail && detail.code || body.code || 'knowledge_management_request_failed';
        error.status = response.status;
        error.details = detail && detail.details || {};
        throw error;
      }
      return body.data;
    });
  }

  function request(path, options) {
    return global.NorthStarAccountSession.fetch(path, options || {}).then(parseResponse);
  }

  function queryString(filters, pagination) {
    var params = new URLSearchParams();
    Object.keys(filters).forEach(function (key) {
      if (filters[key]) params.set(key, filters[key]);
    });
    if (pagination && pagination.cursor) params.set('cursor', pagination.cursor);
    if (pagination && pagination.limit) params.set('limit', String(pagination.limit));
    var value = params.toString();
    return value ? '?' + value : '';
  }

  function captureDetailTarget(detail) {
    var publication = detail.publication && detail.publication.current;
    return Object.freeze({
      entryId: detail.entry.id,
      canonicalKey: detail.entry.canonicalKey,
      category: detail.entry.category,
      versionId: detail.version.id,
      versionNumber: detail.version.number,
      canonicalDigest: detail.version.canonicalDigest,
      expectedReviewEventId: detail.workflow.latestReviewEventId || null,
      expectedPublicationId: publication && publication.id || null,
      expectedPublicationNumber: publication && publication.number || 0,
      label: detail.version.label,
      origin: detail.version.origin,
      sensitivity: detail.version.sensitivity,
      reviewRequirement: detail.version.reviewRequirement,
      applicability: detail.version.applicability,
      document: detail.version.document,
      history: Array.isArray(detail.history) ? detail.history.map(function (version) {
        return Object.freeze({
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          canonicalDigest: version.canonicalDigest,
          lifecycleAction: version.lifecycleAction,
        });
      }) : [],
    });
  }

  function detailTargetKey(target) {
    return JSON.stringify([
      target.entryId, target.versionId, target.versionNumber, target.canonicalDigest,
      target.expectedReviewEventId, target.expectedPublicationId, target.expectedPublicationNumber,
    ]);
  }

  function createController(root, instance) {
    var state = {
      account: null,
      data: null,
      detail: null,
      detailDisclosed: false,
      detailRequestSequence: 0,
      filters: {},
      instance: instance,
      listRequestSequence: 0,
      renderedTargetKey: null,
      selectedEntryId: null,
      surface: root.dataset.surface || 'settings',
    };
    var status = root.querySelector('[data-km-status]');
    var countRoot = root.querySelector('[data-km-counts]');
    var listRoot = root.querySelector('[data-km-list]');
    var detailRoot = root.querySelector('[data-km-detail]');
    var filtersRoot = root.querySelector('[data-km-filters]');

    function setStatus(kind, message) {
      root.dataset.state = kind;
      status.textContent = message;
      status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      status.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    }

    function buildFilters() {
      var fragment = document.createDocumentFragment();
      FILTERS.forEach(function (filter) {
        var field = node('div', 'km-filter');
        var id = 'km-' + instance + '-' + filter.key;
        var label = node('label', '', filter.label);
        label.htmlFor = id;
        var select = node('select');
        select.id = id;
        select.dataset.filter = filter.key;
        append(select, node('option', '', 'All ' + filter.label.toLowerCase()));
        filter.values.forEach(function (value) {
          var option = node('option', '', titleCase(value));
          option.value = value;
          select.appendChild(option);
        });
        select.addEventListener('change', function () {
          state.filters[filter.key] = select.value;
          loadList(false);
        });
        append(field, label, select);
        fragment.appendChild(field);
      });
      filtersRoot.replaceChildren(fragment);
    }

    function renderCounts() {
      if (!state.data) return countRoot.replaceChildren();
      var count = state.data.counts || {};
      var items = [
        ['Visible', count.total || 0],
        ['Matching', state.data.filteredCount || 0],
        ['Draft', count.workflowStatus && count.workflowStatus.draft || 0],
        ['Review', count.workflowStatus && count.workflowStatus.review || 0],
        ['Approved', count.workflowStatus && count.workflowStatus.approved || 0],
        ['Published', count.workflowStatus && count.workflowStatus.published || 0],
      ];
      var fragment = document.createDocumentFragment();
      items.forEach(function (item) { fragment.appendChild(node('li', '', item[0] + ': ' + item[1])); });
      countRoot.replaceChildren(fragment);
    }

    function selectItem(entryId, versionNumber, restoreFocus) {
      var requestSequence = state.detailRequestSequence + 1;
      state.detailRequestSequence = requestSequence;
      if (restoreFocus) state.detailDisclosed = true;
      else if (state.selectedEntryId !== entryId) state.detailDisclosed = false;
      state.selectedEntryId = entryId;
      listRoot.querySelectorAll('.km-item-button').forEach(function (button) {
        button.setAttribute('aria-current', button.dataset.entryId === entryId ? 'true' : 'false');
      });
      setStatus('loading', 'Loading exact immutable knowledge detail…');
      detailRoot.setAttribute('aria-busy', 'true');
      var suffix = versionNumber ? '?versionNumber=' + encodeURIComponent(String(versionNumber)) : '';
      return request('/api/v1/knowledge-management/items/' + encodeURIComponent(entryId) + suffix, {
        method: 'GET', cache: 'no-store',
      }).then(function (detail) {
        if (requestSequence !== state.detailRequestSequence || state.selectedEntryId !== entryId) return null;
        if (!detail || !detail.entry || detail.entry.id !== entryId ||
            (versionNumber && Number(detail.version.number) !== Number(versionNumber))) {
          var mismatch = new Error('The detail response did not match the requested immutable knowledge target. Reload the exact item.');
          mismatch.code = 'knowledge_management_detail_target_mismatch';
          throw mismatch;
        }
        state.detail = detail;
        renderDetail();
        setStatus('ready', state.data
          ? listStatusMessage(state.data)
          : 'Knowledge detail loaded from canonical tenant authority.');
        if (restoreFocus) {
          var heading = detailRoot.querySelector('h3');
          if (heading) heading.focus();
        }
        return detail;
      }).catch(function (error) {
        if (requestSequence !== state.detailRequestSequence || state.selectedEntryId !== entryId) return null;
        state.detail = null;
        state.renderedTargetKey = null;
        delete detailRoot.dataset.targetKey;
        renderDetailError(error);
        setStatus('error', error.message);
      }).finally(function () {
        if (requestSequence === state.detailRequestSequence && state.selectedEntryId === entryId) {
          detailRoot.removeAttribute('aria-busy');
        }
      });
    }

    function renderList() {
      var items = state.data && state.data.items || [];
      if (!items.length) {
        listRoot.replaceChildren(node('li', 'km-empty', state.data && state.data.counts && state.data.counts.total
          ? 'No knowledge matches these filters.' : 'No generated knowledge exists yet. Generate knowledge from authoritative Business Profile inputs before review.'));
        state.detail = null;
        state.renderedTargetKey = null;
        delete detailRoot.dataset.targetKey;
        detailRoot.replaceChildren(node('div', 'km-empty', 'Choose an available knowledge item to inspect its exact authority.'));
        return;
      }
      var fragment = document.createDocumentFragment();
      items.forEach(function (item) {
        var wrapper = node('li');
        var button = node('button', 'km-item-button');
        button.type = 'button';
        button.dataset.entryId = item.entryId;
        button.setAttribute('aria-current', item.entryId === state.selectedEntryId ? 'true' : 'false');
        button.setAttribute('aria-label', 'Open ' + item.version.label + ', ' + (STATUS_LABELS[item.workflowStatus] || item.workflowStatus));
        var meta = node('span', 'km-meta');
        append(meta, badge(item.workflowStatus), node('span', 'km-badge', titleCase(item.version.sensitivity)));
        append(button,
          node('span', 'km-item-title', item.version.label),
          meta,
          node('span', 'km-item-key', 'Version ' + item.version.number + ' · ' + shortDigest(item.version.digest))
        );
        button.addEventListener('click', function () { selectItem(item.entryId, null, true); });
        wrapper.appendChild(button);
        fragment.appendChild(wrapper);
      });
      if (state.data.pagination && state.data.pagination.hasMore) {
        var continuation = node('li', 'km-list-continuation');
        var loadMore = node('button', 'km-action km-action-secondary', 'Load more knowledge items');
        loadMore.type = 'button';
        loadMore.addEventListener('click', function () { loadNextPage(loadMore); });
        append(continuation,
          node('p', 'km-action-explanation', items.length + ' of ' + state.data.filteredCount + ' matching items are loaded.'),
          loadMore
        );
        fragment.appendChild(continuation);
      }
      listRoot.replaceChildren(fragment);
      if (!items.some(function (item) { return item.entryId === state.selectedEntryId; })) {
        selectItem(items[0].entryId, null, false);
      }
    }

    function renderDetailError(error) {
      var box = node('div', 'km-error');
      append(box, node('h3', '', 'Knowledge detail unavailable'), node('p', '', error.message));
      var retry = node('button', 'km-action km-action-secondary', 'Retry detail');
      retry.type = 'button';
      retry.addEventListener('click', function () { selectItem(state.selectedEntryId, null, true); });
      box.appendChild(retry);
      detailRoot.replaceChildren(box);
    }

    function renderOverview(panel, detail) {
      var version = detail.version;
      var publication = detail.publication.current;
      var summary = node('section', 'km-section');
      append(summary, node('h4', '', 'Exact immutable version'), definition([
        ['Version ID', version.id, 'km-mono'], ['Version number', version.number],
        ['Canonical digest', version.canonicalDigest, 'km-mono'], ['Origin', titleCase(version.origin)],
        ['Sensitivity', titleCase(version.sensitivity)], ['Approval class', titleCase(version.reviewRequirement)],
        ['Lifecycle action', titleCase(version.lifecycleAction)], ['Actor', version.actorUserId, 'km-mono'],
        ['Created', when(version.createdAt)], ['Reason', version.reason],
      ]));
      var published = node('section', 'km-section');
      append(published, node('h4', '', 'Publication and approval evidence'), definition([
        ['Workflow', STATUS_LABELS[detail.workflow.status] || titleCase(detail.workflow.status)],
        ['Approval evidence', titleCase(detail.workflow.approvalEvidenceStatus)],
        ['Current publication', publication
          ? (publication.numberRestricted ? 'Number restricted · ' : '#' + publication.number + ' · ') + publication.id
          : detail.publication.currentRestricted ? 'Restricted for this role' : 'Not published', publication ? 'km-mono' : ''],
        ['Published exact version', publication ? publication.versionId : null, 'km-mono'],
        ['Published digest', publication ? publication.digest : null, 'km-mono'],
        ['Published by', publication ? publication.actorUserId : null, 'km-mono'],
        ['Published at', publication ? when(publication.publishedAt) : null],
      ]));
      if (version.reviewRequirement === 'attorney_gated') {
        var warning = node('div', 'km-warning');
        append(warning, node('strong', '', 'External attorney evidence required. '), node('span', '',
          'NorthStar records a bounded reference, review time, and digest. It does not manufacture approval, store the legal document here, or make a legal conclusion.'));
        published.appendChild(warning);
      }
      var content = node('section', 'km-section');
      var pre = node('pre', 'km-document', JSON.stringify(version.document && version.document.content || {}, null, 2));
      pre.setAttribute('aria-label', 'Canonical knowledge content');
      append(content, node('h4', '', 'Readable canonical content'), pre);
      var applicability = node('section', 'km-section');
      append(applicability, node('h4', '', 'Applicability'), node('pre', 'km-document', JSON.stringify(version.applicability || {}, null, 2)));
      var source = node('section', 'km-section');
      append(source, node('h4', '', 'Source correction'));
      var sourceText = node('p', '', 'Generated and authoritative facts are corrected at their source, then regenerated as a new immutable version.');
      var link = node('a', 'km-correction-link', detail.sourceCorrection.label);
      link.href = correctionUrl(detail.sourceCorrection.url);
      append(source, sourceText, link);
      append(panel, summary, published, content, applicability, source);
      renderActions(panel, detail);
    }

    function renderProvenance(panel, detail) {
      var section = node('section', 'km-section');
      append(section, node('h4', '', 'Pinned provenance and source digests'));
      var list = node('ol', 'km-provenance-list');
      detail.version.provenance.forEach(function (source) {
        var item = node('li', 'km-record');
        if (source.restricted) {
          append(item,
            node('p', 'km-record-title', source.ordinal + '. ' + titleCase(source.sourceType)),
            node('div', 'km-readonly-note', 'This source pin points to restricted knowledge. Its record identifier, version, digest, and JSON pointer are unavailable to this role.')
          );
          list.appendChild(item);
          return;
        }
        append(item,
          node('p', 'km-record-title', source.ordinal + '. ' + titleCase(source.sourceType)),
          node('p', '', 'Record '),
          definition([
            ['Immutable source ID', source.sourceRecordId, 'km-mono'],
            ['Source version', source.sourceVersion, 'km-mono'],
            ['Source digest', source.sourceDigest, 'km-mono'],
            ['JSON pointer', source.jsonPointer || 'Document root', 'km-mono'],
          ])
        );
        list.appendChild(item);
      });
      if (!detail.version.provenance.length) list.appendChild(node('li', 'km-error', 'Required provenance is unavailable.'));
      append(section, list);
      panel.appendChild(section);
    }

    function renderDiff(panel, detail) {
      var section = node('section', 'km-section');
      append(section, node('h4', '', 'Deterministic comparison with current publication'));
      var comparison = detail.comparison || {};
      if (comparison.restricted) {
        append(section, node('div', 'km-readonly-note', comparison.unavailableReason || 'The current publication is restricted for this role. Comparison bytes are unavailable.'));
        append(section, definition([
          ['Base version ID', 'Restricted'],
          ['Diff digest', 'Restricted'],
          ['Result', 'Comparison is unavailable because revealing it could disclose protected knowledge.'],
        ]));
        panel.appendChild(section);
        return;
      }
      append(section, definition([
        ['Base version ID', comparison.baseVersionId || 'No prior publication', 'km-mono'],
        ['Diff digest', comparison.diffDigest, 'km-mono'],
        ['Result', comparison.unchangedFromPublished ? 'This exact version is the current publication.' : 'Exact deterministic changes shown below.'],
      ]));
      var operations = comparison.document && comparison.document.operations || [];
      var list = node('ol', 'km-diff-list');
      operations.forEach(function (operation) {
        var item = node('li', 'km-record');
        append(item, node('p', 'km-record-title', String(operation.op || '').toUpperCase() + ' ' + (operation.path || 'document root')));
        if (Object.prototype.hasOwnProperty.call(operation, 'value')) {
          item.appendChild(node('pre', 'km-diff-value', JSON.stringify(operation.value, null, 2)));
        }
        list.appendChild(item);
      });
      if (!operations.length) list.appendChild(node('li', 'km-empty', 'No changes from this exact version to the current publication.'));
      append(section, list);
      panel.appendChild(section);
    }

    function renderHistory(panel, detail) {
      var section = node('section', 'km-section');
      append(section, node('h4', '', 'Immutable lifecycle history'));
      if (!detail.permissions.canReadHistory || !Array.isArray(detail.history)) {
        append(section, node('div', 'km-readonly-note', 'Lifecycle history is restricted to an active owner or administrator. Prior bytes are never mutated or erased.'));
        panel.appendChild(section);
        return;
      }
      var list = node('ol', 'km-history-list');
      detail.history.slice().reverse().forEach(function (version) {
        var item = node('li', 'km-record');
        var head = node('p', 'km-record-title', 'Version ' + version.versionNumber + ' · ' + titleCase(version.lifecycleAction));
        var open = node('button', 'km-action km-action-secondary', 'View exact version ' + version.versionNumber);
        open.type = 'button';
        open.addEventListener('click', function () { selectItem(detail.entry.id, version.versionNumber, true); });
        append(item, head, definition([
          ['Version ID', version.versionId, 'km-mono'], ['Digest', version.canonicalDigest, 'km-mono'],
          ['Parent', version.parentVersionId, 'km-mono'], ['Rollback target', version.rollbackTargetVersionId, 'km-mono'],
          ['Actor', version.actorUserId, 'km-mono'], ['Created', when(version.createdAt)],
          ['Reason', version.reason], ['Publication', version.publicationNumber ? '#' + version.publicationNumber : 'Never published'],
        ]), open);
        list.appendChild(item);
      });
      append(section, list);
      panel.appendChild(section);
    }

    function renderSync(panel, detail) {
      var section = node('section', 'km-section');
      append(section, node('h4', '', 'Connected AI and voice synchronization truth'));
      if (!detail.synchronization.length) {
        append(section, node('div', 'km-empty', 'No configured provider-neutral target currently includes this publication. No live provider connection is claimed.'));
        panel.appendChild(section);
        return;
      }
      var list = node('ul', 'km-sync-list');
      detail.synchronization.forEach(function (target) {
        var item = node('li', 'km-record');
        var title = node('p', 'km-record-title', titleCase(target.consumer) + ' · ' + target.providerKey);
        var badges = node('div', 'km-badges');
        append(badges, badge(target.status), node('span', 'km-badge', titleCase(target.targetStatus)));
        append(item, title, badges, definition([
          ['Target ID', target.targetId, 'km-mono'], ['Audience', titleCase(target.audience)],
          ['Target revision', target.targetRevision], ['Configuration digest', target.configurationDigest, 'km-mono'],
          ['Desired digest', target.desired && target.desired.projectionDigest, 'km-mono'],
          ['Observed digest', target.observed && target.observed.projectionDigest, 'km-mono'],
          ['Last known good', target.lastKnownGood && target.lastKnownGood.projectionDigest, 'km-mono'],
          ['Diagnostic', target.diagnosticCategory || 'None'], ['Updated', when(target.updatedAt)],
        ]));
        if (detail.permissions.canMutate && target.targetStatus === 'active' &&
            ['dead', 'drifted', 'stale', 'retrying', 'reconciliation_needed'].includes(target.status)) {
          var actionName = ['dead', 'retrying'].includes(target.status) ? 'retry' : 'reconcile';
          var action = node('button', 'km-action km-action-secondary', actionName === 'retry' ? 'Retry exact target' : 'Reconcile exact target');
          action.type = 'button';
          action.addEventListener('click', function () { openSyncDialog(target, actionName, action); });
          item.appendChild(action);
        } else if (target.targetStatus === 'suspended') {
          item.appendChild(node('p', 'km-action-explanation', 'Suspended targets cannot transport or reconcile until separately reconfigured through canonical target authority.'));
        }
        list.appendChild(item);
      });
      append(section, list);
      panel.appendChild(section);
    }

    function setupTabs(container, tabs, panels) {
      tabs.forEach(function (tab, index) {
        tab.addEventListener('click', function () { activate(index); });
        tab.addEventListener('keydown', function (event) {
          var next = null;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = tabs.length - 1;
          if (next !== null) { event.preventDefault(); activate(next); tabs[next].focus(); }
        });
      });
      function activate(active) {
        tabs.forEach(function (tab, index) {
          tab.setAttribute('aria-selected', index === active ? 'true' : 'false');
          tab.tabIndex = index === active ? 0 : -1;
          panels[index].hidden = index !== active;
        });
      }
      activate(0);
      container.append.apply(container, tabs);
    }

    function renderDetail() {
      var detail = state.detail;
      if (!detail) return;
      var renderedTarget = captureDetailTarget(detail);
      state.renderedTargetKey = detailTargetKey(renderedTarget);
      detailRoot.dataset.targetKey = state.renderedTargetKey;
      var fragment = document.createDocumentFragment();
      var header = node('header', 'km-detail-header');
      var heading = node('h3', '', detail.version.label);
      heading.tabIndex = -1;
      var badges = node('div', 'km-badges');
      append(badges, badge(detail.workflow.status), node('span', 'km-badge', titleCase(detail.version.sensitivity)), node('span', 'km-badge', 'Version ' + detail.version.number));
      append(header, heading, badges);
      if (!detail.permissions.canMutate) {
        var readOnlyExplanation = detail.permissions.mutationRestriction === 'subscription_read_only'
          ? 'Read-only subscription: knowledge remains visible, but review, approval, publication, lifecycle, and reconciliation actions require current subscription access.'
          : 'Read-only membership: review, approval, publication, lifecycle, and reconciliation actions require an active owner or administrator.';
        header.appendChild(node('div', 'km-readonly-note', readOnlyExplanation));
      }
      if (!state.detailDisclosed) {
        var presentation = node('section', 'km-section km-presentation-summary');
        append(presentation,
          node('h4', '', 'Knowledge summary'),
          node('p', 'km-action-explanation',
            'Choose this knowledge item to inspect its exact version, provenance, lifecycle, and synchronization details.'),
          node('p', '', 'Generated and authoritative facts are corrected at their source, then regenerated as a new immutable version.')
        );
        var correctionLink = node('a', 'km-correction-link', detail.sourceCorrection.label);
        correctionLink.href = correctionUrl(detail.sourceCorrection.url);
        presentation.appendChild(correctionLink);
        append(fragment, header, presentation);
        detailRoot.replaceChildren(fragment);
        return;
      }
      var tablist = node('div', 'km-tabs');
      tablist.setAttribute('role', 'tablist');
      tablist.setAttribute('aria-label', 'Knowledge detail sections');
      var names = ['Overview', 'Changes & provenance', 'Lifecycle history', 'Synchronization'];
      var tabs = [];
      var panels = [];
      names.forEach(function (name, index) {
        var tab = node('button', 'km-tab', name);
        var tabId = 'km-' + instance + '-tab-' + index;
        var panelId = 'km-' + instance + '-panel-' + index;
        tab.type = 'button'; tab.id = tabId; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panelId);
        var panel = node('div', 'km-tabpanel');
        panel.id = panelId; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tabId); panel.tabIndex = 0;
        tabs.push(tab); panels.push(panel);
      });
      setupTabs(tablist, tabs, panels);
      renderOverview(panels[0], detail);
      renderDiff(panels[1], detail); renderProvenance(panels[1], detail);
      renderHistory(panels[2], detail);
      renderSync(panels[3], detail);
      append(fragment, header, tablist);
      panels.forEach(function (panel) { fragment.appendChild(panel); });
      detailRoot.replaceChildren(fragment);
    }

    function latestSelected(detail) {
      var item = state.data && state.data.items.find(function (candidate) { return candidate.entryId === detail.entry.id; });
      return item && item.version.number === detail.version.number && item.version.id === detail.version.id;
    }

    function assertCurrentDialogTarget(target, dialog) {
      var expected = detailTargetKey(target);
      var current = state.detail && detailTargetKey(captureDetailTarget(state.detail));
      var selected = listRoot.querySelector('.km-item-button[aria-current="true"]');
      var valid = state.selectedEntryId === target.entryId &&
        selected && selected.dataset.entryId === target.entryId &&
        current === expected && state.renderedTargetKey === expected &&
        detailRoot.dataset.targetKey === expected && dialog.dataset.targetKey === expected;
      if (valid) return;
      var error = new Error('The visible knowledge selection or exact version changed. Close this dialog and reload the exact item before continuing.');
      error.code = 'knowledge_management_dialog_target_changed';
      throw error;
    }

    function renderActions(panel, detail) {
      var actions = node('div', 'km-actions');
      if (!detail.permissions.canMutate) return panel.appendChild(actions);
      if (!latestSelected(detail)) {
        actions.appendChild(node('p', 'km-action-explanation', 'Historical versions are immutable. Return to the latest version to begin a new lifecycle action.'));
        return panel.appendChild(actions);
      }
      function action(label, name, className) {
        var button = node('button', 'km-action ' + (className || ''), label);
        button.type = 'button';
        button.addEventListener('click', function () { openActionDialog(name, button); });
        actions.appendChild(button);
      }
      var contentState = detail.version.document && detail.version.document.content && detail.version.document.content.state;
      if (detail.workflow.status === 'draft') action('Submit exact version for review', 'review');
      if (detail.workflow.status === 'review') {
        action('Approve exact version', 'approve');
        action('Request changes', 'changes', 'km-action-secondary');
      }
      if (detail.workflow.status === 'approved') {
        if (contentState === 'needs_review') {
          actions.appendChild(node('p', 'km-action-explanation', 'Publishing is disabled because authoritative evidence is unresolved. Correct the Business Profile source and regenerate.'));
        } else action('Publish exact approved version', 'publish');
      }
      if (detail.permissions.canReviseDirectly) action('Create revision', 'revise', 'km-action-secondary');
      else actions.appendChild(node('p', 'km-action-explanation', 'Direct revision is disabled for generated or authoritative-source content. Use the Business Profile correction link.'));
      if (detail.version.lifecycleAction !== 'tombstone') action('Create tombstone version', 'tombstone', 'km-action-danger');
      if (detail.history && detail.history.some(function (version) {
        return version.versionNumber < detail.version.number && version.lifecycleAction !== 'tombstone' && version.canonicalDigest !== detail.version.canonicalDigest;
      })) action('Rollback as new version', 'rollback', 'km-action-secondary');
      panel.appendChild(actions);
    }

    function dialogField(dialog, id, labelText, kind, value, help) {
      var field = node('div', 'km-dialog-field');
      var label = node('label', '', labelText); label.htmlFor = id;
      var control = node(kind === 'textarea' ? 'textarea' : kind === 'select' ? 'select' : 'input');
      control.id = id; control.name = id;
      if (kind === 'textarea') control.value = value || '';
      else if (kind !== 'select') { control.type = kind || 'text'; control.value = value || ''; }
      append(field, label, control);
      if (help) field.appendChild(node('p', 'km-action-explanation', help));
      dialog.appendChild(field);
      return control;
    }

    function createDialog(title, description, opener) {
      var dialog = node('dialog', 'km-dialog');
      var inner = node('div', 'km-dialog-inner');
      var heading = node('h2', '', title); heading.id = 'km-dialog-title-' + instance;
      dialog.setAttribute('aria-labelledby', heading.id);
      append(inner, heading, node('p', '', description));
      dialog.appendChild(inner);
      document.body.appendChild(dialog);
      dialog.addEventListener('close', function () {
        dialog.remove();
        if (opener && document.contains(opener)) opener.focus();
      }, { once: true });
      dialog.showModal();
      return { dialog: dialog, inner: inner };
    }

    function finishDialog(view, submitLabel, submitClass, work) {
      var error = node('div', 'km-error');
      error.hidden = true;
      error.tabIndex = -1;
      error.setAttribute('role', 'alert');
      var controls = node('div', 'km-dialog-actions');
      var cancel = node('button', 'km-action km-action-secondary', 'Cancel'); cancel.type = 'button';
      var submit = node('button', 'km-action ' + (submitClass || ''), submitLabel); submit.type = 'button';
      cancel.addEventListener('click', function () { view.dialog.close(); });
      submit.addEventListener('click', function () {
        error.hidden = true; submit.disabled = true; cancel.disabled = true; submit.textContent = 'Working…';
        Promise.resolve().then(work).then(function () {
          view.dialog.close();
          return loadList(true);
        }).catch(function (failure) {
          error.textContent = failure.message + (failure.code && failure.code.indexOf('stale') >= 0 ? ' Reload the exact item before retrying.' : '');
          error.hidden = false; error.focus();
          submit.disabled = false; cancel.disabled = false; submit.textContent = submitLabel;
        });
      });
      append(controls, cancel, submit); append(view.inner, error, controls);
      global.setTimeout(function () {
        var first = view.inner.querySelector('input, textarea, select, button'); if (first) first.focus();
      }, 0);
    }

    function mutation(target, name, payload) {
      return request('/api/v1/knowledge-management/items/' + encodeURIComponent(target.entryId) + '/' + name, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    }

    function workflowPayload(target, reason) {
      return {
        versionId: target.versionId,
        versionNumber: target.versionNumber,
        canonicalDigest: target.canonicalDigest,
        expectedReviewEventId: target.expectedReviewEventId,
        reason: reason,
      };
    }

    function openActionDialog(name, opener) {
      var detail = state.detail;
      var target = captureDetailTarget(detail);
      var descriptions = {
        review: ['Submit for review', 'Bind this submission to the exact immutable version and current review state.'],
        changes: ['Request changes', 'Close this exact review with an immutable changes-requested event. Correction creates a later version.'],
        approve: ['Approve exact version', 'Record the approval class required by this exact immutable version.'],
        publish: ['Publish exact approved version', 'Publication is immutable. A correction or rollback creates and reviews a new version.'],
        revise: ['Create an immutable revision', 'This action is only for human/imported knowledge. Generated facts must be corrected in Business Profile.'],
        tombstone: ['Create a tombstone version', 'The prior bytes remain immutable. This creates a new deletion-marker draft that still requires review and publication.'],
        rollback: ['Rollback as a new version', 'The selected earlier version is copied into a new immutable draft. No pointer or history is moved or erased.'],
      };
      var copy = descriptions[name];
      var view = createDialog(copy[0], copy[1], opener);
      view.dialog.dataset.targetKey = detailTargetKey(target);
      view.inner.appendChild(definition([
        ['Knowledge item', target.label],
        ['Entry ID', target.entryId, 'km-mono'],
        ['Exact version', target.versionNumber + ' · ' + target.versionId, 'km-mono'],
        ['Canonical digest', target.canonicalDigest, 'km-mono'],
      ]));
      if (['approve', 'publish', 'tombstone'].includes(name)) view.inner.appendChild(node('div', 'km-warning',
        name === 'approve' && detail.version.reviewRequirement !== 'standard'
          ? 'High-risk approval: verify the external evidence and operational consequences before continuing.'
          : 'This creates durable immutable evidence. Confirm the exact IDs and consequences before continuing.'));
      var reason = dialogField(view.inner, 'km-dialog-reason-' + instance, 'Reason', 'textarea', '', 'Required, 1–500 characters. Stored with the acting individual and database timestamp.');
      var attorney = null;
      if (name === 'approve' && detail.version.reviewRequirement === 'attorney_gated') {
        view.inner.appendChild(node('div', 'km-warning', 'Do not claim legal approval that did not occur. Record only genuine external attorney-review evidence. NorthStar does not make the legal conclusion.'));
        attorney = {
          reviewReference: dialogField(view.inner, 'km-attorney-reference-' + instance, 'External review reference', 'text', '', 'A bounded reference only; do not paste the legal document.'),
          reviewedAt: dialogField(view.inner, 'km-attorney-time-' + instance, 'External review time', 'datetime-local', ''),
          evidenceDigest: dialogField(view.inner, 'km-attorney-digest-' + instance, 'External evidence SHA-256 digest', 'text', ''),
        };
      }
      var rollback = null;
      if (name === 'rollback') {
        rollback = dialogField(view.inner, 'km-rollback-version-' + instance, 'Earlier exact version', 'select');
        detail.history.filter(function (version) {
          return version.versionNumber < detail.version.number && version.lifecycleAction !== 'tombstone' && version.canonicalDigest !== detail.version.canonicalDigest;
        }).forEach(function (version) {
          var option = node('option', '', 'Version ' + version.versionNumber + ' · ' + shortDigest(version.canonicalDigest));
          option.value = version.versionId; option.dataset.versionNumber = version.versionNumber; option.dataset.digest = version.canonicalDigest;
          rollback.appendChild(option);
        });
      }
      var revision = null;
      if (name === 'revise') {
        revision = {
          content: dialogField(view.inner, 'km-revision-content-' + instance, 'Revised knowledge content (JSON)', 'textarea', JSON.stringify(detail.version.document.content, null, 2)),
          sourceRecordId: dialogField(view.inner, 'km-revision-source-' + instance, 'Human source record ID', 'text', '', 'Immutable reference to the actual human/input record; do not invent a source.'),
          sourceVersion: dialogField(view.inner, 'km-revision-source-version-' + instance, 'Human source version', 'text', ''),
          sourceDigest: dialogField(view.inner, 'km-revision-source-digest-' + instance, 'Human source SHA-256 digest', 'text', ''),
        };
      }
      finishDialog(view, copy[0], ['publish', 'tombstone'].includes(name) ? 'km-action-danger' : '', function () {
        assertCurrentDialogTarget(target, view.dialog);
        var reasonValue = reason.value.trim();
        if (!reasonValue) throw new Error('A reason is required.');
        if (['review', 'changes', 'approve', 'publish'].includes(name)) {
          var payload = workflowPayload(target, reasonValue);
          if (name === 'approve' && attorney) {
            if (!attorney.reviewReference.value.trim() || !attorney.reviewedAt.value || !attorney.evidenceDigest.value.trim()) {
              throw new Error('Genuine external attorney-review reference, time, and digest are required.');
            }
            payload.attorneyReview = {
              reviewReference: attorney.reviewReference.value.trim(),
              reviewedAt: new Date(attorney.reviewedAt.value).toISOString(),
              evidenceDigest: attorney.evidenceDigest.value.trim(),
            };
          }
          if (name === 'publish') {
            payload.expectedPublicationId = target.expectedPublicationId;
            payload.expectedPublicationNumber = target.expectedPublicationNumber;
          }
          return mutation(target, name, payload);
        }
        var lifecycle = {
          expectedVersionId: target.versionId,
          expectedVersionNumber: target.versionNumber,
          expectedCanonicalDigest: target.canonicalDigest,
          reason: reasonValue,
        };
        if (name === 'tombstone') return mutation(target, name, lifecycle);
        if (name === 'rollback') {
          var selected = rollback.options[rollback.selectedIndex];
          var capturedRollback = target.history.find(function (version) { return version.versionId === selected.value; });
          if (!capturedRollback || capturedRollback.versionNumber !== Number(selected.dataset.versionNumber) ||
              capturedRollback.canonicalDigest !== selected.dataset.digest) {
            var rollbackError = new Error('The rollback target changed. Close this dialog and reload the exact item before continuing.');
            rollbackError.code = 'knowledge_management_dialog_target_changed';
            throw rollbackError;
          }
          lifecycle.rollbackVersionId = selected.value;
          lifecycle.rollbackVersionNumber = Number(selected.dataset.versionNumber);
          lifecycle.rollbackCanonicalDigest = selected.dataset.digest;
          return mutation(target, name, lifecycle);
        }
        if (name === 'revise') {
          var content;
          try { content = JSON.parse(revision.content.value); } catch (_error) { throw new Error('Revision content must be valid JSON.'); }
          return mutation(target, name, Object.assign(lifecycle, {
            canonicalKey: target.canonicalKey,
            entryType: target.category,
            label: target.label,
            sensitivity: target.sensitivity,
            reviewRequirement: target.reviewRequirement,
            applicability: target.applicability,
            content: content,
            provenance: [{
              sourceType: 'human_input', sourceRecordId: revision.sourceRecordId.value.trim(),
              sourceVersion: revision.sourceVersion.value.trim(), sourceDigest: revision.sourceDigest.value.trim(), jsonPointer: '',
            }],
            origin: 'human',
          }));
        }
        throw new Error('Unsupported knowledge action.');
      });
    }

    function openSyncDialog(target, name, opener) {
      var detailTarget = captureDetailTarget(state.detail);
      var syncTarget = Object.freeze({
        targetId: target.targetId,
        targetRevision: target.targetRevision,
        configurationDigest: target.configurationDigest,
        status: target.status,
      });
      var view = createDialog(name === 'retry' ? 'Retry exact synchronization target' : 'Reconcile exact synchronization target',
        'This queues provider-neutral outbound repair for the exact target revision and configuration digest. It does not call a provider now or claim a live connection.', opener);
      view.dialog.dataset.targetKey = detailTargetKey(detailTarget);
      view.inner.appendChild(definition([
        ['Knowledge item', detailTarget.label], ['Entry ID', detailTarget.entryId, 'km-mono'],
        ['Target ID', syncTarget.targetId, 'km-mono'], ['Target revision', syncTarget.targetRevision],
        ['Configuration digest', syncTarget.configurationDigest, 'km-mono'], ['Current state', STATUS_LABELS[syncTarget.status] || titleCase(syncTarget.status)],
      ]));
      finishDialog(view, name === 'retry' ? 'Queue retry' : 'Queue reconciliation', '', function () {
        assertCurrentDialogTarget(detailTarget, view.dialog);
        var currentTarget = state.detail.synchronization.find(function (candidate) {
          return candidate.targetId === syncTarget.targetId;
        });
        if (!currentTarget || currentTarget.targetRevision !== syncTarget.targetRevision ||
            currentTarget.configurationDigest !== syncTarget.configurationDigest) {
          var error = new Error('The synchronization target changed. Close this dialog and reload the exact item before continuing.');
          error.code = 'knowledge_management_dialog_target_changed';
          throw error;
        }
        return request('/api/v1/knowledge-management/synchronization/' + encodeURIComponent(syncTarget.targetId) + '/' + name, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedTargetRevision: syncTarget.targetRevision, expectedConfigurationDigest: syncTarget.configurationDigest }),
        });
      });
    }

    function correctionUrl(url) {
      if (global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true) {
        return String(url || '').replace('/dashboard/business-profile', '/demo/business-profile');
      }
      return url;
    }

    function renderMode() {
      var mode = root.querySelector('[data-km-mode]');
      var demo = Boolean(global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true);
      if (demo) {
        mode.hidden = false;
        mode.className = 'km-demo-note';
        mode.textContent = 'Demo preview: this isolated shared demo authority is simulated and read-only. It never crosses into authenticated tenant data or proves a live AI/voice provider connection.';
      } else if (state.data && !state.data.permissions.canMutate) {
        mode.hidden = false;
        mode.className = 'km-readonly-note';
        mode.textContent = state.data.permissions.mutationRestriction === 'subscription_read_only'
          ? 'Read-only subscription: tenant knowledge remains visible, but workflow and lifecycle actions require current subscription access.'
          : 'Read-only membership: visible standard knowledge is tenant-scoped. Protected bytes and owner/administrator workflow actions remain unavailable.';
      } else {
        mode.hidden = true;
        mode.textContent = '';
      }
    }

    function listStatusMessage(data) {
      var loaded = data.items && data.items.length || 0;
      var matching = Number(data.filteredCount || 0);
      var visible = Number(data.counts && data.counts.total || 0);
      if (data.pagination && data.pagination.hasMore) {
        return loaded + ' of ' + matching + ' matching knowledge items are loaded; ' + visible + ' are visible to this role.';
      }
      return matching + ' of ' + visible + ' visible knowledge items match the current filters. All matching items are loaded.';
    }

    function loadNextPage(button) {
      var page = state.data && state.data.pagination;
      if (!page || !page.hasMore || !page.nextCursor) return Promise.resolve(state.data);
      var requestSequence = state.listRequestSequence;
      button.disabled = true;
      button.textContent = 'Loading…';
      listRoot.setAttribute('aria-busy', 'true');
      setStatus('loading', 'Loading the next deterministic page of authorized knowledge…');
      return request('/api/v1/knowledge-management' + queryString(state.filters, {
        cursor: page.nextCursor,
        limit: page.limit,
      }), { method: 'GET', cache: 'no-store' }).then(function (next) {
        if (requestSequence !== state.listRequestSequence) return state.data;
        var known = new Set(state.data.items.map(function (item) { return item.entryId; }));
        var additions = (next.items || []).filter(function (item) { return !known.has(item.entryId); });
        state.data = Object.assign({}, next, { items: state.data.items.concat(additions) });
        renderMode(); renderCounts(); renderList();
        setStatus('ready', listStatusMessage(state.data));
        return state.data;
      }).catch(function (error) {
        if (requestSequence !== state.listRequestSequence) return state.data;
        button.disabled = false;
        button.textContent = 'Retry loading more knowledge items';
        setStatus('error', error.message + ' Previously loaded knowledge remains available.');
        throw error;
      }).finally(function () {
        if (requestSequence === state.listRequestSequence) listRoot.removeAttribute('aria-busy');
      });
    }

    function loadList(preserveSelection) {
      var requestSequence = state.listRequestSequence + 1;
      state.listRequestSequence = requestSequence;
      state.detailRequestSequence += 1;
      setStatus('loading', 'Loading canonical tenant knowledge. Controls remain read-only until authority resolves…');
      listRoot.setAttribute('aria-busy', 'true');
      if (!preserveSelection) state.selectedEntryId = null;
      return request('/api/v1/knowledge-management' + queryString(state.filters), { method: 'GET', cache: 'no-store' })
        .then(function (data) {
          if (requestSequence !== state.listRequestSequence) return state.data;
          state.data = data;
          renderMode(); renderCounts(); renderList();
          setStatus('ready', listStatusMessage(data));
          if (preserveSelection && state.selectedEntryId && data.items.some(function (item) {
            return item.entryId === state.selectedEntryId;
          })) {
            return selectItem(state.selectedEntryId, null, false).then(function () { return data; });
          }
          return data;
        }).catch(function (error) {
          if (requestSequence !== state.listRequestSequence) return state.data;
          state.data = null; state.detail = null;
          state.renderedTargetKey = null;
          delete detailRoot.dataset.targetKey;
          countRoot.replaceChildren();
          var retry = node('button', 'km-action km-action-secondary', 'Retry Knowledge Management');
          retry.type = 'button'; retry.addEventListener('click', function () { loadList(false); });
          listRoot.replaceChildren(node('li', 'km-error', error.message), node('li', '', ''));
          listRoot.lastChild.appendChild(retry);
          detailRoot.replaceChildren(node('div', 'km-empty', 'Canonical knowledge detail is unavailable while the list authority is unavailable.'));
          setStatus('error', error.message);
          throw error;
        }).finally(function () {
          if (requestSequence === state.listRequestSequence) listRoot.removeAttribute('aria-busy');
        });
    }

    buildFilters();
    global.NorthStarAccountSession.load().then(function (account) {
      state.account = account;
      return loadList(false);
    }).catch(function () {
      // The durable error/read-only state is already visible.
    });
  }

  mounts.forEach(function (root, index) { createController(root, index + 1); });
})(window);
