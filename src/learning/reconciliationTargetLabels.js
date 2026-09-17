'use strict';

const TARGET_KEYS = Object.freeze(['workerTargets', 'jobTargets', 'vehicleTargets', 'equipmentTargets']);

function applyTargetLabels(matches, labels) {
  const result = { ...matches };
  for (const key of TARGET_KEYS) {
    if (!Array.isArray(matches[key])) continue;
    const safe = new Map((Array.isArray(labels[key]) ? labels[key] : []).map(value => [value.targetId, value.displayLabel]));
    result[key] = matches[key].filter(value => safe.has(value.targetId)).map(value => ({ ...value, displayLabel: safe.get(value.targetId) }));
  }
  result.targetPresentationBoundary = labels.presentationBoundary;
  for (const kind of ['worker', 'job', 'vehicle', 'equipment']) {
    const key = `${kind}UnavailableTotal`;
    if (Number.isSafeInteger(Number(labels[key]))) result[key] = Number(labels[key]);
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

module.exports = { applyTargetLabels, readTargetLabels };
