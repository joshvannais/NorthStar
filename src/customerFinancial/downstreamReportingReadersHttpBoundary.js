'use strict';

const READ_METHOD='GET';
const CORS_METHODS=Object.freeze([READ_METHOD]);
const READ_ROUTE=Object.freeze({
  mountSegments:Object.freeze(['api','v1','customer-financial','reporting']),
  leaf:'downstream-readers',
});
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const mountPattern=READ_ROUTE.mountSegments.map(escapePattern).join('/');
const leafPattern=escapePattern(READ_ROUTE.leaf);
const READ_ABSOLUTE_PATH_PATTERN=new RegExp(
  `^/${mountPattern}/{1,2}${leafPattern}/?$`,'i');
const READ_RELATIVE_PATH_PATTERN=new RegExp(`^/${leafPattern}/?$`,'i');

function isDownstreamReadersPath(pathname) {
  return typeof pathname === 'string' && READ_ABSOLUTE_PATH_PATTERN.test(pathname);
}

module.exports={READ_METHOD,CORS_METHODS,READ_ROUTE,READ_ABSOLUTE_PATH_PATTERN,
  READ_RELATIVE_PATH_PATTERN,isDownstreamReadersPath};
