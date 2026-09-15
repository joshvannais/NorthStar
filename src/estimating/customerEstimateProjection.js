'use strict';

const { sha256, stableValue } = require('../services/businessProfileAdapter');

const CONTRACT = 'NorthStarCustomerEstimatePreview/v1';
const MONEY = /^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/;

function unavailable(message, status = 409, code = 'CUSTOMER_ESTIMATE_NOT_READY') {
  throw Object.assign(new Error(message), { status, code });
}

function text(value, maximum, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean ? clean.slice(0, maximum) : fallback;
}

function amount(value, label) {
  if (typeof value !== 'string' || !MONEY.test(value)) {
    unavailable('The approved ' + label + ' is unavailable. Review the commercial terms again.');
  }
  return value;
}

function publicIssuer(profile) {
  const raw = profile && profile.rawProfile ? profile.rawProfile : profile || {};
  const company = raw.company && typeof raw.company === 'object' ? raw.company : {};
  const headquarters = raw.headquarters && typeof raw.headquarters === 'object' ? raw.headquarters : {};
  const name = text(company.name, 160, text(raw.company, 160, 'Business name unavailable'));
  const address = text(headquarters.formatted, 300) || [
    text(headquarters.street, 160), text(headquarters.city, 100),
    [text(headquarters.state, 80), text(headquarters.zip || headquarters.postalCode, 24)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  return stableValue({
    name,
    dba: text(company.dba, 160),
    email: text(company.email || raw.email, 254),
    phone: text(company.phone || raw.phone, 80),
    website: text(company.website || raw.website, 300),
    address: text(address, 400),
  });
}

function safeLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 24) {
    unavailable('Approved customer charges are unavailable. Review the commercial terms again.');
  }
  return lines.map(function (line, index) {
    return stableValue({
      label: text(line && line.label, 200, 'Customer charge ' + (index + 1)),
      kind: line && line.kind === 'fee' ? 'fee' : 'charge',
      amount: amount(line && line.adjustedAmount, 'customer charge'),
    });
  });
}

function safeAdjustments(rows) {
  if (!Array.isArray(rows)) return [];
  if (rows.length > 12) unavailable('The approved adjustments are unavailable. Review the commercial terms again.');
  return rows.map(function (row, index) {
    const raw = row && row.amount;
    if (typeof raw !== 'string' || !/^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(raw)) {
      unavailable('The approved adjustment is unavailable. Review the commercial terms again.');
    }
    return stableValue({
      label: text(row.label, 200, 'Adjustment ' + (index + 1)),
      amount: raw,
    });
  });
}

function safeTaxes(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 12) {
    unavailable('Approved tax treatment is unavailable. Review the commercial terms again.');
  }
  return rows.map(function (row, index) {
    return stableValue({
      label: text(row && row.label, 200, 'Tax ' + (index + 1)),
      treatment: ['taxable', 'zero_rate', 'exempt'].includes(row && row.treatment) ? row.treatment : 'reviewed',
      amount: amount(row && row.tax, 'tax amount'),
    });
  });
}

function safePayments(rows) {
  if (!Array.isArray(rows)) return [];
  if (rows.length > 12) unavailable('The approved payment schedule is unavailable. Review the commercial terms again.');
  return rows.map(function (row, index) {
    return stableValue({
      label: text(row && row.label, 200, 'Payment ' + (index + 1)),
      kind: ['deposit', 'milestone', 'balance'].includes(row && row.kind) ? row.kind : 'payment',
      amount: amount(row && row.amount, 'payment amount'),
    });
  });
}

function createCustomerEstimatePreview(input) {
  const review = input && input.review;
  const item = input && input.item;
  const commercial = review && review.commercialTerms;
  const summary = commercial && commercial.customerSummary;
  if (!review || !item || !item.customer || !item.opportunity || !summary ||
      commercial.approvalState !== 'commercial_approved' || !commercial.binding || !commercial.current ||
      commercial.current.current !== true || summary.currency !== review.currency) {
    unavailable('Approve the current scope, charges, tax treatment and terms before previewing a customer estimate.');
  }
  if (summary.taxAuthority === 'unknown') {
    unavailable('Resolve the customer tax treatment before previewing this estimate.');
  }
  const simulated = input.simulated === true || review.simulated === true;
  const contentBasis = stableValue({
    contract: CONTRACT,
    simulated,
    issuer: publicIssuer(input.profile),
    customer: {
      name: text(item.customer.name, 200, 'Customer'),
      address: text(item.customer.address, 400),
    },
    work: {
      title: text(item.opportunity.serviceType || (item.snapshot && item.snapshot.service && item.snapshot.service.label), 200, 'Service estimate'),
      scope: text(summary.scopeSummary, 4000),
    },
    currency: summary.currency,
    charges: safeLines(summary.lines),
    adjustments: safeAdjustments(summary.adjustments),
    taxes: safeTaxes(summary.taxGroups),
    subtotal: amount(summary.netBeforeTax, 'subtotal'),
    tax: amount(summary.tax, 'tax total'),
    total: amount(summary.total, 'estimate total'),
    payments: safePayments(summary.payments),
    preparedAt: text(commercial.binding.createdAt || commercial.current.createdAt || review.recordedAt, 40),
  });
  if (!contentBasis.work.scope) unavailable('The approved customer work scope is unavailable. Review the commercial terms again.');
  const reference = 'EST-' + sha256(contentBasis).slice(0, 10).toUpperCase();
  return Object.freeze(stableValue({
    ...contentBasis,
    reference,
    state: 'preview',
    notice: simulated
      ? 'Fictional demo estimate for product evaluation. No customer was contacted.'
      : 'Preview only. This estimate has not been issued or sent.',
    capabilities: { downloadPdf: true, downloadImage: true, accept: false, askQuestion: false },
    platformSignature: 'Prepared with NorthStar',
  }));
}

module.exports = { CONTRACT, createCustomerEstimatePreview, publicIssuer, unavailable };
