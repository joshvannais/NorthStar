'use strict';

const presentation = require('../../public/js/operations-overview-contract');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/;

function overviewError(status = 400, code = 'INVALID_OPERATIONAL_OVERVIEW_REQUEST') {
  const error = new Error(status === 403 ? 'This operational overview is not available for your current role.' :
    status === 409 ? 'Operational records changed. Refresh the overview to continue.' :
      status === 400 ? 'The operational overview request is invalid.' : 'The operational overview is temporarily unavailable.');
  Object.assign(error, { status, statusCode: status, code });
  return error;
}

function normalizeOverviewRead(query) {
  const invalid = () => { throw overviewError(); };
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
      Object.keys(query).some(key => !['state', 'limit', 'cursor'].includes(key))) invalid();
  const state = Object.hasOwn(query, 'state') ? query.state : 'active';
  if (!presentation.STATES.includes(state)) invalid();
  let limit = 25;
  if (Object.hasOwn(query, 'limit')) {
    if (typeof query.limit !== 'string' || !/^(?:[1-9][0-9]?|100)$/.test(query.limit)) invalid();
    limit = Number(query.limit);
  }
  let cursor = null;
  if (Object.hasOwn(query, 'cursor')) {
    const encoded = query.cursor;
    if (typeof encoded !== 'string' || encoded.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(encoded)) invalid();
    try {
      const bytes = Buffer.from(encoded, 'base64url');
      if (bytes.toString('base64url') !== encoded) invalid();
      cursor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (_error) { invalid(); }
    const keys = ['version', 'state', 'scopeDigest', 'dataDigest', 'cutoff', 'lastCreatedAt', 'lastId'];
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).length !== keys.length ||
        Object.keys(cursor).some(key => !keys.includes(key)) || cursor.version !== 'm23-part9b-cursor-v1' ||
        cursor.state !== state || typeof cursor.scopeDigest !== 'string' || !HASH.test(cursor.scopeDigest) ||
        typeof cursor.dataDigest !== 'string' || !HASH.test(cursor.dataDigest) ||
        typeof cursor.lastId !== 'string' || !UUID.test(cursor.lastId)) invalid();
    for (const field of ['cutoff', 'lastCreatedAt']) {
      if (typeof cursor[field] !== 'string' || !INSTANT.test(cursor[field]) ||
          !Number.isFinite(Date.parse(cursor[field])) || /T24:|:60(?:\.|Z)/.test(cursor[field])) invalid();
    }
    if (Date.parse(cursor.lastCreatedAt) > Date.parse(cursor.cutoff)) invalid();
  }
  return { state, limit, cursor };
}

function validateOverviewResponse(value, role, query) {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024) throw new Error('OVERSIZE');
    presentation.validate(value);
    if (role !== undefined && value.scope !== (['owner', 'admin'].includes(role) ? 'owner_admin' : 'dispatcher_coordination')) {
      throw new Error('SCOPE_MISMATCH');
    }
    if (query && (value.filter !== query.state || value.pagination.limit !== query.limit ||
        query.cursor && (value.dataDigest !== query.cursor.dataDigest || value.evaluatedAt !== query.cursor.cutoff))) {
      throw new Error('REQUESTED_SNAPSHOT_MISMATCH');
    }
    return value;
  } catch (_error) { throw overviewError(503, 'OPERATIONAL_OVERVIEW_UNAVAILABLE'); }
}

module.exports = { normalizeOverviewRead, validateOverviewResponse, overviewError };
