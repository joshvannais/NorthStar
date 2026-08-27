'use strict';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXACT_GRAPH_CURSOR_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/;
const MAXIMUM_GRAPH_CURSOR_CHARACTERS = 512;

function invalidGraphCursor() {
  const error = new Error('Invalid canonical pagination cursor.');
  error.code = 'INVALID_CURSOR';
  error.status = 400;
  error.statusCode = 400;
  throw error;
}

function leapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function exactCursorTime(value) {
  if (typeof value !== 'string') return false;
  const match = EXACT_GRAPH_CURSOR_TIME.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const monthDays = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= monthDays[month - 1];
}

function canonicalPayload(createdAt, operationId) {
  return Buffer.from(JSON.stringify({ createdAt, operationId }), 'utf8').toString('base64url');
}

function validateGraphCursor(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAXIMUM_GRAPH_CURSOR_CHARACTERS ||
      raw !== raw.trim() || !/^[A-Za-z0-9_-]+$/.test(raw)) invalidGraphCursor();
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.length === 0 || bytes.toString('base64url') !== raw) invalidGraphCursor();
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'createdAt,operationId' ||
        typeof parsed.operationId !== 'string' || !CANONICAL_UUID.test(parsed.operationId) ||
        !exactCursorTime(parsed.createdAt) || canonicalPayload(parsed.createdAt, parsed.operationId) !== raw) {
      invalidGraphCursor();
    }
    return Object.freeze({ raw, createdAt: parsed.createdAt, operationId: parsed.operationId });
  } catch (error) {
    if (error && error.code === 'INVALID_CURSOR') throw error;
    return invalidGraphCursor();
  }
}

function encodeGraphCursor(item) {
  const createdAt = item && item._paginationCreatedAt;
  const operationId = item && item.ids && item.ids.operation;
  if (!exactCursorTime(createdAt) || typeof operationId !== 'string' || !CANONICAL_UUID.test(operationId)) {
    invalidGraphCursor();
  }
  return canonicalPayload(createdAt, operationId);
}

module.exports = {
  MAXIMUM_GRAPH_CURSOR_CHARACTERS,
  encodeGraphCursor,
  exactCursorTime,
  validateGraphCursor,
};
