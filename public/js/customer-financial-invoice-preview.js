(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarCustomerFinancialInvoicePreview = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var mountGeneration = 0;
  function node(tag, text, parent, className) {
    var value = document.createElement(tag); if (text !== undefined) value.textContent = text;
    if (parent) parent.appendChild(value); if (className) value.className = className; return value;
  }
  function request(url) {
    var fetcher = window.NorthStarAccountSession && window.NorthStarAccountSession.fetch || window.fetch;
    return fetcher.call(window.NorthStarAccountSession || window, url, { cache: 'no-store',
      headers: { Accept: 'application/json' } }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || !body.success) throw { status: response.status,
          message: body.error && body.error.message };
        return body.data;
      });
    });
  }
  function money(value) {
    if (!value || value.currency !== 'USD' || value.minorUnitExponent !== 2 ||
        !/^-?(0|[1-9][0-9]{0,15})$/.test(value.minorUnits || '') ||
        !/^-?(0|[1-9][0-9]{0,15})\.[0-9]{2}$/.test(value.decimal || '')) return 'Unavailable';
    var parts = value.decimal.split('.'), negative = parts[0][0] === '-', whole = negative ? parts[0].slice(1) : parts[0];
    return (negative ? '−$' : '$') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }
  function injectStyles() {
    if (document.getElementById('customerFinancialInvoicePreviewStyles')) return;
    var style = node('style'); style.id = 'customerFinancialInvoicePreviewStyles';
    style.textContent = '.invoice-draft-preview{margin-top:1rem;border:1px solid var(--border-color,#d6d7db);border-radius:14px;background:var(--surface,#fff);color:inherit}.invoice-draft-preview>summary{padding:1rem;font-weight:700;cursor:pointer}.invoice-draft-preview-body{padding:0 1rem 1rem}.invoice-draft-preview-status:focus,.invoice-draft-preview-heading:focus,.invoice-draft-preview button:focus{outline:3px solid var(--focus-ring,#d0a847);outline-offset:3px}.invoice-draft-preview-document{border:1px solid var(--border-color,#d6d7db);border-radius:12px;padding:1rem;background:var(--surface-subtle,#f7f5ef)}.invoice-draft-preview-demo{display:inline-block;padding:.25rem .55rem;border-radius:999px;background:#f3d57b;color:#241b00;font-weight:750}.invoice-draft-preview-lines{width:100%;border-collapse:collapse;margin:.75rem 0}.invoice-draft-preview-lines th,.invoice-draft-preview-lines td{padding:.55rem;text-align:left;border-bottom:1px solid var(--border-color,#d6d7db)}.invoice-draft-preview-lines th:last-child,.invoice-draft-preview-lines td:last-child{text-align:right}.invoice-draft-preview-totals{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.45rem 1rem;max-width:30rem;margin-left:auto}.invoice-draft-preview-totals dt{font-weight:650}.invoice-draft-preview-totals dd{margin:0;text-align:right}.invoice-draft-preview-boundary{padding:.75rem;border-radius:10px;background:var(--surface-subtle,#f4f1e9)}.invoice-draft-preview-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.75rem}@media(max-width:680px){.invoice-draft-preview{border-radius:10px}.invoice-draft-preview-lines thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.invoice-draft-preview-lines tr{display:grid;padding:.65rem 0;border-bottom:1px solid var(--border-color,#d6d7db)}.invoice-draft-preview-lines td{display:flex;justify-content:space-between;gap:1rem;border:0;padding:.2rem 0}.invoice-draft-preview-lines td:before{content:attr(data-label);font-weight:650}.invoice-draft-preview-actions .btn{width:100%}}@media(forced-colors:active){.invoice-draft-preview,.invoice-draft-preview-document{border:2px solid CanvasText}.invoice-draft-preview-demo{border:1px solid CanvasText}}';
    document.head.appendChild(style);
  }
  function mount(review, host) {
    if (!review || !host || !review.pins || !review.pins.estimateId) return null;
    injectStyles(); var mountToken = ++mountGeneration, requestToken = 0, data = null;
    var section = node('details', undefined, host, 'invoice-draft-preview');
    node('summary', review.simulated ? 'Review fictional invoice draft' : 'Review invoice draft', section);
    var body = node('div', undefined, section, 'invoice-draft-preview-body');
    function active(token) { return token === requestToken && mountToken === mountGeneration && section.isConnected; }
    function clearAndStatus(text, alert) {
      data = null; body.replaceChildren(); var status = node('p', text, body, 'invoice-draft-preview-status');
      status.setAttribute('role', alert ? 'alert' : 'status'); status.setAttribute('aria-live', 'polite');
      status.tabIndex = -1; status.focus(); return status;
    }
    function invalid(value) {
      return !value || value.contractVersion !== 'm27-invoice-draft-preview-v1' ||
        value.state !== 'current' || value.sourceCurrent !== true ||
        value.reconciliation?.amountDue?.state !== 'unavailable' || value.reconciliation.amountDue.value !== null ||
        value.documentPreview?.issuedDocument !== false || !Array.isArray(value.documentPreview?.lines) ||
        !/^[0-9a-f]{64}$/.test(value.previewDigest || '');
    }
    function render(value) {
      if (invalid(value)) return rejected({ status: 409,
        message: 'The exact invoice draft changed. Reload its current evidence.' });
      data = value; body.replaceChildren(); var preview = value.documentPreview, totals = value.reconciliation;
      var heading = node('h4', preview.label, body, 'invoice-draft-preview-heading');
      heading.tabIndex = -1;
      if (value.fictional) node('p', 'Fictional demo · no customer, provider, invoice, receivable, or money action', body,
        'invoice-draft-preview-demo');
      var documentCard = node('section', undefined, body, 'invoice-draft-preview-document');
      documentCard.setAttribute('aria-label', value.fictional ? 'Fictional invoice draft preview' : 'Invoice draft preview');
      var table = node('table', undefined, documentCard, 'invoice-draft-preview-lines');
      var caption = node('caption', 'Customer-safe draft lines', table); caption.className = 'sr-only';
      var head = node('thead', undefined, table), headRow = node('tr', undefined, head);
      ['Description','Group','Amount'].forEach(function (label) { node('th', label, headRow).scope = 'col'; });
      var tbody = node('tbody', undefined, table);
      preview.lines.forEach(function (line) { var row = node('tr', undefined, tbody);
        var description = node('td', line.description, row); description.dataset.label = 'Description';
        var group = node('td', line.group, row); group.dataset.label = 'Group';
        var amount = node('td', money(line.amount), row); amount.dataset.label = 'Amount'; });
      var list = node('dl', undefined, documentCard, 'invoice-draft-preview-totals');
      [['Subtotal before tax',money(totals.subtotalBeforeTax)],['Prepared tax',money(totals.preparedTax)],
        ['Prepared document total',money(totals.preparedDocumentTotal.value)],['Amount due','Unavailable']]
        .forEach(function (entry) { node('dt', entry[0], list); node('dd', entry[1], list); });
      node('p','Prepared tax is shown for review only. Professional tax policy is unavailable, so this draft cannot be approved, issued, delivered, or treated as a receivable.',body,'invoice-draft-preview-boundary');
      node('p','Amount due remains unavailable until exact native deposits, prior payments, credits, refunds, tax authority, and issue evidence are reconciled. Missing evidence is never shown as zero.',body,'invoice-draft-preview-boundary');
      node('p','PDF and immutable customer-facing document generation begin in their owning later slices. No provider or receiver was called.',body,'invoice-draft-preview-boundary');
      var actions = node('div', undefined, body, 'invoice-draft-preview-actions');
      var reload = node('button','Reload current preview',actions,'btn btn-secondary'); reload.type='button'; reload.onclick=load;
      heading.focus();
    }
    function rejected(error) {
      requestToken += 1; clearAndStatus(error && error.status === 403 ?
        'Invoice draft review requires a current owner or administrator.' : error && error.status === 404 ?
          'This invoice draft is unavailable.' : error && error.status === 409 ?
            'The invoice draft changed. Reload its exact current evidence.' :
            'Invoice draft preview is temporarily unavailable. Retry from this estimate.', true);
      var actions = node('div', undefined, body, 'invoice-draft-preview-actions');
      var retry = node('button','Retry invoice preview',actions,'btn btn-secondary'); retry.type='button'; retry.onclick=load;
    }
    function loadPaid(token) {
      var estimate = encodeURIComponent(review.pins.estimateId);
      return request('/api/v1/customer-financial/editable-estimates/'+estimate+
        '/billable-work-review?sourceClass=final_balance').then(function (billable) {
        if (!active(token)) return null;
        var receipt = billable && billable.state === 'reviewed_current' && billable.handoffReceipt;
        if (!receipt || !/^[0-9a-f-]{36}$/i.test(receipt.receiptId || '') ||
            !/^[0-9a-f]{64}$/.test(receipt.receiptDigest || '')) throw { status: 409 };
        return request('/api/v1/customer-financial/editable-estimates/'+estimate+
          '/invoice-draft/preview?handoffReceiptId='+encodeURIComponent(receipt.receiptId)+
          '&handoffReceiptDigest='+encodeURIComponent(receipt.receiptDigest));
      });
    }
    function load() {
      var token = ++requestToken; clearAndStatus('Loading the exact current invoice draft…', false);
      var promise = review.simulated ? request('/api/demo/customer-financial/invoice-drafts/'+
        encodeURIComponent(review.pins.estimateId)+'/preview') : loadPaid(token);
      return promise.then(function (value) { if (value && active(token)) render(value); })
        .catch(function (error) { if (active(token)) rejected(error); });
    }
    section.addEventListener('toggle', function () { if (section.open && !data) load(); });
    return section;
  }
  function clear() { mountGeneration += 1; }
  return { mount: mount, clear: clear, money: money };
}));
