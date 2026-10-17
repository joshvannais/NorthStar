'use strict';

const providerBoundary=require('./paymentProviderBoundary');
const part11Repository=require('./accountingPart11AcceptanceRepository');
const previewRepository=require('./invoiceDraftPreviewRepository');
const invoiceRepository=require('./invoiceReceivableReportingRepository');
const paymentRepository=require('./paymentCashReportingRepository');
const readersRepository=require('./downstreamReportingReadersRepository');
const contract=require('./reportingPart12Acceptance');
const CACHE_LIMIT=64;
const cache=new Map();

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

function cacheKey(source,estimateId,receiptId,receiptDigest) {
  // Every lookup still executes the current private preview read first, so
  // tenant/session/role authorization is never delegated to this cache. The
  // cached payload is actor-free and identical for owner and administrator.
  return [source.organizationId,estimateId,receiptId,receiptDigest].join(':');
}

function remember(key,previewDigest,bundle) {
  cache.delete(key);cache.set(key,{previewDigest,bundle});
  while(cache.size>CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function readBundle(pool,source,estimateId,receiptId,receiptDigest,options={}) {
  const readPart11=options.readPart11||part11Repository.readBundle;
  const readSources=options.readSources||defaultReadSources;
  const readPreview=options.readPreview||previewRepository.read;
  const key=cacheKey(source,estimateId,receiptId,receiptDigest);
  const initialPreview=await readPreview(pool,source,estimateId,receiptId,receiptDigest);
  const initialDigest=providerBoundary.digest(initialPreview);
  const cached=cache.get(key);
  if(cached&&cached.previewDigest===initialDigest) {
    const confirmed=await readPreview(pool,source,estimateId,receiptId,receiptDigest);
    if(providerBoundary.digest(confirmed)===initialDigest) return cached.bundle;
    cache.delete(key);
    throw changed();
  }
  // Part 11 and both Part 12 source snapshots are independent read-only
  // witnesses. Starting them together preserves the two-snapshot comparison
  // while avoiding a cold request that exceeds WebKit's network ceiling.
  const [part11Raw,beforeSources,afterSources]=await Promise.all([
    readPart11(pool,source,estimateId,receiptId,receiptDigest),
    readSources(source),readSources(source),
  ]);
  // The default Part 11 repository returns an already constructed and fully
  // validated in-process bundle. Preserve that provenance in a WeakSet so the
  // Part 12 composition does not repeat its expensive semantic projection.
  // Injected test/read implementations remain untrusted and are projected by
  // contract.derive before they can participate in a witness.
  const part11Input=readPart11===part11Repository.readBundle
    ? contract.serverPart11Bundle(part11Raw) : part11Raw;
  const before=contract.derive(part11Input,beforeSources);
  const part11=before.part11;
  const after=contract.derive(part11,afterSources);
  const afterPreview=await readPreview(pool,source,estimateId,receiptId,receiptDigest);
  if (providerBoundary.digest(before)!==providerBoundary.digest(after) ||
      providerBoundary.digest(part11.preview)!==providerBoundary.digest(initialPreview) ||
      providerBoundary.digest(part11.preview)!==providerBoundary.digest(afterPreview)) throw changed();
  try {
    const value=contract.bundle(after.part11,contract.unavailable('paid',after.part11,after),after);
    remember(key,providerBoundary.digest(afterPreview),value);
    return value;
  } catch (_error) { throw changed(); }
}

module.exports={readBundle};
