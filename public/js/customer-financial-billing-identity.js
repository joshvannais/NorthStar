(function (global) {
  'use strict';

  var root = document.getElementById('billing-identity-journey');
  if (!root) return;

  var demo = Boolean(global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true);
  var generation = 0;
  var current = null;
  var customer = null;
  var busy = false;

  function byId(id) { return document.getElementById(id); }
  function text(id, value) { byId(id).textContent = value == null ? '' : String(value); }
  function nullable(value) {
    var candidate = String(value == null ? '' : value).trim();
    return candidate || null;
  }
  function failureMessage(payload, fallback) {
    return payload && payload.error && (payload.error.message || payload.error.category || payload.error.code) || fallback;
  }
  function idempotencyKey() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID() : 'm27-part2d-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }
  function sessionFetch(path, options) {
    if (!global.NorthStarAccountSession || typeof global.NorthStarAccountSession.fetch !== 'function') {
      return Promise.reject(new Error('The private billing review session is unavailable.'));
    }
    return global.NorthStarAccountSession.fetch(path, options || {});
  }
  function json(path, options) {
    return sessionFetch(path, options).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok || !payload || payload.success !== true || !payload.data) {
          var error = new Error(failureMessage(payload, 'Billing identity review is unavailable.'));
          error.status = response.status;
          throw error;
        }
        return payload.data;
      });
    });
  }
  function setBusy(value) {
    busy = Boolean(value);
    root.setAttribute('aria-busy', String(busy));
    byId('refreshBillingIdentity').disabled = busy;
    byId('saveBillingIdentityReview').disabled = busy;
    byId('correctBillingIdentitySource').disabled = busy || !current || !current.identity ||
      !current.identity.sourceDigest;
    byId('resetBillingIdentityDemo').disabled = busy;
  }
  function clearPrivate() {
    current = null;
    root.dataset.state = 'unavailable';
    byId('billingIdentitySummary').hidden = true;
    byId('establishBillingIdentity').disabled = true;
    byId('billingIdentityReviewForm').hidden = true;
    byId('billingIdentityCurrent').hidden = true;
    byId('billingIdentityHistory').replaceChildren();
    ['billingIdentityCustomer','billingIdentityCurrentness','billingIdentityReviewedContact',
      'billingIdentityReviewedAddress','billingIdentityReviewedPurchaseOrder',
      'billingIdentityReviewedReceipt','billingIdentityContactName','billingIdentityEmail',
      'billingIdentityPhone','billingServiceLine1','billingServiceCity','billingServiceRegion',
      'billingServicePostal','billingAddressLine1','billingAddressCity','billingAddressRegion',
      'billingAddressPostal','billingPurchaseOrder','billingCustomerReference',
      'billingIdentityReason'].forEach(function (id) {
      var control = byId(id);
      if ('value' in control) control.value = '';
      else control.textContent = '';
    });
  }
  function setStatus(message, state, detail) {
    text('billingIdentityStatus', message);
    text('billingIdentityDetail', detail || 'No private billing value is shown while current authority is unavailable.');
    root.dataset.state = state;
  }
  function stateField(value) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
      return value.state === 'source_candidate' || value.state === 'reviewed' ? value.value : null;
    }
    return value == null ? null : value;
  }
  function candidateFrom(envelope) {
    var review = envelope.review;
    var value = review && review.value || envelope.identity && envelope.identity.value || {};
    if (value.payload) return value.payload;
    if (value.contact) return value;
    return {
      contact: {
        name: stateField(value.name),
        email: stateField(value.email),
        phone: stateField(value.phone),
      },
      serviceAddress: stateField(value.serviceAddress || value.unclassifiedAddress || value.address),
      billingAddress: stateField(value.serviceAddress || value.unclassifiedAddress || value.address),
      purchaseOrderReference: null,
      customerReference: null,
    };
  }
  function address(value) {
    var source = value && typeof value === 'object' ? value : {};
    return {
      line1: String(source.line1 || ''), line2: source.line2 ? String(source.line2) : null,
      city: String(source.city || ''), region: String(source.region || source.state || '').toUpperCase(),
      postalCode: String(source.postalCode || ''), countryCode: 'US',
    };
  }
  function fillCandidate(envelope) {
    var value = candidateFrom(envelope);
    var contact = value.contact || {};
    var service = address(value.serviceAddress);
    var billing = address(value.billingAddress || value.serviceAddress);
    byId('billingIdentityContactName').value = String(contact.name || '');
    byId('billingIdentityEmail').value = String(contact.email || '');
    byId('billingIdentityPhone').value = String(contact.phone || '');
    byId('billingServiceLine1').value = service.line1;
    byId('billingServiceCity').value = service.city;
    byId('billingServiceRegion').value = service.region;
    byId('billingServicePostal').value = service.postalCode;
    byId('billingAddressLine1').value = billing.line1;
    byId('billingAddressCity').value = billing.city;
    byId('billingAddressRegion').value = billing.region;
    byId('billingAddressPostal').value = billing.postalCode;
    byId('billingPurchaseOrder').value = value.purchaseOrderReference || '';
    byId('billingCustomerReference').value = value.customerReference || '';
    byId('billingIdentityReason').value = envelope.review && envelope.review.state === 'correction_required'
      ? 'Review the corrected fictional customer source for billing use.'
      : 'Review this current customer billing identity before document use.';
  }
  function reviewedPayload(review) {
    var value = review && review.value || {};
    if (value.payload) return value.payload;
    return {
      contact: {
        name: stateField(value.billingContact && value.billingContact.name),
        email: stateField(value.billingContact && value.billingContact.email),
        phone: stateField(value.billingContact && value.billingContact.phone),
      },
      serviceAddress: stateField(value.serviceLocation && value.serviceLocation.address),
      billingAddress: stateField(value.billingAddress && value.billingAddress.address),
      purchaseOrderReference: stateField(value.references && value.references.purchaseOrder),
      customerReference: stateField(value.references && value.references.customer),
    };
  }
  function addressLabel(value) {
    var candidate = address(value);
    return [candidate.line1, candidate.city, candidate.region, candidate.postalCode]
      .filter(Boolean).join(', ');
  }
  function renderHistory(history) {
    var list = byId('billingIdentityHistory');
    list.replaceChildren();
    var revisions = history && Array.isArray(history.revisions) ? history.revisions : [];
    revisions.forEach(function (revision) {
      var item = document.createElement('li');
      item.textContent = 'Review ' + revision.sequence + ' · ' +
        new Date(revision.reviewedAt).toLocaleString() + ' · ' + revision.reason;
      list.appendChild(item);
    });
  }
  function validateEnvelope(value) {
    if (!value || value.version !== 'm27-billing-identity-journey-v1' ||
        value.mode !== (demo ? 'isolated_fictional_demo' : 'paid_tenant') ||
        value.fictional !== demo || value.invoiceMutationCount !== 0 ||
        value.paymentMutationCount !== 0 || value.providerCallCount !== 0 ||
        value.customerCreationCount !== 0 || !value.identity || value.customerId !== customer.id) {
      throw new Error('Billing identity review evidence did not match this workspace.');
    }
    return value;
  }
  function render(value) {
    current = validateEnvelope(value);
    root.dataset.state = 'ready';
    byId('billingIdentitySummary').hidden = false;
    text('billingIdentityCustomer', customer.name);
    text('billingIdentityCurrentness', current.review && current.review.state === 'reviewed_current'
      ? 'Current reviewed snapshot. Later invoice work may use only this exact review receipt.'
      : current.review && current.review.state === 'correction_required'
        ? 'The source changed. Review the corrected source before document use.'
        : 'No document use is authorized until an owner or administrator saves this review.');
    byId('billingIdentityReviewForm').hidden = true;
    byId('billingIdentityCurrent').hidden = true;
    byId('establishBillingIdentity').disabled = true;
    renderHistory(current.history);
    if (current.identity.state === 'candidate_unreviewed') {
      byId('establishBillingIdentity').disabled = false;
      setStatus('Ready to start a private billing review.', 'ready',
        'Starting review records only the exact current source snapshot. It creates no financial document or external action.');
      return;
    }
    if (current.review && ['review_required','correction_required'].indexOf(current.review.state) >= 0) {
      fillCandidate(current);
      byId('billingIdentityReviewForm').hidden = false;
      setStatus(current.review.state === 'correction_required'
        ? 'A source correction requires another human review.' : 'Billing identity is ready for human review.',
      current.review.state === 'correction_required' ? 'attention' : 'ready',
      'Review every contact, address, and reference. Saving creates an immutable review receipt only.');
      return;
    }
    if (current.review && current.review.state === 'reviewed_current') {
      var payload = reviewedPayload(current.review);
      var contact = payload.contact || {};
      byId('billingIdentityCurrent').hidden = false;
      text('billingIdentityReviewedContact', [contact.name, contact.email, contact.phone].filter(Boolean).join(' · '));
      text('billingIdentityReviewedAddress', addressLabel(payload.billingAddress));
      text('billingIdentityReviewedPurchaseOrder', payload.purchaseOrderReference || 'Not supplied');
      text('billingIdentityReviewedReceipt', 'Review ' + current.review.sequence + ' · ' + current.review.reviewId);
      setStatus('Current billing identity review is ready.', 'ready',
        'This exact receipt is current and document-use authorized. It still creates no invoice, payment, provider call, schedule, or work mutation.');
      return;
    }
    setStatus('Billing identity review is unavailable.', 'unavailable');
  }
  function chooseCustomer(workspace) {
    var graphs = workspace && Array.isArray(workspace.graphs) ? workspace.graphs.slice() : [];
    graphs.sort(function (left, right) {
      return String(right.timestamps && right.timestamps.updatedAt || '')
        .localeCompare(String(left.timestamps && left.timestamps.updatedAt || ''));
    });
    var graph = graphs.find(function (item) { return item && item.ids && item.ids.customer; });
    if (!graph) throw new Error('No current customer is available for billing review.');
    return { id: graph.ids.customer, name: graph.customer && graph.customer.name || 'Current customer' };
  }
  function loadWorkspace() {
    if (demo) return global.NorthStarDemoRuntime.loadWorkspace(false);
    return json('/api/v1/command-center/workspace').then(function (value) { return value; });
  }
  function load(focusId) {
    var token = ++generation;
    clearPrivate();
    setBusy(true);
    setStatus('Loading billing identity review…', 'loading',
      'Private values stay cleared until every current authority gate passes.');
    return loadWorkspace().then(function (workspace) {
      if (token !== generation) return null;
      customer = chooseCustomer(workspace);
      var base = demo ? '/api/demo/customer-financial/billing-identities/' :
        '/api/v1/customer-financial/billing-identities/';
      return json(base + encodeURIComponent(customer.id));
    }).then(function (value) {
      if (!value || token !== generation) return null;
      render(value);
      if (focusId) byId(focusId).focus();
      return value;
    }).catch(function (error) {
      if (token !== generation) return null;
      clearPrivate();
      setStatus(error.message || 'Billing identity review is unavailable.', 'unavailable');
      if (focusId) byId(focusId).focus();
      return null;
    }).finally(function () { if (token === generation) setBusy(false); });
  }
  function mutatePaid(path, body) {
    return json(path, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey() }, body: JSON.stringify(body) });
  }
  function mutateDemo(action, details) {
    return json('/api/demo/customer-financial/billing-identities/' + encodeURIComponent(customer.id) + '/actions', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey(), 'X-NorthStar-Demo-Intent': 'billing-identity-review' },
      body: JSON.stringify({ action: action, details: details,
        expectedRevision: current.demoWorkspaceRevision }),
    }).then(function (value) {
      return global.NorthStarDemoRuntime.loadWorkspace(true).then(function () { return value; });
    });
  }
  function mutation(task, successFocus) {
    if (busy) return;
    var token = ++generation;
    var pending;
    try { pending = task(); } catch (error) { pending = Promise.reject(error); }
    clearPrivate(); setBusy(true);
    setStatus('Saving the exact reviewed billing identity…', 'loading',
      'Private values stay cleared until the persisted receipt is read back as current.');
    pending.then(function () {
      if (token !== generation) return;
      return load(successFocus);
    }).catch(function (error) {
      if (token !== generation) return;
      clearPrivate();
      setStatus(error.message || 'The billing identity review was not saved.', 'unavailable');
      setBusy(false);
      byId('refreshBillingIdentity').focus();
    });
  }
  function reviewBody() {
    var review = current.review;
    return {
      billingPartyId: review.billingPartyId,
      originSnapshotId: current.identity.snapshotId,
      expectedSourceDigest: review.sourceDigest,
      expectedSourceUpdatedAt: review.sourceUpdatedAt,
      expectedPreviousReviewId: review.reviewId,
      expectedPreviousReviewDigest: review.reviewDigest,
      expectedPreviousSequence: review.sequence,
      payload: {
        contact: { name: byId('billingIdentityContactName').value.trim(),
          email: nullable(byId('billingIdentityEmail').value),
          phone: nullable(byId('billingIdentityPhone').value) },
        serviceAddress: address({ line1: byId('billingServiceLine1').value.trim(),
          city: byId('billingServiceCity').value.trim(), region: byId('billingServiceRegion').value.trim(),
          postalCode: byId('billingServicePostal').value.trim() }),
        billingAddress: address({ line1: byId('billingAddressLine1').value.trim(),
          city: byId('billingAddressCity').value.trim(), region: byId('billingAddressRegion').value.trim(),
          postalCode: byId('billingAddressPostal').value.trim() }),
        purchaseOrderReference: nullable(byId('billingPurchaseOrder').value),
        customerReference: nullable(byId('billingCustomerReference').value),
      },
      reason: byId('billingIdentityReason').value.trim(),
    };
  }

  text('billingIdentityMode', demo ? 'Fictional demo · account-free · no customer data or external action'
    : 'Paid tenant · private owner/admin review');
  byId('billingIdentityDemoActions').hidden = !demo;
  byId('refreshBillingIdentity').addEventListener('click', function () { load('refreshBillingIdentity'); });
  byId('establishBillingIdentity').addEventListener('click', function () {
    if (!current || !current.identity) return;
    var details = { expectedSourceDigest: current.identity.sourceDigest,
      expectedSourceUpdatedAt: current.identity.sourceUpdatedAt,
      reason: 'Begin the current billing identity review for this customer.' };
    mutation(function () { return demo ? mutateDemo('establish', details) :
      mutatePaid('/api/v1/customer-financial/billing-identities/' + encodeURIComponent(customer.id) + '/establish', details); },
    'billingIdentityContactName');
  });
  byId('billingIdentityReviewForm').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!this.reportValidity() || !current || !current.review) return;
    var body = reviewBody();
    mutation(function () { return demo ? mutateDemo('review', body) :
      mutatePaid('/api/v1/customer-financial/billing-identities/' + encodeURIComponent(customer.id) + '/reviews', body); },
    'refreshBillingIdentity');
  });
  byId('correctBillingIdentitySource').addEventListener('click', function () {
    if (!demo || !current || !current.identity) return;
    mutation(function () { return mutateDemo('correct_source', {
      expectedSourceDigest: current.identity.sourceDigest,
      reason: 'Simulate one explicit fictional customer source correction.' }); }, 'billingIdentityContactName');
  });
  byId('resetBillingIdentityDemo').addEventListener('click', function () {
    if (!demo || !current) return;
    var revision = current.demoWorkspaceRevision;
    mutation(function () {
      return json('/api/demo/command-center/reset', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(),
          'X-NorthStar-Demo-Intent': 'reset' },
        body: JSON.stringify({ expectedRevision: revision }) }).then(function (value) {
        return global.NorthStarDemoRuntime.loadWorkspace(true).then(function () { return value; });
      });
    }, 'resetBillingIdentityDemo');
  });

  load();
})(window);
