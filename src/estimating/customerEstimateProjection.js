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
  const name = text(company.name, 160, text(raw.company, 160));
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

function fixed(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 999999999999 ? number.toFixed(2) : null;
}

function humanize(value) {
  return text(String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' '), 200)
    .replace(/^./, character => character.toUpperCase());
}

function draftScope(item) {
  const scope = item && item.opportunity && item.opportunity.scope;
  if (typeof scope === 'string' && text(scope, 4000)) return text(scope, 4000);
  const source = scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {};
  const hidden = new Set(['address','assessmentQuestions','businessContext','callerIntent','conversationOutcome','customerContext','description','disposalPreference','email','phone','pricingModel','requestedWork','serviceRadiusMiles','siteConcern','timeZone','workDescription']);
  const order = ['jobType','workType','treeCount','sizeClass','approximateHeightFeet','conditionClass','nearStructure','accessClass','terrain','material','finish','linearFeet','squareFeet','sqft','area','equipmentName','equipmentReference','crewProfile','plannedCrewSize','crewCount','laborHours','estimatedDurationHours','customerDistanceMiles','serviceZone','schedulingConstraint','urgency'];
  const labels = {jobType:'Work Type',workType:'Work Type',treeCount:'Tree Count',sizeClass:'Size',approximateHeightFeet:'Approximate Height',conditionClass:'Condition',nearStructure:'Near A Structure',accessClass:'Access',linearFeet:'Length',squareFeet:'Area',sqft:'Area',equipmentName:'Equipment',equipmentReference:'Equipment',crewProfile:'Crew',plannedCrewSize:'Planned Crew Size',crewCount:'Crew Count',laborHours:'Labor Time',estimatedDurationHours:'Estimated Duration',customerDistanceMiles:'Customer Distance',serviceZone:'Service Area',schedulingConstraint:'Scheduling'};
  const units = {approximateHeightFeet:'ft',linearFeet:'ft',squareFeet:'sq ft',sqft:'sq ft',area:'sq ft',laborHours:'hours',estimatedDurationHours:'hours',customerDistanceMiles:'miles'};
  let keys = Object.keys(source).filter(key => !hidden.has(key) && ['string','number','boolean'].includes(typeof source[key]));
  keys.sort((left,right) => { const a=order.indexOf(left),b=order.indexOf(right);return(a<0?999:a)-(b<0?999:b)||left.localeCompare(right); });
  const seenValues=new Set();
  keys=keys.filter(key => {
    if(key==='equipmentReference'&&source.equipmentName)return false;
    if(typeof source[key]!=='string')return true;
    const value=source[key].trim().toLowerCase();
    if(!value||seenValues.has(value))return false;
    seenValues.add(value);return true;
  });
  const details = keys.slice(0, 10).map(key => {
    const raw = typeof source[key] === 'boolean' ? (source[key] ? 'Yes' : 'No') : typeof source[key] === 'string' ? source[key].trim() : String(source[key]);
    const value = raw.replace(/[_-]+/g,' ').replace(/^./, character => character.toUpperCase()) + (units[key] ? ' ' + units[key] : '');
    return (labels[key] || humanize(key)) + ': ' + value;
  });
  const title = text(item && item.snapshot && item.snapshot.service && item.snapshot.service.label, 200,
    text(item && item.opportunity && item.opportunity.serviceType, 200, 'Service work'));
  return text((humanize(title) + (details.length ? '. ' + details.join('; ') + '.' : '.')).replace(/\.\./g,'.'), 4000);
}

function createCustomerEstimateDraft(input) {
  const review = input && input.review;
  const item = input && input.item;
  if (!review || !item || !item.customer || !item.opportunity || !item.estimate) {
    unavailable('The recorded estimate is unavailable.', 404, 'CUSTOMER_ESTIMATE_UNAVAILABLE');
  }
  const simulated = input.simulated === true || review.simulated === true;
  const snapshot=item.snapshot&&typeof item.snapshot==='object'?item.snapshot:{};
  const price = fixed(item.estimate.customerPrice != null ? item.estimate.customerPrice : snapshot.customerFacingPrice);
  if (!price) unavailable('The recorded customer price is unavailable.');
  const recordedTax=snapshot.taxDisposition&&snapshot.taxDisposition.status==='calculated'?fixed(snapshot.tax):null;
  const recordedTotal=recordedTax!==null?fixed(snapshot.totalIncludingTax):null;
  const taxReady=recordedTax!==null&&recordedTotal!==null;
  const taxes=taxReady?[{label:'Estimated Tax',treatment:Number(snapshot.taxRatePercent)===0?'zero_rate':'taxable',amount:recordedTax}]:[];
  const rawLines = Array.isArray(item.estimate.lineItems) ? item.estimate.lineItems : [];
  const categoryLabels={labor:'Labor And Installation',materials:'Materials',material:'Materials',equipment:'Equipment',travel:'Travel And Mobilization',service:'Service And Scope',fees:'Permits And Fees',fee:'Permits And Fees'};
  let charges = rawLines.map((line,index) => ({
    label:/^(illustrative|configured)/i.test(text(line&&line.label,200))&&categoryLabels[String(line&&line.category||'').toLowerCase()]
      ? categoryLabels[String(line.category).toLowerCase()]
      : text(line && line.label, 200, 'Estimated Service ' + (index + 1)),
    kind:line && line.kind === 'fee' ? 'fee' : 'charge',
    amount:fixed(line && (line.customerCharge != null ? line.customerCharge : line.amount)),
  })).filter(line => line.amount !== null);
  const lineTotal = charges.reduce((sum,line) => sum + Number(line.amount), 0);
  if (!charges.length || Math.abs(lineTotal - Number(price)) > 0.01) {
    charges = [{label:humanize(item.opportunity.serviceType || 'Estimated service'),kind:'charge',amount:price}];
  }
  const contentBasis = stableValue({
    contract:CONTRACT,
    simulated,
    issuer:publicIssuer(input.profile),
    customer:{name:text(item.customer.name,200),address:text(item.customer.address,400)},
    work:{title:humanize(item.snapshot && item.snapshot.service && item.snapshot.service.label || item.opportunity.serviceType || 'Service estimate'),scope:draftScope(item)},
    currency:text(item.estimate.currency,8,'USD'),
    charges,
    adjustments:[],
    taxes,
    subtotal:price,
    tax:taxReady?recordedTax:'0.00',
    total:taxReady?recordedTotal:price,
    payments:[],
    preparedAt:text(review.recordedAt || item.snapshotCreatedAt,40),
  });
  if (!contentBasis.issuer.name) unavailable('Add the business name before viewing this estimate.');
  if (!contentBasis.customer.name) unavailable('Add the customer name before viewing this estimate.');
  const reference='EST-'+sha256(contentBasis).slice(0,10).toUpperCase();
  return Object.freeze(stableValue({
    ...contentBasis,
    reference,
    state:'draft',
    notice:simulated
      ? 'Draft fictional demo estimate based on the recorded request and simulated business profile. Tax and final terms must be reviewed before issuing.'
      : 'Draft estimate based on the recorded request and current business profile. Tax and final terms must be reviewed before issuing or sending.',
    capabilities:{downloadPdf:true,downloadImage:true,accept:false,askQuestion:false},
    platformSignature:'Powered by NorthStar',
  }));
}

function createCustomerEstimateDisplay(input) {
  const commercial=input&&input.review&&input.review.commercialTerms;
  const ready=!!(commercial&&commercial.customerSummary&&commercial.approvalState==='commercial_approved'&&commercial.binding&&commercial.current&&commercial.current.current===true);
  return ready ? createCustomerEstimatePreview(input) : createCustomerEstimateDraft(input);
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
      name: text(item.customer.name, 200),
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
  if (!contentBasis.issuer.name) unavailable('Add the business name before previewing a customer estimate.');
  if (!contentBasis.customer.name) unavailable('Add the customer name before previewing this estimate.');
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
    platformSignature: 'Powered by NorthStar',
  }));
}

module.exports = { CONTRACT, createCustomerEstimatePreview, createCustomerEstimateDraft, createCustomerEstimateDisplay, publicIssuer, unavailable };
