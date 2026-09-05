(function (global) {
  'use strict';
  var catalogue = null; var serial = 0; var activeDialog = null;
  // A bounded presentation shortcut, never an identity/category/capability
  // decision. Unrecognized prose stays on the ordinary Polaris path; every
  // accepted shortcut still requires the same server draft and confirmation.
  function isEquipmentRequest(message) {
    if (typeof message !== 'string' || message.length > 1500 || /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(message)) return false;
    var text = message.trim();
    var subject = /^add +(?:(?:a|an|my|our|the) +)?(?:exact +)?(?:equipment|vehicle|machinery|truck|trailer|tractor|excavator|loader|mower|snowplow)(?:[.!?]?| +(?:for|that|with) +.+)$/i;
    var namedExample = /^add +(?:(?:a|an|my|our|the) +)?(?:(?:19|20)[0-9]{2} +)?ford +f[- ]350(?:[.!?]?| +(?:for|that|with) +.+)$/i;
    return subject.test(text) || namedExample.test(text);
  }
  var labels = { manufacturer: 'Manufacturer', model: 'Exact model', modelYear: 'Model year', series: 'Series / trim', engine: 'Engine / power', configuration: 'Configuration', attachments: 'Your attachments', accessType: 'Access type', useContext: 'Your intended use' };
  function node(tag, className, text) { var value = document.createElement(tag); if (className) value.className = className; if (text !== undefined) value.textContent = text; return value; }
  function button(label, action, primary) { var value = node('button', 'equipment-button' + (primary ? ' equipment-button-primary' : ''), label); value.type = 'button'; value.addEventListener('click', function () { value.focus(); action(); }); return value; }
  function key() { return global.crypto.randomUUID(); }
  async function request(url, body, idempotency) {
    if (!global.NorthStarAccountSession) throw new Error('Account authority is unavailable. Reload this page.');
    var options = body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency }, body: JSON.stringify(body) } : {};
    var response = await global.NorthStarAccountSession.fetch(url, options);
    var result = await response.json();
    if (!response.ok || !result.success) { var failure = new Error(response.status === 409 ? 'This draft, asset, or research changed. Reload and review again.' : response.status === 403 ? 'Your current account cannot perform this equipment action.' : response.status === 400 ? 'This value was not accepted. Check the requested identifier; enter unknown when it cannot be verified.' : 'Equipment authority is unavailable. No save is confirmed.'); failure.status = response.status; throw failure; }
    return result.data;
  }
  function pairs(values) {
    var list = node('dl', 'equipment-review');
    Object.keys(labels).forEach(function (field) { if (values && values[field]) { list.append(node('dt', '', labels[field]), node('dd', '', values[field])); } });
    return list;
  }
  function sourceSummary(research) {
    var box = node('div', 'equipment-state');
    box.append(node('p', '', research && research.state === 'reviewed' ? 'Exact configuration matched to reviewed, cited research.' : 'Needs review — specifications and capabilities are not established.'));
    if (research && research.state !== 'reviewed') box.append(node('p', '', ({ stale: 'The reviewed sources are out of date.', conflict: 'The reviewed sources conflict.', revoked: 'This research version has been withdrawn.', low_confidence: 'The available research has low confidence.', attachment_configuration_unreviewed: 'This attachment configuration has not been reviewed.', missing_or_configuration_different: 'No reviewed version matches the exact configuration.' })[research.reason] || 'An exact NorthStar-reviewed version is required.'));
    if (research && research.sources) {
      box.append(node('p', '', 'Research confidence: ' + research.confidence + '. Fresh through ' + String(research.freshUntil).slice(0, 10) + '.'));
      var list = node('ul');
      research.sources.forEach(function (source) {
        var item = node('li'); var citation = node('a', '', source.publisher + ' — ' + source.title + ' (' + source.sourceVersion + ')');
        if (/^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\//.test(source.url)) { citation.href = source.url; citation.rel = 'noopener noreferrer'; citation.target = '_blank'; }
        item.append(citation); list.append(item);
      });
      box.append(list);
    }
    return box;
  }
  function renderCatalogue() {
    var host = document.getElementById('assetCatalogueContainer'); if (!host || !catalogue) return;
    host.className = 'equipment-catalogue'; host.replaceChildren();
    var assets = catalogue.assets || []; var search = node('input'); search.type = 'search'; search.placeholder = 'Find equipment';
    var searchLabel = node('label', '', 'Search vehicles and equipment'); searchLabel.append(search);
    var state = node('select'); [['active', 'Active'], ['archived', 'Archived'], ['all', 'All assets']].forEach(function (value) { var option = node('option', '', value[1]); option.value = value[0]; state.append(option); });
    var stateLabel = node('label', '', 'Catalogue status'); stateLabel.append(state);
    var toolbar = node('div', 'equipment-toolbar'); toolbar.append(searchLabel, stateLabel); toolbar.hidden = assets.length === 0;
    var status = node('p', 'equipment-state'); status.setAttribute('role', 'status');
    var groups = node('div'); host.append(toolbar, status, groups);
    function filter() {
      var term = search.value.toLocaleLowerCase();
      var matches = assets.filter(function (asset) { return (state.value === 'all' || asset.catalogueState === state.value) && (asset.name + ' ' + asset.manufacturer + ' ' + asset.model).toLocaleLowerCase().includes(term); });
      status.textContent = assets.length === 0 ? 'No vehicles or equipment yet. Add an exact asset to build your reviewed catalogue.' : matches.length + ' matching of ' + assets.length + ' loaded assets.' + (catalogue.truncated ? ' The catalogue is incomplete because its display limit was reached.' : '');
      groups.replaceChildren(); var grouped = new Map();
      matches.forEach(function (asset) { var category = asset.categoryLabel || 'Needs review'; if (!grouped.has(category)) grouped.set(category, []); grouped.get(category).push(asset); });
      grouped.forEach(function (items, category) {
        var disclosure = node('details', 'equipment-group');
        disclosure.append(node('summary', '', category + ' (' + items.length + ')'));
        var content = node('div', 'equipment-group-content');
        items.forEach(function (asset) {
          var card = node('article', 'equipment-item'); card.dataset.assetId = asset.id;
          card.append(node('h4', '', asset.name), node('p', '', asset.catalogueState === 'archived' ? 'Archived' : asset.reviewState === 'reviewed' ? 'Reviewed identity' : 'Needs review'),
            node('p', '', 'Operational availability: ' + ({ unknown: 'Unknown', in_use: 'Recorded in use', recorded_unavailable: 'Recorded downtime', needs_review: 'Needs review' }[asset.availability] || 'Unknown')),
            pairs(asset.privateConfiguration || {}), sourceSummary(asset.research));
          if (catalogue.canManage && asset.catalogueState === 'active') card.append(button('Review identity and research', function () {
            open({ entryPath: 'business_profile', message: asset.name, target: { assetId: asset.id, version: asset.version, digest: asset.assetDigest } });
          }));
          if (catalogue.canManage && global.NorthStarAssetCatalogue && global.NorthStarAssetCatalogue.identityEditor) {
            var editor = global.NorthStarAssetCatalogue.identityEditor(asset.id);
            if (editor) { var edit = node('details'); edit.append(node('summary', '', 'Edit catalogue identity'), node('p', '', 'Changing identity makes the existing research pin require review. Operational use remains unavailable until reviewed again.'), editor); card.append(edit); }
          }
          content.append(card);
        });
        disclosure.append(content); groups.append(disclosure);
      });
    }
    search.addEventListener('input', filter); state.addEventListener('change', filter); filter();
  }
  async function loadCatalogue() {
    var requestSerial = ++serial; var host = document.getElementById('assetCatalogueContainer'); var add = document.getElementById('addAssetButton');
    document.documentElement.dataset.assetCatalogueState = 'loading';
    if (add) add.hidden = true;
    if (host) host.replaceChildren(node('p', 'equipment-state', 'Loading vehicles and equipment…'));
    try {
      var result = await request('/api/equipment/catalogue'); if (requestSerial !== serial) return null;
      catalogue = result;
      if (global.NorthStarAssetCatalogue && global.NorthStarAssetCatalogue.loadIdentityContext) await global.NorthStarAssetCatalogue.loadIdentityContext();
      if (requestSerial !== serial) return null;
      renderCatalogue(); if (add) { add.textContent = 'Add equipment'; add.hidden = !result.canManage; }
      var authority = document.getElementById('assetCatalogueAuthority');
      if (authority) authority.textContent = 'Your tenant-private catalogue. Reviewed research is separate from actual condition, access, attachments, and use.';
      document.documentElement.dataset.assetCatalogueState = 'ready'; return result;
    } catch (_) {
      if (requestSerial !== serial) return null;
      document.documentElement.dataset.assetCatalogueState = 'error';
      if (host) host.replaceChildren(node('p', 'equipment-state', 'Vehicles and equipment could not be loaded. Saved records are not shown as empty.'), button('Retry loading', loadCatalogue));
      return null;
    }
  }
  function open(options) {
    if (activeDialog) { activeDialog.focus(); return; }
    options = options || {}; var opener = options.opener || document.activeElement; var draft = null; var pending = false; var lastRequest = null; var suggestions = {};
    var dialog = node('dialog', 'equipment-dialog'); activeDialog = dialog; dialog.setAttribute('aria-labelledby', 'equipmentDialogTitle');
    var title = node('h2', '', 'Add equipment'); title.id = 'equipmentDialogTitle';
    var status = node('p', 'equipment-state'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var content = node('div'); var actions = node('div', 'equipment-actions');
    dialog.append(title, status, content, actions); document.body.append(dialog);
    function close() { if (pending) return; dialog.close(); }
    dialog.addEventListener('cancel', function (event) { if (pending) event.preventDefault(); });
    dialog.addEventListener('close', function () { activeDialog = null; dialog.remove(); if (opener && opener.isConnected) opener.focus(); });
    async function send(url, body, requestKey) {
      if (pending) return; pending = true; lastRequest = { url: url, body: body, key: requestKey || key() };
      status.textContent = body.action === 'confirm' ? 'Saving the exact reviewed draft…' : 'Preparing the draft and checking reviewed research…';
      dialog.setAttribute('aria-busy', 'true'); Array.from(dialog.querySelectorAll('button,input,textarea,select')).forEach(function (control) { control.disabled = true; });
      try {
        draft = await request(url, body, lastRequest.key); suggestions = Object.assign(suggestions, draft.suggestedIdentifiers || {}); lastRequest = null;
        pending = false; render();
        if (draft.document.state === 'saved') { global.dispatchEvent(new CustomEvent('northstar:equipment-saved')); if (document.getElementById('assetCatalogueContainer')) await loadCatalogue(); }
      } catch (failure) {
        pending = false; status.textContent = failure.message;
        if (failure.status === 400) { lastRequest = null; actions.replaceChildren(button('Correct this answer', render, true), button('Close', close)); }
        else if (failure.status === 409) { lastRequest = null; actions.replaceChildren(button('Close and start a new review', close)); }
        else actions.replaceChildren(button('Retry the same request', function () { send(lastRequest.url, lastRequest.body, lastRequest.key); }, true), button('Close', close));
      } finally { pending = false; dialog.removeAttribute('aria-busy'); }
    }
    function action(kind, extra) { send('/api/equipment/drafts/' + encodeURIComponent(draft.id) + '/actions', Object.assign({ action: kind, expectedRevision: draft.revision, expectedDigest: draft.digest }, extra || {})); }
    function render() {
      content.replaceChildren(); actions.replaceChildren();
      if (!draft) {
        status.textContent = 'Start with the identifiers you know and how you use it. Nothing enters your asset catalogue until you review and confirm.';
        var form = node('form'); var message = node('textarea'); message.maxLength = 1500; message.value = options.message || ''; message.required = true;
        var label = node('label', '', options.entryPath === 'polaris' ? 'Tell Polaris what you want to add' : 'Equipment identifiers and intended use');
        label.append(message); form.append(label);
        var submit = node('button', 'equipment-button equipment-button-primary', 'Prepare reviewed draft'); submit.type = 'submit'; form.append(submit);
        form.addEventListener('submit', function (event) {
          event.preventDefault(); if (!form.reportValidity()) return;
          var input = { entryPath: options.entryPath || 'business_profile', message: message.value.trim().normalize('NFC'), identifiers: {}, useContext: '' };
          if (options.target) input.target = options.target;
          send('/api/equipment/drafts', input);
        });
        content.append(form); actions.append(button('Cancel', close)); message.focus(); return;
      }
      var doc = draft.document;
      if (doc.state === 'saved') { status.textContent = 'Equipment saved to your catalogue.'; content.append(pairs(doc.identifiers), sourceSummary(doc.research)); actions.append(button('Done', close, true)); actions.firstChild.focus(); return; }
      if (doc.state === 'cancelled') { status.textContent = 'Draft cancelled. No asset was saved.'; actions.append(button('Close', close)); return; }
      if (doc.state === 'clarifying' && draft.question) {
        status.textContent = 'One clarification at a time. Unknown details remain unknown.';
        var answerForm = node('form'); var answer = node('input'); answer.required = true;
        answer.maxLength = ['configuration', 'attachments'].includes(draft.question.field) ? 500 : 120;
        if (draft.question.field === 'modelYear') answer.pattern = '(18|19|20|21|22|23|24|25|26|27|28|29|30)[0-9]{2}|unknown';
        if (draft.question.field === 'accessType') answer.pattern = 'owned|leased|rented|borrowed|unknown';
        answer.value = suggestions[draft.question.field] || '';
        var question = node('label', '', draft.question.question); question.append(answer); answerForm.append(question);
        var next = node('button', 'equipment-button equipment-button-primary', 'Continue'); next.type = 'submit'; answerForm.append(next);
        answerForm.addEventListener('submit', function (event) { event.preventDefault(); if (answerForm.reportValidity()) action('answer', { answer: answer.value.trim().normalize('NFC') }); });
        content.append(answerForm); actions.append(button('Cancel draft', function () { action('cancel'); })); answer.focus(); return;
      }
      status.textContent = 'Review this exact asset before saving. Research does not establish ownership, availability, qualification, or safety.';
      content.append(pairs(doc.identifiers), sourceSummary(doc.research));
      if (doc.message) content.append(node('p', '', 'Your original request: ' + doc.message));
      if (!draft.canConfirm) { content.append(node('p', '', 'The manufacturer and exact model are still unknown or generic. This remains an unsaved draft; restart when those identifiers can be verified.')); actions.append(button('Cancel draft', function () { action('cancel'); })); return; }
      if (doc.research.state !== 'reviewed') content.append(node('p', '', 'You may save this identity as needs review. Operational equipment use remains unavailable until exact reviewed research exists.'));
      actions.append(button('Confirm and save equipment', function () { action('confirm', { confirmation: 'save_reviewed_asset' }); }, true), button('Cancel draft', function () { action('cancel'); }));
      actions.firstChild.focus();
    }
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    dialog.showModal(); render();
  }
  global.NorthStarEquipment = Object.freeze({ open: open, loadCatalogue: loadCatalogue, isEquipmentRequest: isEquipmentRequest });
})(window);
