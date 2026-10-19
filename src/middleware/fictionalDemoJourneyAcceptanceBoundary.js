'use strict';

const { READ_METHOD, isFictionalDemoJourneyAcceptancePath } =
  require('../customerFinancial/fictionalDemoJourneyAcceptanceHttpBoundary');
const { hasFramedBody, setPrivate } = require('./reportingPart12AcceptanceBoundary');

function invalid(res) {
  setPrivate(res);
  return res.status(400).json({ success:false, error:{
    category:'DEMO_FINANCIAL_JOURNEY_INVALID',
    message:'Review the exact current fictional financial journey.',
  } });
}

function methodNotAllowed(res) {
  setPrivate(res); res.set('Allow', READ_METHOD);
  return res.status(405).json({ success:false, error:{
    category:'DEMO_FINANCIAL_JOURNEY_METHOD_NOT_ALLOWED',
    message:'Use the exact fictional financial journey read boundary.',
  } });
}

function fictionalDemoJourneyAcceptanceBoundary(req, res, next) {
  if (!isFictionalDemoJourneyAcceptancePath(req.path)) return next();
  if (req.method !== READ_METHOD) return methodNotAllowed(res);
  return hasFramedBody(req) ? invalid(res) : next();
}

module.exports = { fictionalDemoJourneyAcceptanceBoundary, invalid, methodNotAllowed };
