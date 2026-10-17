'use strict';

const READ_METHOD='GET';
const CORS_METHODS=Object.freeze([READ_METHOD]);
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PAID_ABSOLUTE_PATH_PATTERN=new RegExp(
  `^/api/v1/customer-financial/editable-estimates/${UUID}/reporting-part12-acceptance/?$`,'i');
const DEMO_ABSOLUTE_PATH_PATTERN=new RegExp(
  `^/api/demo/customer-financial/invoice-drafts/${UUID}/part12-acceptance/?$`,'i');

function isReportingPart12AcceptancePath(pathname) {
  return typeof pathname==='string'&&(PAID_ABSOLUTE_PATH_PATTERN.test(pathname)||
    DEMO_ABSOLUTE_PATH_PATTERN.test(pathname));
}

module.exports={READ_METHOD,CORS_METHODS,PAID_ABSOLUTE_PATH_PATTERN,
  DEMO_ABSOLUTE_PATH_PATTERN,isReportingPart12AcceptancePath};
