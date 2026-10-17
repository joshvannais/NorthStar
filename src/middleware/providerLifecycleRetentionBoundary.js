'use strict';

const { READ_METHOD, isProviderLifecycleRetentionPath } =
  require('../customerFinancial/providerLifecycleRetentionHttpBoundary');

function setPrivate(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.vary('Cookie');
}

function hasFramedBody(req) {
  const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  let contentLengthCount = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === 'content-length') contentLengthCount += 1;
  }
  if (contentLengthCount > 1) return true;
  const transfer = req.headers?.['transfer-encoding'];
  if (transfer !== undefined && String(transfer).trim() !== '') return true;
  const length = req.headers?.['content-length'];
  if (length === undefined) return false;
  return !/^0+$/.test(String(length).trim());
}

function invalid(res) {
  setPrivate(res);
  return res.status(400).json({ success: false, error: {
    category: 'CUSTOMER_FINANCIAL_PROVIDER_RETENTION_INVALID',
    message: 'Review the provider lifecycle retention request.',
  } });
}

function methodNotAllowed(res) {
  setPrivate(res);
  res.set('Allow', READ_METHOD);
  return res.status(405).json({ success: false, error: {
    category: 'CUSTOMER_FINANCIAL_PROVIDER_RETENTION_METHOD_NOT_ALLOWED',
    message: 'Use the provider lifecycle retention read boundary.',
  } });
}

function providerLifecycleRetentionBoundary(req, res, next) {
  if (!isProviderLifecycleRetentionPath(req.path)) return next();
  if (req.method !== READ_METHOD) return methodNotAllowed(res);
  return hasFramedBody(req) ? invalid(res) : next();
}

module.exports = { providerLifecycleRetentionBoundary, hasFramedBody, setPrivate,
  invalid, methodNotAllowed };
