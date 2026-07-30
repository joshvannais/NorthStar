'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const ACCESS_COOKIE = 'northstar_access';
const REFRESH_COOKIE = 'northstar_refresh';
const CSRF_COOKIE = 'northstar_csrf';
const testSecret = process.env.NODE_ENV === 'test' ? crypto.randomBytes(48).toString('hex') : null;

function accessSecret() {
  const secret = config.auth.accessSecret || testSecret;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AUTH_ACCESS_SECRET is unavailable or too short');
  }
  return secret;
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function rateLimitKey(eventType, value) {
  return crypto.createHmac('sha256', accessSecret()).update(`${eventType}:${String(value)}`, 'utf8').digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function accessExpiry(now = Date.now()) {
  return new Date(now + config.auth.accessMinutes * 60 * 1000);
}

function refreshExpiry(now = Date.now()) {
  return new Date(now + config.auth.refreshDays * 24 * 60 * 60 * 1000);
}

function signAccess(userId, sessionId) {
  return jwt.sign(
    { sub: userId, sid: sessionId, typ: 'access' },
    accessSecret(),
    { expiresIn: `${config.auth.accessMinutes}m`, issuer: 'northstar', audience: 'northstar-browser' }
  );
}

function signApiCompatibility(user) {
  return jwt.sign(
    { sub: user.id, typ: 'api_compat', role: 'contractor' },
    accessSecret(),
    { expiresIn: `${config.auth.accessMinutes}m`, issuer: 'northstar', audience: 'northstar-api' }
  );
}

function verifyAccess(token, options = {}) {
  const decoded = jwt.verify(token, accessSecret(), {
    ignoreExpiration: Boolean(options.ignoreExpiration),
    issuer: 'northstar',
  });
  if (!decoded || !decoded.sub || !decoded.typ) throw new Error('invalid access token claims');
  return decoded;
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try { result[name] = decodeURIComponent(raw); } catch (_error) { result[name] = raw; }
  }
  return result;
}

function cookieOptions(httpOnly, maxAge) {
  return {
    httpOnly,
    secure: config.auth.secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

function issueCookies(res, material) {
  const accessMaxAge = Math.max(0, material.accessExpiresAt.getTime() - Date.now());
  const refreshMaxAge = Math.max(0, material.refreshExpiresAt.getTime() - Date.now());
  res.cookie(ACCESS_COOKIE, material.accessToken, cookieOptions(true, accessMaxAge));
  res.cookie(REFRESH_COOKIE, material.refreshToken, cookieOptions(true, refreshMaxAge));
  res.cookie(CSRF_COOKIE, material.csrfToken, cookieOptions(false, refreshMaxAge));
}

function clearCookies(res) {
  const base = { secure: config.auth.secureCookies, sameSite: 'lax', path: '/' };
  res.clearCookie(ACCESS_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

module.exports = {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  JWT_SECRET: config.auth.accessSecret || testSecret,
  REFRESH_COOKIE,
  accessExpiry,
  clearCookies,
  hashToken,
  issueCookies,
  parseCookies,
  randomToken,
  rateLimitKey,
  refreshExpiry,
  safeEqual,
  signAccess,
  signApiCompatibility,
  verifyAccess,
};
