'use strict';

function invalid(message = 'Work profile input is invalid.') {
  return Object.assign(new Error(message), { status: 400, code: 'WORK_PROFILE_INVALID' });
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || Buffer.byteLength(value) > max * 4 ||
      (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid();
  return value;
}
function list(value, max, normalize) {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  const result = value.map(normalize);
  if (new Set(result.map(item => typeof item === 'string' ? item.toLowerCase().trim() : item.id)).size !== result.length) throw invalid();
  return result;
}
function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) throw invalid('Use a document or record reference, not a link or file path.');
  return value;
}
function certificate(value) {
  exact(value, ['id','name','issuer','expiresOn','documentReference']);
  key(value.id); text(value.name, 120, true); text(value.issuer, 120, true);
  if (value.expiresOn !== null && (typeof value.expiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.expiresOn) ||
      !Number.isFinite(Date.parse(value.expiresOn)) || new Date(value.expiresOn).toISOString().slice(0,10) !== value.expiresOn)) throw invalid('Certification expiry must be a valid date.');
  if (value.documentReference !== null) key(value.documentReference);
  return value;
}
function normalizeAction(body, now = Date.now()) {
  const shapes = {
    submit: ['action','expectedRevision','profile'],
    approve: ['action','expectedRevision','reason','verifiedCertificationIds'],
    reject: ['action','expectedRevision','reason'], revoke: ['action','expectedRevision','reason'],
    availability: ['action','expectedRevision','availability'],
  };
  const shape = body && shapes[body.action];
  if (!shape) throw invalid();
  exact(body, shape);
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 1000000 ||
      Buffer.byteLength(JSON.stringify(body)) > 32768) throw invalid();
  if (body.action === 'submit') {
    exact(body.profile, ['title','summary','skills','certifications']);
    text(body.profile.title, 120, true); text(body.profile.summary, 2000);
    list(body.profile.skills, 20, value => text(value, 120, true));
    list(body.profile.certifications, 12, certificate);
  } else if (body.action === 'availability') {
    exact(body.availability, ['status','note','until']);
    if (!['available','limited','unavailable','not_shared'].includes(body.availability.status)) throw invalid();
    text(body.availability.note, 500);
    const until = body.availability.until;
    if (body.availability.status === 'not_shared') {
      if (until !== null || body.availability.note !== '') throw invalid();
    } else if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(until) ||
        !Number.isFinite(Date.parse(until)) || (now !== null && (Date.parse(until) <= now || Date.parse(until) > now + 7 * 86400000))) throw invalid('Availability must end within the next seven days.');
  } else {
    text(body.reason, 1000, true);
    if (body.action === 'approve') list(body.verifiedCertificationIds, 12, key);
  }
  return body;
}
function certificationState(cert, status, verifiedIds, today) {
  if (status === 'revoked') return 'revoked';
  if (cert.expiresOn && cert.expiresOn < today) return 'expired';
  return status === 'approved' && verifiedIds.includes(cert.id) ? 'verified' : 'unverified';
}
module.exports = { normalizeAction, certificationState, invalid };
