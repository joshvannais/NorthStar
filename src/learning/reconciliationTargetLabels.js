'use strict';

const TARGET_KEYS = Object.freeze(['workerTargets', 'jobTargets', 'vehicleTargets', 'equipmentTargets']);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CONTACT_NUMBER = /(?:^|[^0-9])(?:\+1[ .-]?)?\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}(?:$|[^0-9])|(?:^|[^0-9])[0-9]{10,15}(?:$|[^0-9])/;
const INTERNAL_HEX = /(?:^|[^0-9a-f])[0-9a-f]{32,}(?:$|[^0-9a-f])/i;
const PREFIXED_INTERNAL = /(?:digest|checksum|hash)[\s:=_-]+[A-Za-z0-9/+_-]{16,}|(?:request|record|database)[\s_-]*(?:id|identifier)[\s:#=_-]+[A-Za-z0-9._:-]{6,}/i;

function safeDisplayLabel(value) {
  if (typeof value !== 'string') return null;
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label || label.length > 240 || /[\u0000-\u001f\u007f]/.test(label) || /object[\s_-]*object/i.test(label) ||
    UUID.test(label) || CONTACT_NUMBER.test(label) || INTERNAL_HEX.test(label) || PREFIXED_INTERNAL.test(label) || label.includes('@')) return null;
  return label;
}

function applyTargetLabels(matches, labels) {
  const result = { ...matches };
  const rejected = {};
  for (const key of TARGET_KEYS) {
    if (!Array.isArray(matches[key])) continue;
    const candidates = Array.isArray(labels[key]) ? labels[key] : [];
    const safe = new Map(candidates.map(value => [value.targetId, safeDisplayLabel(value.displayLabel)])
      .filter(value => value[1] !== null));
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

module.exports = { applyTargetLabels, readTargetLabels, safeDisplayLabel };
