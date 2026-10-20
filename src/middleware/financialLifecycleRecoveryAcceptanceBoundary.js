'use strict';

const { READ_METHOD, isFinancialLifecycleRecoveryAcceptancePath,
  isFinancialLifecycleRecoveryAcceptanceCandidatePath } =
  require('../customerFinancial/financialLifecycleRecoveryAcceptanceHttpBoundary');

function setPrivate(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.vary('Cookie');
}

function hasFramedBody(req) {
  const headers = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  let lengths = 0;
  for (let index = 0; index < headers.length; index += 2) {
    if (String(headers[index]).toLowerCase() === 'content-length') lengths += 1;
  }
  if (lengths > 1) return true;
  const transfer = req.headers?.['transfer-encoding'];
  if (transfer !== undefined && String(transfer).trim() !== '') return true;
  const length = req.headers?.['content-length'];
  return length !== undefined && !/^0+$/.test(String(length).trim());
}

function invalid(res) {
  setPrivate(res);
  return res.status(400).json({ success: false, error: {
    category: 'CUSTOMER_FINANCIAL_RECOVERY_ACCEPTANCE_INVALID',
    message: 'Review the exact current financial lifecycle recovery evidence.',
  } });
}

function methodNotAllowed(res) {
  setPrivate(res); res.set('Allow', READ_METHOD);
  return res.status(405).json({ success: false, error: {
    category: 'CUSTOMER_FINANCIAL_RECOVERY_ACCEPTANCE_METHOD_NOT_ALLOWED',
    message: 'Use the exact financial lifecycle recovery read boundary.',
  } });
}

function financialLifecycleRecoveryAcceptanceBoundary(req, res, next) {
  if (!isFinancialLifecycleRecoveryAcceptanceCandidatePath(req.path)) return next();
  if (req.method !== READ_METHOD) return methodNotAllowed(res);
  return !isFinancialLifecycleRecoveryAcceptancePath(req.path) || hasFramedBody(req) ?
    invalid(res) : next();
}

module.exports = { financialLifecycleRecoveryAcceptanceBoundary, hasFramedBody,
  setPrivate, invalid, methodNotAllowed };
