'use strict';
const presentation = require('../../public/js/learning-center-contract');
function mapped(error) {
  const result = Object.assign(new Error('Material reference review is temporarily unavailable.'), { code: 'M25_MATERIAL_MATCH_UNAVAILABLE', status: 503, cause: error });
  const constraint = String(error && error.constraint || '');
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_MATERIAL_MATCH_FORBIDDEN', status: 403, message: 'Material reference review is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_MATERIAL_MATCH_CHANGED', status: 409, message: constraint.includes('source') ? 'The imported material evidence changed. Refresh before linking it.' : constraint.includes('target') ? 'The NorthStar record changed. Refresh before linking it.' : 'The material reference match changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_MATERIAL_MATCH_KEY_CONFLICT', status: 409, message: 'That request key was already used for a different material reference match.' });
  else if (error && error.code === '22023') Object.assign(result, { code: 'M25_MATERIAL_MATCH_INPUT_INVALID', status: 400, message: 'Material reference match details are invalid.' });
  return result;
}
async function tx(pool, isolation, work) { for (let attempt = 0; attempt < 3; attempt += 1) { const client = await pool.connect(); try { await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'"); await client.query('SET LOCAL search_path=pg_catalog,public'); const value = await work(client); await client.query('COMMIT'); return value; } catch (error) { await client.query('ROLLBACK').catch(() => {}); if (error && ['40001', '23505'].includes(error.code) && attempt < 2) continue; throw mapped(error); } finally { client.release(); } } throw mapped(Object.assign(new Error('Material reference match changed.'), { code: '40001' })); }
const actor = input => [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId];
function safeTargets(targets, identityField) {
  const candidates = (Array.isArray(targets) ? targets : []).flatMap(target => {
    if (!target || typeof target !== 'object') return [];
    const identity = target[identityField];
    const displayLabel = presentation.safeLabel(target.displayLabel || target.label);
    if (typeof identity !== 'string' || !identity || !displayLabel) return [];
    return [{ [identityField]: identity, displayLabel, digest: target.digest }];
  });
  const totals = new Map();
  candidates.forEach(target => totals.set(target.displayLabel, (totals.get(target.displayLabel) || 0) + 1));
  return candidates.filter(target => totals.get(target.displayLabel) === 1);
}
const readMatches = (pool, input) => tx(pool, 'REPEATABLE READ READ ONLY', async client => {
  const value = (await client.query('SELECT public.canonical_external_material_reference_matches_read($1,$2,$3,$4,$5) value', [...actor(input), input.sourceKey])).rows[0].value;
  if (!value || value.activeConsent !== true) return value;
  const labels = (await client.query('SELECT public.canonical_learning_reconciliation_target_labels_read($1,$2,$3,$4) value', actor(input))).rows[0].value;
  const originalJobs = new Map((value.jobTargets || []).map(target => [target.targetReference, target]));
  value.jobTargets = (labels.jobTargets || []).flatMap(target => {
    const original = originalJobs.get(target.targetId);
    return original ? [{ targetReference: target.targetId, displayLabel: target.displayLabel, digest: original.digest }] : [];
  });
  value.jobTargets = safeTargets(value.jobTargets, 'targetReference');
  value.materialTargets = safeTargets(value.materialTargets, 'targetReference');
  value.vendorTargets = safeTargets(value.vendorTargets, 'targetReference');
  value.inventoryLocationTargets = safeTargets(value.inventoryLocationTargets, 'targetReference');
  value.presentationBoundary = 'Only safe, distinct company labels are shown. Ambiguous or unsafe choices require clearer company records.';
  return value;
});
const mutateMatch = (pool, input) => tx(pool, 'SERIALIZABLE', async client => (await client.query('SELECT public.canonical_external_material_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value', [...actor(input), input.csrfToken, input.idempotencyKey, input.sourceKey, JSON.stringify(input.body)])).rows[0].value);
module.exports = { readMatches, mutateMatch, safeTargets };
