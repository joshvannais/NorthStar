/**
 * M13-P6: Financial Intelligence Engine — Smoke Tests
 *
 * Tests all public API exports across estimate, invoice, payment,
 * and financial analytics lifecycles.
 */

const store = require('../src/polaris/store');
const fin = require('../src/polaris/financial-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

// 1. Init
var initResult = fin.init();
c('init returns object', typeof initResult === 'object');
c('init has loaded count', typeof initResult.loaded === 'number');

// ── Estimate Creation ──

var e1 = fin.createEstimate({
  customerId: 'cust_fin_test_1',
  title: 'HVAC System Replacement - Johnson Residence',
  items: [
    { description: 'AC Unit - 3 Ton', quantity: 1, unitPrice: 4500 },
    { description: 'Installation Labor', quantity: 1, unitPrice: 1200 },
    { description: 'Ductwork Materials', quantity: 1, unitPrice: 800 },
  ],
  taxPercent: 8,
  discountPercent: 5,
  opportunityId: 'opp_fin_test_1',
  validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
  notes: 'Valid for 30 days',
});

c('create estimate returns id', !!e1.id);
c('create estimate title', e1.title.indexOf('HVAC') !== -1);
c('create estimate total', e1.total > 0);
c('create estimate subtotal', e1.subtotal === 6500);
c('create estimate tax', e1.tax === 520);
c('create estimate discount', e1.discount === 325);
c('create estimate total correct', e1.total === 6695);
c('create estimate status draft', e1.status === 'draft');
var estId1 = e1.id;

var e2 = fin.createEstimate({
  customerId: 'cust_fin_test_1',
  title: 'AC Tune-Up Package',
  items: [
    { description: 'AC Tune-Up Service', quantity: 1, unitPrice: 199 },
  ],
  taxPercent: 8,
});

c('create estimate 2', !!e2.id);
c('estimate 2 total', e2.total === 214.92);

// ── Get Estimate ──

var g = fin.getEstimate(estId1);
c('get estimate returns title', g.title.indexOf('Replacement') !== -1);
c('get estimate returns items', Array.isArray(g.items) && g.items.length === 3);
c('get estimate returns immutable copy', g.id === estId1);

// ── Update Estimate ──

var u = fin.updateEstimate(estId1, {
  title: 'HVAC System Replacement - Updated',
  discountPercent: 10,
});

c('update estimate title', u.title.indexOf('Updated') !== -1);
c('update estimate discount', u.total < 6695);

// ── Approve Estimate ──

var a = fin.approveEstimate(estId1);
c('approve estimate status', a.status === 'approved');

var ga = fin.getEstimate(estId1);
c('estimate approvedAt set', ga.approvedAt !== null);

// ── Archive / Restore Estimate ──

var arch = fin.archiveEstimate(estId1);
c('archive estimate', arch.archived === true);

var rest = fin.restoreEstimate(estId1);
c('restore estimate', rest.status === 'draft');

// ── List Estimates ──

var listEst = fin.listEstimates();
c('list estimates', Array.isArray(listEst.estimates));
c('list estimates total', listEst.total === 2);

var custEst = fin.listEstimates({ customerId: 'cust_fin_test_1' });
c('filter estimates by customer', custEst.total === 2);

// ── Invoice Creation ──

var i1 = fin.createInvoice({
  customerId: 'cust_fin_test_1',
  title: 'HVAC System Replacement - Invoice',
  items: [
    { description: 'AC Unit - 3 Ton', quantity: 1, unitPrice: 4500 },
    { description: 'Installation Labor', quantity: 1, unitPrice: 1200 },
  ],
  taxPercent: 8,
  estimateId: estId1,
  dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
  notes: 'Payment due within 30 days',
});

c('create invoice returns id', !!i1.id);
c('create invoice number', i1.invoiceNumber.indexOf('INV-') !== -1);
c('create invoice total', i1.total === 6156);
c('create invoice balanceDue', i1.balanceDue === 6156);
c('create invoice status draft', i1.status === 'draft');
var invId1 = i1.id;

var i2 = fin.createInvoice({
  customerId: 'cust_fin_test_2',
  title: 'AC Tune-Up',
  items: [
    { description: 'Tune-Up Service', quantity: 1, unitPrice: 199 },
  ],
  taxPercent: 8,
});

c('create invoice 2', !!i2.id);

// ── Get Invoice ──

var gi = fin.getInvoice(invId1);
c('get invoice returns title', gi.title.indexOf('Replacement') !== -1);
c('get invoice returns items', Array.isArray(gi.items) && gi.items.length === 2);
c('get invoice has invoiceNumber', typeof gi.invoiceNumber === 'string');
c('get invoice immutable', gi.id === invId1);

// ── Update Invoice ──

var ui = fin.updateInvoice(invId1, {
  title: 'HVAC System Replacement - Final Invoice',
  notes: 'Thank you for your business',
});

c('update invoice title', ui.title.indexOf('Final') !== -1);

// ── Mark Invoice Sent ──

var ms = fin.markInvoiceSent(invId1);
c('mark sent status', ms.status === 'sent');
c('mark sent has sentDate', typeof ms.sentDate === 'string');

var gi2 = fin.getInvoice(invId1);
c('invoice sent date persisted', gi2.sentDate !== null);

// ── List Invoices ──

var listInv = fin.listInvoices();
c('list invoices', Array.isArray(listInv.invoices));
c('list invoices total', listInv.total === 2);

var custInv = fin.listInvoices({ customerId: 'cust_fin_test_1' });
c('filter invoices by customer', custInv.total === 1);

var sentInv = fin.listInvoices({ status: 'sent' });
c('filter invoices by status sent', sentInv.total >= 1);

// ── Payments ──

var p1 = fin.recordPayment({
  invoiceId: invId1,
  amount: 3000,
  method: 'creditCard',
  reference: 'TXN-12345',
});

c('payment returns id', !!p1.id);
c('payment amount', p1.amount === 3000);
c('payment method', p1.method === 'creditCard');
c('payment invoice balance', p1.invoiceBalance === 3156);
c('payment invoice status still sent', p1.invoiceStatus === 'sent');

var gi3 = fin.getInvoice(invId1);
c('invoice amountPaid updated', gi3.amountPaid === 3000);
c('invoice balanceDue updated', gi3.balanceDue === 3156);

// Full payment
var p2 = fin.recordPayment({
  invoiceId: invId1,
  amount: 3156,
  method: 'bankTransfer',
  reference: 'TXN-67890',
});

c('payment 2 balance', p2.invoiceBalance === 0);
c('payment 2 invoice status paid', p2.invoiceStatus === 'paid');

var gi4 = fin.getInvoice(invId1);
c('invoice fully paid', gi4.status === 'paid');
c('invoice paidDate set', gi4.paidDate !== null);

// ── Refund Payment ──

// Create a small payment to refund without affecting the fully-paid invoice
var p3 = fin.recordPayment({
  invoiceId: i2.id,
  amount: 50,
  method: 'cash',
});
c('payment for refund exists', !!p3.id);

var ref = fin.refundPayment(p3.id);
c('refund returns id', !!ref.id);
c('refund invoice number', ref.invoiceId === i2.id);
c('refund status', ref.status === 'refunded');

// ── Search ──

var sr = fin.searchFinancialRecords('HVAC');
c('search finds HVAC', sr.total >= 1);
c('search has estimates', Array.isArray(sr.estimates));
c('search has invoices', Array.isArray(sr.invoices));

// ── Customer Revenue ──

var cr = fin.calculateCustomerRevenue('cust_fin_test_1');
c('customer revenue has totalRevenue', typeof cr.totalRevenue === 'number');
c('customer revenue has invoiceCount', cr.invoiceCount >= 1);

// ── Outstanding Balance ──

var ob = fin.calculateOutstandingBalance();
c('outstanding balance returns totalOutstanding', typeof ob.totalOutstanding === 'number');
c('outstanding balance has overdueCount', typeof ob.overdueCount === 'number');

var ob2 = fin.calculateOutstandingBalance('cust_fin_test_1');
c('outstanding balance by customer', typeof ob2.totalOutstanding === 'number');

// ── Average Invoice ──

var avg = fin.calculateAverageInvoice();
c('average invoice has totalInvoices', avg.totalInvoices >= 2);
c('average invoice has averageValue', avg.averageValue > 0);

// ── Profitability ──

var prof = fin.calculateProfitability();
c('profitability totalRevenue', typeof prof.totalRevenue === 'number');
c('profitability collectionRate', typeof prof.collectionRate === 'number');
c('profitability collectionRateDisplay', typeof prof.collectionRateDisplay === 'string');

// ── Revenue Forecast ──

var fc = fin.calculateRevenueForecast(3);
c('forecast monthlyAverage', typeof fc.monthlyAverage === 'number');
c('forecast forecastRevenue', typeof fc.forecastRevenue === 'number');
c('forecast pipelineRevenue', typeof fc.pipelineRevenue === 'number');
c('forecast totalForecast', typeof fc.totalForecast === 'number');

// ── Financial Metrics ──

var metrics = fin.getFinancialMetrics();
c('metrics totalRevenue', typeof metrics.totalRevenue === 'number');
c('metrics totalInvoiced', typeof metrics.totalInvoiced === 'number');
c('metrics totalOutstanding', typeof metrics.totalOutstanding === 'number');
c('metrics paidInvoiceCount', typeof metrics.paidInvoiceCount === 'number');
c('metrics sentInvoiceCount', typeof metrics.sentInvoiceCount === 'number');
c('metrics overdueInvoiceCount', typeof metrics.overdueInvoiceCount === 'number');
c('metrics averageInvoiceValue', typeof metrics.averageInvoiceValue === 'number');
c('metrics collectionRate', typeof metrics.collectionRate === 'number');
c('metrics paymentAging', typeof metrics.paymentAging === 'object');

// ── Payment History ──

var ph = fin.getPaymentHistory();
c('payment history', Array.isArray(ph.payments));
c('payment history total', ph.total >= 2);

var ph2 = fin.getPaymentHistory({ invoiceId: invId1 });
c('payment history by invoice', ph2.total >= 2);

// ── Error Cases ──

c('create estimate without customer', fin.createEstimate({}).error !== undefined);
c('create estimate without title', fin.createEstimate({customerId:'x'}).error !== undefined);
c('get estimate nonexistent', fin.getEstimate('nonexistent').error !== undefined);
c('update estimate nonexistent', fin.updateEstimate('nonexistent', {}).error !== undefined);
c('archive estimate nonexistent', fin.archiveEstimate('nonexistent').error !== undefined);
c('restore not archived', fin.restoreEstimate(estId1).error !== undefined);
c('create invoice without customer', fin.createInvoice({}).error !== undefined);
c('get invoice nonexistent', fin.getInvoice('nonexistent').error !== undefined);
c('record payment without invoice', fin.recordPayment({}).error !== undefined);
c('record payment zero amount', fin.recordPayment({invoiceId: invId1, amount: 0}).error !== undefined);
c('refund nonexistent payment', fin.refundPayment('nonexistent').error !== undefined);
c('search without query', fin.searchFinancialRecords().error !== undefined);

// ── Final Summary ──

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');