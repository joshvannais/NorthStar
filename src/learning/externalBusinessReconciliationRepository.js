'use strict';

const presentation = require('../../public/js/learning-center-contract');

function mapped(error) {
  const result = Object.assign(new Error('External business reference review is temporarily unavailable.'), { code: 'M25_BUSINESS_MATCH_UNAVAILABLE', status: 503, cause: error });
  const constraint = String(error && error.constraint || '');
  if (error && error.code === '42501') Object.assign(result, { code: 'M25_BUSINESS_MATCH_FORBIDDEN', status: 403, message: 'External business reference review is restricted to current owners and administrators.' });
  else if (error && error.code === '40001') Object.assign(result, { code: 'M25_BUSINESS_MATCH_CHANGED', status: 409, message: constraint.includes('source') ? 'The imported business evidence changed. Refresh before linking it.' : constraint.includes('target') ? 'The NorthStar record changed. Refresh before linking it.' : 'The reference match changed. Refresh before continuing.' });
  else if (error && error.code === '23505') Object.assign(result, { code: 'M25_BUSINESS_MATCH_KEY_CONFLICT', status: 409, message: 'That request key was already used for a different reference match.' });
  else if (error && error.code === '22023') Object.assign(result, { code: 'M25_BUSINESS_MATCH_INPUT_INVALID', status: 400, message: 'External business reference match details are invalid.' });
  return result;
}
async function tx(pool, isolation, work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try { await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); await client.query("SET LOCAL statement_timeout='5000ms'"); await client.query("SET LOCAL lock_timeout='2000ms'"); await client.query('SET LOCAL search_path=pg_catalog,public'); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); if (error && ['40001','23505'].includes(error.code) && attempt < 2) continue; throw mapped(error); }
    finally { client.release(); }
  }
  throw mapped(Object.assign(new Error('External business reference review changed.'), { code: '40001' }));
}
const actor = input => [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId];
function safeUnique(values, identity) {
  const candidates = (Array.isArray(values) ? values : []).flatMap(value => {
    if (!value || typeof value !== 'object' || typeof value[identity] !== 'string') return [];
    const displayLabel = presentation.safeLabel(value.displayLabel || value.label);
    return displayLabel ? [{ ...value, displayLabel, label: undefined }] : [];
  });
  const counts = new Map(); candidates.forEach(value => counts.set(value.displayLabel, (counts.get(value.displayLabel) || 0) + 1));
  return candidates.filter(value => counts.get(value.displayLabel) === 1);
}
const readMatches = (pool,input) => tx(pool,'REPEATABLE READ READ ONLY',async client => {
  const value = (await client.query('SELECT public.canonical_external_business_reference_matches_read($1,$2,$3,$4,$5,$6) value',[...actor(input),input.sourceClass,input.sourceKey])).rows[0].value;
  if (!value || value.activeConsent !== true) return value;
  const labels = (await client.query('SELECT public.canonical_learning_reconciliation_target_labels_read($1,$2,$3,$4) value',actor(input))).rows[0].value;
  value.customerTargets = safeUnique(value.customerTargets,'targetId');
  const jobLabels = new Map((labels.jobTargets || []).map(target => [target.targetId,presentation.safeLabel(target.displayLabel)]));
  value.estimateTargets = safeUnique((value.estimateTargets || []).flatMap(target => jobLabels.get(target.targetId) ? [{ ...target,displayLabel:jobLabels.get(target.targetId) }] : []),'targetId');
  value.executionTargets = safeUnique(value.executionTargets,'targetId');
  value.presentationBoundary = 'Only safe, distinct company labels are shown. Ambiguous choices require clearer company records.';
  return value;
});
const mutateMatch = (pool,input) => tx(pool,'SERIALIZABLE',async client => (await client.query('SELECT public.canonical_external_business_reference_match_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) value',[...actor(input),input.csrfToken,input.idempotencyKey,input.sourceClass,input.sourceKey,JSON.stringify(input.body)])).rows[0].value);

module.exports = { mapped, mutateMatch, readMatches, safeUnique };
