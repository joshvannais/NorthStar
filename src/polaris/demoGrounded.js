'use strict';
const c = require('./groundedConversation');
const { createIdempotencyRegistry } = require('./assistantRuntime');
const registry = createIdempotencyRegistry();
function fail(code, message, statusCode) { throw Object.assign(new Error(message), { code, statusCode }); }
function createHandler({ boundary, getToken, repository, loadContext, getPool, sourceHash }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.vary('Cookie');
    if (!boundary(req, res, 'polaris-conversation')) return;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000); timer.unref?.();
    const abort = () => { if (!res.writableEnded) controller.abort(); }; req.once('aborted', abort); res.once('close', abort);
    try {
      const request = c.validateRequest(req.body), token = getToken(req, res);
      const runtime = req.app.locals.demoGroundedRuntime;
      if (!require('./connectedPolicy').generationEnabled) fail('POLARIS_GENERATION_PAUSED', 'New conversations are paused. Your saved demo records remain available.', 503);
      if (!runtime || runtime.kind !== 'openai') fail('POLARIS_CREDENTIAL_DISABLED', 'AI conversation is not connected in this demo. You can still review its saved estimates and scenarios.', 503);
      const current = async () => {
        if (!repository.token(token.token)) fail('POLARIS_DEMO_EXPIRED', 'This demo session expired. Refresh to start again.', 410);
        const record = await repository.read(token);
        return loadContext(record, request);
      };
      const before = await current(), basis = c.digest(before), fingerprint = c.digest({ request, basis });
      const envelope = { purpose: 'grounded_conversation', schemaVersion: c.VERSION, requestId: request.idempotencyKey,
        authority: before.authority, untrustedInput: { message: request.message, selected: request.selected }, groundedContext: before.groundedContext };
      runtime.preflight(envelope);
      const data = await registry.execute({ key: request.idempotencyKey, organizationId: before.authority.organizationId,
        userId: before.authority.userId, operation: 'polaris_message_v2', fingerprint }, async signal => {
        const row = (await getPool().query('SELECT public.demo_polaris_provider_reserve($1,$2,$3,$4,$5,$6,$7) result',
          [token.tenantId, token.tokenHash, request.idempotencyKey, fingerprint, basis, token.expiresAt, sourceHash(req)])).rows[0].result;
        if (!row.admitted) {
          if (row.replay) fail('POLARIS_DEMO_RESULT_UNAVAILABLE', 'This conversation request was already recorded. Its answer is unavailable; check the selected record before starting a new question.', 409);
          if (row.reason === 'session_limit') fail('POLARIS_DEMO_SESSION_LIMIT', 'This demo session has used its conversation allowance. Your saved records and scenarios remain available.', 429);
          fail('POLARIS_RATE_LIMIT', 'Demo conversation is temporarily busy or at its usage limit. Please try later.', 429);
        }
        const reconcile = usage => getPool().query('SELECT public.demo_polaris_provider_reconcile($1,$2,$3)', [row.id, token.tokenHash, require('./providerAccounting').reconciliationUsage(usage)]);
        try {
          const result = await runtime.respond(envelope, { signal, revalidate: async () => {
            if (!require('./connectedPolicy').generationEnabled || c.digest(await current()) !== basis) fail('POLARIS_CONTEXT_CHANGED', 'The demo record changed. Refresh before asking again.', 409);
          } });
          await reconcile(result.usage);
          if (c.digest(await current()) !== basis) fail('POLARIS_CONTEXT_CHANGED', 'The demo record changed. Refresh before asking again.', 409);
          return { ...result.response, simulated: true, contextLabel: 'AI Guidance Using Simulated Job Records' };
        } catch (error) { if (error.polarisUsage) await reconcile(error.polarisUsage); throw error; }
      }, { signal: controller.signal });
      if (!require('./connectedPolicy').generationEnabled) fail('POLARIS_GENERATION_PAUSED', 'New conversations are paused. Your saved demo records remain available.', 503);
      if (c.digest(await current()) !== basis) fail('POLARIS_CONTEXT_CHANGED', 'The demo record changed. Refresh before asking again.', 409);
      return res.json({ success: true, data });
    } catch (error) {
      if(error.constraint==='demo_polaris_expired')error=Object.assign(new Error('This demo session expired. Refresh before asking again.'),{code:'POLARIS_DEMO_EXPIRED',statusCode:410});
      else if(['demo_polaris_changed','demo_polaris_request_changed'].includes(error.constraint))error=Object.assign(new Error('The demo or this question changed. Refresh its current details before asking again.'),{code:'POLARIS_CONTEXT_CHANGED',statusCode:409});
      error=require('./groundedErrors').present(error);
      const known = typeof error.code === 'string' && error.code.startsWith('POLARIS_');
      const status = [400,401,403,404,409,410,413,422,429,502,503,504].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ success: false, error: { code: known ? error.code : 'POLARIS_DEMO_UNAVAILABLE',
        message: known ? error.message : 'Demo conversation could not be completed. Your saved records remain available.' } });
    } finally { clearTimeout(timer); req.removeListener('aborted', abort); res.removeListener('close', abort); }
  };
}
module.exports = { createHandler };
