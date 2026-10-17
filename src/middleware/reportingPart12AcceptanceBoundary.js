'use strict';

const {READ_METHOD,isReportingPart12AcceptancePath}=
  require('../customerFinancial/reportingPart12AcceptanceHttpBoundary');

function setPrivate(res) {
  res.set('Cache-Control','private, no-store');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Content-Type-Options','nosniff');
  res.vary('Cookie');
}

function hasFramedBody(req) {
  const rawHeaders=Array.isArray(req.rawHeaders)?req.rawHeaders:[];
  let contentLengthCount=0;
  for (let i=0;i<rawHeaders.length;i+=2) {
    if (String(rawHeaders[i]).toLowerCase()==='content-length') contentLengthCount+=1;
  }
  if (contentLengthCount>1) return true;
  const transfer=req.headers?.['transfer-encoding'];
  if (transfer!==undefined&&String(transfer).trim()!=='') return true;
  const length=req.headers?.['content-length'];
  if (length===undefined) return false;
  return !/^0+$/.test(String(length).trim());
}

function invalid(res) {
  setPrivate(res);
  return res.status(400).json({success:false,error:{
    category:'CUSTOMER_FINANCIAL_REPORTING_PART12_INVALID',
    message:'Review the exact current Part 12 reporting evidence.',
  }});
}

function methodNotAllowed(res) {
  setPrivate(res);
  res.set('Allow',READ_METHOD);
  return res.status(405).json({success:false,error:{
    category:'CUSTOMER_FINANCIAL_REPORTING_PART12_METHOD_NOT_ALLOWED',
    message:'Use the exact Part 12 reporting acceptance read boundary.',
  }});
}

function reportingPart12AcceptanceBoundary(req,res,next) {
  if (!isReportingPart12AcceptancePath(req.path)) return next();
  if (req.method!==READ_METHOD) return methodNotAllowed(res);
  return hasFramedBody(req)?invalid(res):next();
}

module.exports={reportingPart12AcceptanceBoundary,hasFramedBody,setPrivate,
  invalid,methodNotAllowed};
