'use strict';

const TARGET_KEYS = Object.freeze(['workerTargets', 'jobTargets', 'vehicleTargets', 'equipmentTargets']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const OBJECT_MARKER = /object[\s:_-]*object/i;
const CONTACT_NUMBER = /(?:^|[^0-9])(?:\+?[0-9][() ./-]*){10,15}(?:$|[^0-9])/;
const INTERNAL_HEX = /(?:^|[^0-9a-f])[0-9a-f]{32,}(?:$|[^0-9a-f])/i;
const PREFIXED_INTERNAL = /(?:digest|checksum|hash)[\s:=_-]+[A-Za-z0-9/+_-]{16,}|(?:db|database|record|request|internal)[\s._-]*(?:id|identifier)[\s:#=_-]+[A-Za-z0-9._:-]{6,}/i;
const INVISIBLE = /[\u0080-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
const DASH_VARIANTS = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

function normalizeDisplayLabel(value) {
  if (typeof value !== 'string') return null;
  return value.normalize('NFKC').replace(DASH_VARIANTS, '-').trim().replace(/\s+/gu, ' ');
}

function safeDisplayLabel(value) {
  const label = normalizeDisplayLabel(value);
  if (!label || Array.from(label).length > 240 || /[\u0000-\u001f\u007f]/.test(label) || INVISIBLE.test(label) || OBJECT_MARKER.test(label) ||
    UUID.test(label) || CONTACT_NUMBER.test(label) || INTERNAL_HEX.test(label) || PREFIXED_INTERNAL.test(label) || label.includes('@')) return null;
  return label;
}

function applyTargetLabels(matches, labels) {
  const result = { ...matches };
  const rejected = {};
  for (const key of TARGET_KEYS) {
    if (!Array.isArray(matches[key])) continue;
    const candidates = Array.isArray(labels[key]) ? labels[key] : [];
    const normalized = candidates.map(value => [value.targetId, safeDisplayLabel(value.displayLabel)]);
    const counts = new Map();
    normalized.forEach(([, label]) => { if (label !== null) counts.set(label, (counts.get(label) || 0) + 1); });
    const safe = new Map(normalized.filter(([, label]) => label !== null && counts.get(label) === 1));
    rejected[key] = candidates.length - safe.size;
    result[key] = matches[key].filter(value => safe.has(value.targetId)).map(value => ({ ...value, displayLabel: safe.get(value.targetId) }));
  }
  result.targetPresentationBoundary = labels.presentationBoundary;
  for (const kind of ['worker', 'job', 'vehicle', 'equipment']) {
    const key = `${kind}UnavailableTotal`;
    if (Number.isSafeInteger(Number(labels[key]))) result[key] = Number(labels[key]) + (rejected[`${kind}Targets`] || 0);
  }
  return result;
}

async function readTargetLabels(client, input) {
  const value = (await client.query(
    'SELECT public.canonical_learning_reconciliation_target_labels_read($1,$2,$3,$4) value',
    [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId]
  )).rows[0].value;
  return value;
}

module.exports = { applyTargetLabels, normalizeDisplayLabel, readTargetLabels, safeDisplayLabel };
