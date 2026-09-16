'use strict';

const importContract = require('./externalLaborImportContract');

const BODY_KEYS = ['cursorBefore', 'cursorAfter', 'complete', 'csvText', 'expectedConsentRevision', 'expectedConsentDigest'];
const HEADERS = ['externalRecordId', 'externalVersion', 'state', 'workerReference', 'jobReference', 'category',
  'observedStart', 'observedEnd', 'sourceUpdatedAt'];

function fail(message) {
  const error = new Error(message);
  error.code = 'M25_IMPORT_CSV_INVALID';
  error.status = 400;
  throw error;
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseRows(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 262144 || /\u0000/.test(value)) {
    fail('CSV file must contain at most 256 KB of text.');
  }
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') {
      if (field.length) fail('CSV quoting is invalid.');
      quoted = true;
    } else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
  }
  if (quoted) fail('CSV quoting is invalid.');
  row.push(field); rows.push(row);
  while (rows.length && rows[rows.length - 1].every(item => item === '')) rows.pop();
  return rows;
}

function normalizeCsvBackfill(sourceKey, body) {
  if (!exactObject(body, BODY_KEYS) || typeof body.complete !== 'boolean') fail('CSV backfill details are invalid.');
  const rows = parseRows(body.csvText);
  if (rows.length < 2 || rows.length > 101 || rows[0].length !== HEADERS.length ||
      !HEADERS.every((header, index) => rows[0][index] === header)) {
    fail('CSV must use the exact NorthStar labor header and contain 1 to 100 records.');
  }
  const records = rows.slice(1).map((columns, rowIndex) => {
    if (columns.length !== HEADERS.length) fail(`CSV row ${rowIndex + 2} has the wrong number of columns.`);
    const value = Object.fromEntries(HEADERS.map((header, index) => [header, columns[index]]));
    const tombstone = value.state === 'tombstone';
    return {
      externalRecordId: value.externalRecordId,
      externalVersion: Number(value.externalVersion),
      state: value.state,
      workerReference: tombstone && value.workerReference === '' ? null : value.workerReference,
      jobReference: tombstone && value.jobReference === '' ? null : value.jobReference,
      category: tombstone && value.category === '' ? null : value.category,
      observedStart: tombstone && value.observedStart === '' ? null : value.observedStart,
      observedEnd: tombstone && value.observedEnd === '' ? null : value.observedEnd,
      sourceUpdatedAt: value.sourceUpdatedAt,
    };
  });
  return importContract.normalizeBatch(sourceKey, {
    schemaVersion: 'm25-external-labor-time-v1', mode: 'historical_backfill',
    expectedConsentRevision: body.expectedConsentRevision, expectedConsentDigest: body.expectedConsentDigest,
    cursorBefore: body.cursorBefore, cursorAfter: body.cursorAfter, complete: body.complete, records,
    reason: 'Owner imported a reviewed CSV labor history page from the Learning Center.', confirmed: true,
    confirmationVersion: 'm25-external-labor-import-batch-v1',
  });
}

module.exports = { HEADERS, normalizeCsvBackfill };
