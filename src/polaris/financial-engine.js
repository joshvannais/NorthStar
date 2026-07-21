/**
 * Polaris Financial Intelligence Engine
 *
 * Manages estimates, invoices, payments, revenue tracking, profitability,
 * forecasting, and customer financial analytics across the Polaris platform.
 *
 * Ownership Boundary:
 *   - Estimate lifecycle (create, update, approve, archive, restore)
 *   - Invoice lifecycle (create, update, send, pay, refund)
 *   - Payment recording and tracking
 *   - Revenue analytics (by customer, by month)
 *   - Profitability calculations
 *   - Financial forecasting
 *   - Payment aging and collection metrics
 *
 * NOT customer management, communication history, opportunity management,
 * workflow management, learning, validation, or UI.
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence) — file-backed storage
 *   - customer-engine.js (customer context)
 *   - communications-engine.js (activity recording)
 *   - opportunity-engine.js (opportunity context)
 *   - workflow-engine.js (task creation)
 *   - engine.js (recommendations + learning)
 */

const store = require('./store');

// ── Estimate Status Constants ──
const ESTIMATE_STATUSES = Object.freeze({
  draft:    { id: 'draft',    displayName: 'Draft' },
  sent:     { id: 'sent',     displayName: 'Sent' },
  approved: { id: 'approved', displayName: 'Approved' },
  rejected: { id: 'rejected', displayName: 'Rejected' },
  archived: { id: 'archived', displayName: 'Archived' },
});

const VALID_ESTIMATE_STATUSES = new Set(Object.keys(ESTIMATE_STATUSES));

// ── Invoice Status Constants ──
const INVOICE_STATUSES = Object.freeze({
  draft:     { id: 'draft',     displayName: 'Draft' },
  sent:      { id: 'sent',      displayName: 'Sent' },
  paid:      { id: 'paid',      displayName: 'Paid' },
  overdue:   { id: 'overdue',   displayName: 'Overdue' },
  cancelled: { id: 'cancelled', displayName: 'Cancelled' },
  refunded:  { id: 'refunded',  displayName: 'Refunded' },
});

const VALID_INVOICE_STATUSES = new Set(Object.keys(INVOICE_STATUSES));

// ── Payment Method Constants ──
const PAYMENT_METHODS = Object.freeze({
  cash:       { id: 'cash',       displayName: 'Cash' },
  check:      { id: 'check',      displayName: 'Check' },
  creditCard: { id: 'creditCard', displayName: 'Credit Card' },
  debitCard:  { id: 'debitCard',  displayName: 'Debit Card' },
  bankTransfer: { id: 'bankTransfer', displayName: 'Bank Transfer' },
  online:     { id: 'online',     displayName: 'Online Payment' },
  other:      { id: 'other',      displayName: 'Other' },
});

const VALID_PAYMENT_METHODS = new Set(Object.keys(PAYMENT_METHODS));

// ── In-memory store ──
const _estimates = {};
const _invoices = {};
const _payments = {};
var _idCounter = 0;
var _invoiceNumberCounter = 1000;

function _genId() {
  _idCounter++;
  return 'fin_' + Date.now() + '_' + _idCounter;
}

function _nextInvoiceNumber() {
  _invoiceNumberCounter++;
  return 'INV-' + _invoiceNumberCounter;
}

function _now() {
  return new Date().toISOString();
}

function _today() {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Persistence ──

function _persist(type, data) {
  try {
    store.addRecommendation({
      type: 'financial',
      finType: type,
      finId: data.id,
      customerId: data.customerId || null,
      data: data,
      timestamp: data.updatedAt || data.createdAt || _now(),
    });
  } catch (e) {
    // Non-critical.
  }
}

// ── Validation ──

function _validateEstimateStatus(status) {
  if (!VALID_ESTIMATE_STATUSES.has(status)) {
    return { valid: false, error: 'Invalid estimate status: "' + status + '". Allowed: ' + Array.from(VALID_ESTIMATE_STATUSES).join(', ') };
  }
  return { valid: true };
}

function _validateInvoiceStatus(status) {
  if (!VALID_INVOICE_STATUSES.has(status)) {
    return { valid: false, error: 'Invalid invoice status: "' + status + '". Allowed: ' + Array.from(VALID_INVOICE_STATUSES).join(', ') };
  }
  return { valid: true };
}

function _validatePaymentMethod(method) {
  if (!VALID_PAYMENT_METHODS.has(method)) {
    return { valid: false, error: 'Invalid payment method: "' + method + '". Allowed: ' + Array.from(VALID_PAYMENT_METHODS).join(', ') };
  }
  return { valid: true };
}

function _calculateLineTotals(items) {
  if (!Array.isArray(items)) items = [];
  return items.map(function (item) {
    var quantity = item.quantity || 1;
    var unitPrice = item.unitPrice || 0;
    var total = Math.round(quantity * unitPrice * 100) / 100;
    return {
      description: item.description || 'Item',
      quantity: quantity,
      unitPrice: unitPrice,
      total: total,
    };
  });
}

function _calculateTotals(items, taxPercent, discount) {
  var subtotal = items.reduce(function (s, item) { return s + item.total; }, 0);
  subtotal = Math.round(subtotal * 100) / 100;
  var tax = (taxPercent || 0) > 0 ? Math.round(subtotal * (taxPercent / 100) * 100) / 100 : 0;
  var discountAmount = (discount || 0) > 0 ? Math.round(subtotal * (discount / 100) * 100) / 100 : 0;
  var total = Math.round((subtotal + tax - discountAmount) * 100) / 100;
  return { subtotal: subtotal, tax: tax, discount: discountAmount, total: total };
}

// ── Record Financial Activity ──

function _recordActivity(customerId, action, description, metadata) {
  try {
    var comms = require('./communications-engine');
    comms.recordCommunication({
      customerId: customerId || 'internal',
      type: 'internal',
      direction: 'outbound',
      subject: 'Financial: ' + action,
      content: description,
      status: 'completed',
      author: 'System',
      metadata: metadata || {},
    });
  } catch (e) {
    // Non-critical.
  }
}

// ── Init ──

/**
 * Initialize the Financial Engine — load existing financial records
 * from the Polaris store into the in-memory cache.
 *
 * @returns {object} { loaded: number }
 */
function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'financial' && r.data && r.data.id) {
        var d = r.data;
        if (r.finType === 'estimate') _estimates[d.id] = d;
        else if (r.finType === 'invoice') _invoices[d.id] = d;
        else if (r.finType === 'payment') _payments[d.id] = d;
        loaded++;
      }
    });
  } catch (e) {
    // Non-critical.
  }
  return { loaded: loaded };
}

// ── Estimate CRUD ──

/**
 * Create a new estimate.
 *
 * @param {object} data - Estimate data
 * @param {string} data.customerId - Customer ID (required)
 * @param {string} data.title - Estimate title (required)
 * @param {array} [data.items] - Line items [{description, quantity, unitPrice}]
 * @param {number} [data.taxPercent=0] - Tax percentage
 * @param {number} [data.discountPercent=0] - Discount percentage
 * @param {string} [data.opportunityId] - Related opportunity
 * @param {string} [data.status='draft'] - Estimate status
 * @param {string} [data.validUntil] - Validity date (ISO string)
 * @param {string} [data.notes] - Notes
 * @returns {object} Created estimate
 */
function createEstimate(data) {
  if (!data || !data.customerId) return { error: 'Customer ID is required' };
  if (!data || !data.title) return { error: 'Estimate title is required' };

  var status = data.status || 'draft';
  var statusCheck = _validateEstimateStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  var id = _genId();
  var now = _now();
  var items = _calculateLineTotals(data.items);
  var totals = _calculateTotals(items, data.taxPercent, data.discountPercent);

  var est = {
    id: id,
    title: data.title,
    customerId: data.customerId,
    opportunityId: data.opportunityId || null,
    items: items,
    subtotal: totals.subtotal,
    taxPercent: data.taxPercent || 0,
    tax: totals.tax,
    discountPercent: data.discountPercent || 0,
    discount: totals.discount,
    total: totals.total,
    status: status,
    statusDisplayName: ESTIMATE_STATUSES[status].displayName,
    validUntil: data.validUntil || null,
    notes: data.notes || null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  _estimates[id] = est;
  _persist('estimate', est);

  _recordActivity(data.customerId, 'Estimate Created: ' + data.title,
    'Estimate #' + id + ' created for $' + totals.total.toFixed(2),
    { estimateId: id, total: totals.total, status: status });

  return {
    id: est.id,
    title: est.title,
    customerId: est.customerId,
    total: est.total,
    subtotal: est.subtotal,
    tax: est.tax,
    discount: est.discount,
    status: est.status,
    createdAt: est.createdAt,
  };
}

/**
 * Update an estimate.
 *
 * @param {string} id - Estimate ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated estimate
 */
function updateEstimate(id, updates) {
  if (!id) return { error: 'Estimate ID is required' };
  var est = _estimates[id];
  if (!est) return { error: 'Estimate not found: ' + id };
  if (!updates) return { error: 'Updates object is required' };

  var now = _now();

  if (updates.title !== undefined) est.title = updates.title;
  if (updates.notes !== undefined) est.notes = updates.notes;
  if (updates.validUntil !== undefined) est.validUntil = updates.validUntil;
  if (updates.opportunityId !== undefined) est.opportunityId = updates.opportunityId;

  if (updates.status !== undefined) {
    var statusCheck = _validateEstimateStatus(updates.status);
    if (!statusCheck.valid) return { error: statusCheck.error };
    est.status = updates.status;
    est.statusDisplayName = ESTIMATE_STATUSES[updates.status].displayName;
    if (updates.status === 'approved') est.approvedAt = now;
  }

  if (updates.items !== undefined) {
    est.items = _calculateLineTotals(updates.items);
    var totals = _calculateTotals(est.items, updates.taxPercent !== undefined ? updates.taxPercent : est.taxPercent, updates.discountPercent !== undefined ? updates.discountPercent : est.discountPercent);
    est.subtotal = totals.subtotal;
    est.tax = totals.tax;
    est.discount = totals.discount;
    est.total = totals.total;
  }

  if (updates.taxPercent !== undefined) {
    est.taxPercent = updates.taxPercent;
    var totals2 = _calculateTotals(est.items, est.taxPercent, est.discountPercent);
    est.tax = totals2.tax;
    est.total = totals2.total;
  }

  if (updates.discountPercent !== undefined) {
    est.discountPercent = updates.discountPercent;
    var totals3 = _calculateTotals(est.items, est.taxPercent, est.discountPercent);
    est.discount = totals3.discount;
    est.total = totals3.total;
  }

  est.updatedAt = now;
  _persist('estimate', est);

  return {
    id: est.id,
    title: est.title,
    total: est.total,
    status: est.status,
    updatedAt: est.updatedAt,
  };
}

/**
 * Approve an estimate.
 *
 * @param {string} id - Estimate ID
 * @returns {object} Updated estimate
 */
function approveEstimate(id) {
  return updateEstimate(id, { status: 'approved' });
}

/**
 * Archive an estimate.
 *
 * @param {string} id - Estimate ID
 * @returns {object} { id, archived: true }
 */
function archiveEstimate(id) {
  if (!id) return { error: 'Estimate ID is required' };
  var est = _estimates[id];
  if (!est) return { error: 'Estimate not found: ' + id };
  est.status = 'archived';
  est.statusDisplayName = ESTIMATE_STATUSES.archived.displayName;
  est.updatedAt = _now();
  _persist('estimate', est);
  return { id: est.id, archived: true, updatedAt: est.updatedAt };
}

/**
 * Restore an archived estimate.
 *
 * @param {string} id - Estimate ID
 * @returns {object} Updated estimate
 */
function restoreEstimate(id) {
  if (!id) return { error: 'Estimate ID is required' };
  var est = _estimates[id];
  if (!est) return { error: 'Estimate not found: ' + id };
  if (est.status !== 'archived') return { error: 'Estimate is not archived' };

  est.status = 'draft';
  est.statusDisplayName = ESTIMATE_STATUSES.draft.displayName;
  est.updatedAt = _now();
  _persist('estimate', est);
  return { id: est.id, status: 'draft', updatedAt: est.updatedAt };
}

/**
 * Get a single estimate by ID.
 *
 * @param {string} id - Estimate ID
 * @returns {object} Estimate record
 */
function getEstimate(id) {
  if (!id) return { error: 'Estimate ID is required' };
  var est = _estimates[id];
  if (!est) return { error: 'Estimate not found: ' + id };
  return Object.assign({}, est);
}

/**
 * List estimates with optional filters.
 *
 * @param {object} [filters] - Optional filters
 * @returns {object} { estimates, total }
 */
function listEstimates(filters) {
  var results = [];
  Object.keys(_estimates).forEach(function (k) {
    var est = _estimates[k];
    if (filters) {
      if (filters.customerId && est.customerId !== filters.customerId) return;
      if (filters.status && est.status !== filters.status) return;
      if (filters.opportunityId && est.opportunityId !== filters.opportunityId) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (est.title.toLowerCase().indexOf(q) === -1) return;
      }
    }
    if (est.status === 'archived' && !filters) return;
    results.push(est);
  });
  results.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { estimates: results.map(function (e) { return Object.assign({}, e); }), total: total };
}

// ── Invoice CRUD ──

/**
 * Create a new invoice.
 *
 * @param {object} data - Invoice data
 * @param {string} data.customerId - Customer ID (required)
 * @param {string} data.title - Invoice title (required)
 * @param {array} [data.items] - Line items [{description, quantity, unitPrice}]
 * @param {number} [data.taxPercent=0] - Tax percentage
 * @param {number} [data.discountPercent=0] - Discount percentage
 * @param {string} [data.estimateId] - Related estimate
 * @param {string} [data.dueDate] - Due date (ISO string)
 * @param {string} [data.status='draft'] - Invoice status
 * @param {string} [data.notes] - Notes
 * @returns {object} Created invoice
 */
function createInvoice(data) {
  if (!data || !data.customerId) return { error: 'Customer ID is required' };
  if (!data || !data.title) return { error: 'Invoice title is required' };

  var status = data.status || 'draft';
  var statusCheck = _validateInvoiceStatus(status);
  if (!statusCheck.valid) return { error: statusCheck.error };

  var id = _genId();
  var now = _now();
  var items = _calculateLineTotals(data.items);
  var totals = _calculateTotals(items, data.taxPercent, data.discountPercent);

  var inv = {
    id: id,
    invoiceNumber: _nextInvoiceNumber(),
    title: data.title,
    customerId: data.customerId,
    estimateId: data.estimateId || null,
    items: items,
    subtotal: totals.subtotal,
    taxPercent: data.taxPercent || 0,
    tax: totals.tax,
    discountPercent: data.discountPercent || 0,
    discount: totals.discount,
    total: totals.total,
    amountPaid: 0,
    balanceDue: totals.total,
    status: status,
    statusDisplayName: INVOICE_STATUSES[status].displayName,
    dueDate: data.dueDate || null,
    paidDate: null,
    sentDate: null,
    notes: data.notes || null,
    createdAt: now,
    updatedAt: now,
  };

  _invoices[id] = inv;
  _persist('invoice', inv);

  _recordActivity(data.customerId, 'Invoice Created: ' + data.title,
    'Invoice ' + inv.invoiceNumber + ' created for $' + totals.total.toFixed(2),
    { invoiceId: id, invoiceNumber: inv.invoiceNumber, total: totals.total, status: status });

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    title: inv.title,
    customerId: inv.customerId,
    total: inv.total,
    balanceDue: inv.balanceDue,
    status: inv.status,
    dueDate: inv.dueDate,
    createdAt: inv.createdAt,
  };
}

/**
 * Update an invoice.
 *
 * @param {string} id - Invoice ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated invoice
 */
function updateInvoice(id, updates) {
  if (!id) return { error: 'Invoice ID is required' };
  var inv = _invoices[id];
  if (!inv) return { error: 'Invoice not found: ' + id };
  if (!updates) return { error: 'Updates object is required' };

  var now = _now();

  if (updates.title !== undefined) inv.title = updates.title;
  if (updates.notes !== undefined) inv.notes = updates.notes;
  if (updates.dueDate !== undefined) inv.dueDate = updates.dueDate;
  if (updates.estimateId !== undefined) inv.estimateId = updates.estimateId;

  if (updates.status !== undefined) {
    var statusCheck = _validateInvoiceStatus(updates.status);
    if (!statusCheck.valid) return { error: statusCheck.error };
    inv.status = updates.status;
    inv.statusDisplayName = INVOICE_STATUSES[updates.status].displayName;
  }

  if (updates.items !== undefined) {
    inv.items = _calculateLineTotals(updates.items);
    var totals = _calculateTotals(inv.items, updates.taxPercent !== undefined ? updates.taxPercent : inv.taxPercent, updates.discountPercent !== undefined ? updates.discountPercent : inv.discountPercent);
    inv.subtotal = totals.subtotal;
    inv.tax = totals.tax;
    inv.discount = totals.discount;
    inv.total = totals.total;
    inv.balanceDue = Math.round((inv.total - inv.amountPaid) * 100) / 100;
  }

  inv.updatedAt = now;
  _persist('invoice', inv);

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    title: inv.title,
    total: inv.total,
    balanceDue: inv.balanceDue,
    status: inv.status,
    updatedAt: inv.updatedAt,
  };
}

/**
 * Mark an invoice as sent.
 *
 * @param {string} id - Invoice ID
 * @returns {object} Updated invoice
 */
function markInvoiceSent(id) {
  if (!id) return { error: 'Invoice ID is required' };
  var inv = _invoices[id];
  if (!inv) return { error: 'Invoice not found: ' + id };

  var now = _now();
  inv.status = 'sent';
  inv.statusDisplayName = INVOICE_STATUSES.sent.displayName;
  inv.sentDate = now;
  inv.updatedAt = now;
  _persist('invoice', inv);

  _recordActivity(inv.customerId, 'Invoice Sent: ' + inv.invoiceNumber,
    'Invoice ' + inv.invoiceNumber + ' for $' + inv.total.toFixed(2) + ' sent to customer',
    { invoiceId: id, invoiceNumber: inv.invoiceNumber, total: inv.total });

  return { id: inv.id, invoiceNumber: inv.invoiceNumber, status: 'sent', sentDate: now };
}

/**
 * Get a single invoice by ID.
 *
 * @param {string} id - Invoice ID
 * @returns {object} Invoice record
 */
function getInvoice(id) {
  if (!id) return { error: 'Invoice ID is required' };
  var inv = _invoices[id];
  if (!inv) return { error: 'Invoice not found: ' + id };
  return Object.assign({}, inv);
}

/**
 * List invoices with optional filters.
 *
 * @param {object} [filters] - Optional filters
 * @returns {object} { invoices, total }
 */
function listInvoices(filters) {
  var results = [];
  Object.keys(_invoices).forEach(function (k) {
    var inv = _invoices[k];
    if (filters) {
      if (filters.customerId && inv.customerId !== filters.customerId) return;
      if (filters.status && inv.status !== filters.status) return;
      if (filters.estimateId && inv.estimateId !== filters.estimateId) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        if (inv.title.toLowerCase().indexOf(q) === -1 && inv.invoiceNumber.toLowerCase().indexOf(q) === -1) return;
      }
    }
    results.push(inv);
  });
  results.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { invoices: results.map(function (i) { return Object.assign({}, i); }), total: total };
}

// ── Payments ──

/**
 * Record a payment against an invoice.
 *
 * @param {object} data - Payment data
 * @param {string} data.invoiceId - Invoice ID (required)
 * @param {number} data.amount - Payment amount (required)
 * @param {string} [data.method='other'] - Payment method
 * @param {string} [data.reference] - Reference number
 * @param {string} [data.customerId] - Customer ID (auto-filled from invoice)
 * @returns {object} Payment record
 */
function recordPayment(data) {
  if (!data || !data.invoiceId) return { error: 'Invoice ID is required' };
  if (!data.amount || data.amount <= 0) return { error: 'Payment amount must be greater than 0' };

  var inv = _invoices[data.invoiceId];
  if (!inv) return { error: 'Invoice not found: ' + data.invoiceId };

  var method = data.method || 'other';
  var methodCheck = _validatePaymentMethod(method);
  if (!methodCheck.valid) return { error: methodCheck.error };

  var id = _genId();
  var now = _now();
  var amount = Math.round(data.amount * 100) / 100;

  var payment = {
    id: id,
    invoiceId: data.invoiceId,
    customerId: data.customerId || inv.customerId,
    amount: amount,
    method: method,
    methodDisplayName: PAYMENT_METHODS[method].displayName,
    reference: data.reference || null,
    status: 'completed',
    receivedAt: now,
    createdAt: now,
  };

  _payments[id] = payment;
  _persist('payment', payment);

  // Update invoice
  inv.amountPaid = Math.round((inv.amountPaid + amount) * 100) / 100;
  inv.balanceDue = Math.round((inv.total - inv.amountPaid) * 100) / 100;
  if (inv.balanceDue <= 0) {
    inv.status = 'paid';
    inv.statusDisplayName = INVOICE_STATUSES.paid.displayName;
    inv.paidDate = now;
  }
  inv.updatedAt = now;
  _persist('invoice', inv);

  _recordActivity(inv.customerId, 'Payment Received: ' + inv.invoiceNumber,
    'Payment of $' + amount.toFixed(2) + ' received via ' + PAYMENT_METHODS[method].displayName + ' for ' + inv.invoiceNumber,
    { invoiceId: data.invoiceId, invoiceNumber: inv.invoiceNumber, amount: amount, method: method });

  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    invoiceNumber: inv.invoiceNumber,
    amount: payment.amount,
    method: payment.method,
    methodDisplayName: payment.methodDisplayName,
    receivedAt: payment.receivedAt,
    invoiceBalance: inv.balanceDue,
    invoiceStatus: inv.status,
  };
}

/**
 * Refund a payment (or partial amount).
 *
 * @param {string} id - Payment ID
 * @param {number} [amount] - Amount to refund (defaults to full payment)
 * @returns {object} Refund record
 */
function refundPayment(id, amount) {
  if (!id) return { error: 'Payment ID is required' };
  var payment = _payments[id];
  if (!payment) return { error: 'Payment not found: ' + id };

  var refundAmount = amount ? Math.round(amount * 100) / 100 : payment.amount;
  if (refundAmount <= 0) return { error: 'Refund amount must be greater than 0' };
  if (refundAmount > payment.amount) return { error: 'Refund amount cannot exceed original payment amount' };

  var inv = _invoices[payment.invoiceId];
  var now = _now();

  var refund = {
    id: _genId(),
    invoiceId: payment.invoiceId,
    customerId: payment.customerId,
    originalPaymentId: payment.id,
    amount: refundAmount,
    method: payment.method,
    methodDisplayName: payment.methodDisplayName,
    reference: payment.reference,
    status: 'refunded',
    receivedAt: now,
    createdAt: now,
  };

  _payments[refund.id] = refund;
  _persist('payment', refund);

  if (inv) {
    inv.amountPaid = Math.round((inv.amountPaid - refundAmount) * 100) / 100;
    inv.balanceDue = Math.round((inv.total - inv.amountPaid) * 100) / 100;
    inv.status = 'refunded';
    inv.statusDisplayName = INVOICE_STATUSES.refunded.displayName;
    inv.updatedAt = now;
    _persist('invoice', inv);
  }

  _recordActivity(inv ? inv.customerId : null, 'Payment Refunded',
    'Refund of $' + refundAmount.toFixed(2) + ' for payment ' + id,
    { paymentId: id, refundId: refund.id, amount: refundAmount });

  return {
    id: refund.id,
    invoiceId: refund.invoiceId,
    amount: refund.amount,
    status: 'refunded',
    receivedAt: refund.receivedAt,
  };
}

/**
 * Search financial records (estimates and invoices) by keyword.
 *
 * @param {string} query - Search query
 * @returns {object} { estimates, invoices, total }
 */
function searchFinancialRecords(query) {
  if (!query) return { error: 'Search query is required' };
  var estResults = listEstimates({ search: query });
  var invResults = listInvoices({ search: query });
  return {
    estimates: estResults.estimates,
    invoices: invResults.invoices,
    total: estResults.total + invResults.total,
  };
}

// ── Financial Analytics ──

/**
 * Calculate total revenue for a customer.
 *
 * @param {string} customerId - Customer ID
 * @returns {object} Revenue summary
 */
function calculateCustomerRevenue(customerId) {
  if (!customerId) return { error: 'Customer ID is required' };
  var paidInvoices = listInvoices({ customerId: customerId, status: 'paid' });
  var totalRevenue = paidInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var invoiceCount = paidInvoices.total;
  var avgInvoice = invoiceCount > 0 ? Math.round((totalRevenue / invoiceCount) * 100) / 100 : 0;
  return {
    customerId: customerId,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    invoiceCount: invoiceCount,
    averageInvoiceValue: avgInvoice,
  };
}

/**
 * Calculate outstanding balance across all invoices.
 *
 * @param {string} [customerId] - Optional customer filter
 * @returns {object} Outstanding balance summary
 */
function calculateOutstandingBalance(customerId) {
  var filter = customerId ? { customerId: customerId } : {};
  var allInvoices = listInvoices(Object.assign({}, filter));
  var totalOutstanding = 0;
  var overdueCount = 0;
  var overdueAmount = 0;
  var now = _now();

  allInvoices.invoices.forEach(function (inv) {
    if (inv.status === 'sent' || inv.status === 'overdue') {
      totalOutstanding += inv.balanceDue;
      if (inv.dueDate && inv.dueDate < now) {
        overdueCount++;
        overdueAmount += inv.balanceDue;
      }
    }
  });

  totalOutstanding = Math.round(totalOutstanding * 100) / 100;
  overdueAmount = Math.round(overdueAmount * 100) / 100;

  return {
    customerId: customerId || 'all',
    totalOutstanding: totalOutstanding,
    overdueCount: overdueCount,
    overdueAmount: overdueAmount,
    invoiceCount: allInvoices.invoices.filter(function (i) { return i.status === 'sent' || i.status === 'overdue'; }).length,
  };
}

/**
 * Calculate average invoice value.
 *
 * @param {object} [filters] - Optional filters
 * @returns {object} Average invoice value
 */
function calculateAverageInvoice(filters) {
  var all = listInvoices(Object.assign({}, filters || {}));
  var totalValue = all.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var avg = all.total > 0 ? Math.round((totalValue / all.total) * 100) / 100 : 0;
  return {
    totalInvoices: all.total,
    totalValue: Math.round(totalValue * 100) / 100,
    averageValue: avg,
    medianValue: 0, // Simplified
  };
}

/**
 * Calculate profitability summary.
 *
 * @returns {object} Profitability summary
 */
function calculateProfitability() {
  var allInvoices = listInvoices();
  var paidInvoices = listInvoices({ status: 'paid' });
  var totalRevenue = paidInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var totalInvoiced = allInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var collectionRate = totalInvoiced > 0 ? Math.round((totalRevenue / totalInvoiced) * 10000) / 100 : 0;

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalInvoiced: Math.round(totalInvoiced * 100) / 100,
    outstanding: Math.round((totalInvoiced - totalRevenue) * 100) / 100,
    collectionRate: collectionRate,
    collectionRateDisplay: collectionRate + '%',
    paidInvoiceCount: paidInvoices.total,
    totalInvoiceCount: allInvoices.total,
  };
}

/**
 * Calculate revenue forecast.
 *
 * @param {number} [months=3] - Forecast horizon in months
 * @returns {object} Revenue forecast
 */
function calculateRevenueForecast(months) {
  months = months || 3;
  var paidInvoices = listInvoices({ status: 'paid' });
  var sentInvoices = listInvoices({ status: 'sent' });

  var totalRevenue = paidInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var totalSent = sentInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);

  // Monthly average from historical paid invoices
  var monthlyAvg = paidInvoices.total > 0 ? Math.round((totalRevenue / Math.max(1, paidInvoices.total)) * 100) / 100 : 0;

  // Forecast: expected based on average
  var forecastValue = Math.round(monthlyAvg * months * 100) / 100;

  // Pipeline: sent invoices likely to be paid
  var pipelineValue = Math.round(totalSent * 0.7 * 100) / 100; // 70% collection assumption

  return {
    monthlyAverage: monthlyAvg,
    forecastMonths: months,
    forecastRevenue: forecastValue,
    pipelineRevenue: pipelineValue,
    totalForecast: Math.round((forecastValue + pipelineValue) * 100) / 100,
    calculatedAt: _now(),
  };
}

/**
 * Get comprehensive financial metrics.
 *
 * @returns {object} Financial metrics
 */
function getFinancialMetrics() {
  var allInvoices = listInvoices();
  var paidInvoices = listInvoices({ status: 'paid' });
  var sentInvoices = listInvoices({ status: 'sent' });
  var overdueInvoices = listInvoices({ status: 'overdue' });
  var draftInvoices = listInvoices({ status: 'draft' });

  var totalRevenue = paidInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var totalInvoiced = allInvoices.invoices.reduce(function (s, i) { return s + i.total; }, 0);
  var totalOutstanding = sentInvoices.invoices.reduce(function (s, i) { return s + i.balanceDue; }, 0) + overdueInvoices.invoices.reduce(function (s, i) { return s + i.balanceDue; }, 0);

  var avgInvoiceValue = allInvoices.total > 0 ? Math.round((totalInvoiced / allInvoices.total) * 100) / 100 : 0;
  var collectionRate = totalInvoiced > 0 ? Math.round((totalRevenue / totalInvoiced) * 10000) / 100 : 0;

  // Payment aging
  var aging = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  var now = new Date();
  sentInvoices.invoices.forEach(function (inv) {
    if (inv.dueDate) {
      var daysOverdue = Math.round((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      if (daysOverdue <= 0) aging.current += inv.balanceDue;
      else if (daysOverdue <= 30) aging['1-30'] += inv.balanceDue;
      else if (daysOverdue <= 60) aging['31-60'] += inv.balanceDue;
      else if (daysOverdue <= 90) aging['61-90'] += inv.balanceDue;
      else aging['90+'] += inv.balanceDue;
    }
  });

  // ── Estimate-derived pipeline metrics (separate from invoice revenue) ──
    var allEstimates = listEstimates();
    var pendingEstimates = allEstimates.estimates.filter(function (e) {
      return e.status !== 'archived' && e.status !== 'rejected';
    });
    var totalEstimatedValue = pendingEstimates.reduce(function (s, e) { return s + e.total; }, 0);

    return {
      // Invoice-based revenue (actual money, never mixed with estimates)
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      paidInvoiceCount: paidInvoices.total,
      sentInvoiceCount: sentInvoices.total,
      overdueInvoiceCount: overdueInvoices.total,
      draftInvoiceCount: draftInvoices.total,
      totalInvoiceCount: allInvoices.total,
      averageInvoiceValue: avgInvoiceValue,
      collectionRate: collectionRate,
      collectionRateDisplay: collectionRate + '%',
      paymentAging: aging,

      // Estimate-based pipeline metrics (not revenue — future potential)
      pendingEstimateCount: pendingEstimates.length,
      pendingEstimateTotal: Math.round(totalEstimatedValue * 100) / 100,

      calculatedAt: _now(),
    };
}

/**
 * Get payment history.
 *
 * @param {object} [filters] - Optional filters
 * @returns {object} { payments, total }
 */
function getPaymentHistory(filters) {
  var results = [];
  Object.keys(_payments).forEach(function (k) {
    var p = _payments[k];
    if (filters) {
      if (filters.invoiceId && p.invoiceId !== filters.invoiceId) return;
      if (filters.customerId && p.customerId !== filters.customerId) return;
      if (filters.method && p.method !== filters.method) return;
    }
    results.push(p);
  });
  results.sort(function (a, b) { return new Date(b.receivedAt) - new Date(a.receivedAt); });
  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) results = results.slice(0, filters.limit);
  return { payments: results.map(function (p) { return Object.assign({}, p); }), total: total };
}

// ── Module Exports ──

module.exports = {
  // Lifecycle
  init: init,

  // Estimates
  createEstimate: createEstimate,
  updateEstimate: updateEstimate,
  approveEstimate: approveEstimate,
  archiveEstimate: archiveEstimate,
  restoreEstimate: restoreEstimate,
  getEstimate: getEstimate,
  listEstimates: listEstimates,

  // Invoices
  createInvoice: createInvoice,
  updateInvoice: updateInvoice,
  markInvoiceSent: markInvoiceSent,
  getInvoice: getInvoice,
  listInvoices: listInvoices,

  // Payments
  recordPayment: recordPayment,
  refundPayment: refundPayment,

  // Search
  searchFinancialRecords: searchFinancialRecords,

  // Analytics
  calculateCustomerRevenue: calculateCustomerRevenue,
  calculateOutstandingBalance: calculateOutstandingBalance,
  calculateAverageInvoice: calculateAverageInvoice,
  calculateProfitability: calculateProfitability,
  calculateRevenueForecast: calculateRevenueForecast,
  getFinancialMetrics: getFinancialMetrics,
  getPaymentHistory: getPaymentHistory,

  // Constants
  ESTIMATE_STATUSES: ESTIMATE_STATUSES,
  INVOICE_STATUSES: INVOICE_STATUSES,
  PAYMENT_METHODS: PAYMENT_METHODS,
};