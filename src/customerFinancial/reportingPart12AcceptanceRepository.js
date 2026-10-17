'use strict';

const providerBoundary=require('./paymentProviderBoundary');
const part11Repository=require('./accountingPart11AcceptanceRepository');
const previewRepository=require('./invoiceDraftPreviewRepository');
const invoiceRepository=require('./invoiceReceivableReportingRepository');
const paymentRepository=require('./paymentCashReportingRepository');
const readersRepository=require('./downstreamReportingReadersRepository');
const invoiceReporting=require('./invoiceReceivableReporting');
const paymentReporting=require('./paymentCashReporting');
const downstreamReaders=require('./downstreamReportingReaders');
const contract=require('./reportingPart12Acceptance');

const SOURCE_KEYS=['invoiceReceivableReporting','paymentCashReporting',
  'downstreamReportingReaders'];

function projectSources(raw) {
  if (!raw||typeof raw!=='object'||Array.isArray(raw)||
      Object.keys(raw).length!==SOURCE_KEYS.length||
      !Object.keys(raw).every(key=>SOURCE_KEYS.includes(key))) throw changed();
  const invoiceReceivableReporting=invoiceReporting.project(raw.invoiceReceivableReporting);
  const paymentCashReporting=paymentReporting.project(raw.paymentCashReporting);
  const downstreamReportingReaders=downstreamReaders.project(
    raw.downstreamReportingReaders,{invoiceReceivableReporting,paymentCashReporting});
  return {invoiceReceivableReporting,paymentCashReporting,downstreamReportingReaders};
}

function changed() {
  return Object.assign(new Error(
    'The exact Part 12 reporting sources changed. Reload their current evidence.'),{
    code:'CUSTOMER_FINANCIAL_REPORTING_PART12_CHANGED',status:409,
  });
}

async function defaultReadSources(source) {
  // These projections are independent, read-only, and each revalidates its own
  // exact server-owned sources. Read them together so the atomic Part 12
  // boundary does not serialize unrelated database work.
  const [invoiceReceivableReporting,paymentCashReporting]=await Promise.all([
    invoiceRepository.read(source),paymentRepository.read(source),
  ]);
  const downstreamReportingReaders=await readersRepository.read(source,{readSources:async()=>({
    invoiceReceivableReporting,paymentCashReporting,
  })});
  return {invoiceReceivableReporting,paymentCashReporting,downstreamReportingReaders};
}

async function readBundle(pool,source,estimateId,receiptId,receiptDigest,options={}) {
  const readPart11=options.readPart11||part11Repository.readBundle;
  const readSources=options.readSources||defaultReadSources;
  const readPreview=options.readPreview||previewRepository.read;
  const projectSourceSnapshot=options.projectSources||projectSources;
  const initialPreview=await readPreview(pool,source,estimateId,receiptId,receiptDigest);
  // Part 11 is itself an atomic released bundle whose repository revalidates
  // its complete Part 10 source before and after projection. Read that exact
  // bundle on every request, then strictly project independently read Parts
  // 12A-C sources before and after the outer projection. Nothing is cached or
  // trusted by identity: the exact untrusted Part 11 value traverses the full
  // validator in the final atomic bundle call, and any Part 12 source
  // disagreement fails the whole request. Keeping that expensive strict Part
  // 11 projection singular also avoids both pool exhaustion and the mounted
  // WebKit/session ceiling.
  const [part11Raw,beforeSources]=await Promise.all([
    readPart11(pool,source,estimateId,receiptId,receiptDigest),readSources(source),
  ]);
  const before=projectSourceSnapshot(beforeSources);
  const afterSources=await readSources(source);
  const after=projectSourceSnapshot(afterSources);
  const afterPreview=await readPreview(pool,source,estimateId,receiptId,receiptDigest);
  if (providerBoundary.digest(before)!==providerBoundary.digest(after) ||
      providerBoundary.digest(part11Raw?.preview)!==providerBoundary.digest(initialPreview) ||
      providerBoundary.digest(part11Raw?.preview)!==providerBoundary.digest(afterPreview)) throw changed();
  try {
    const value=contract.bundle(part11Raw,undefined,afterSources);
    return value;
  } catch (_error) { throw changed(); }
}

module.exports={readBundle};
