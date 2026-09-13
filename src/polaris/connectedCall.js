'use strict';

const { contractError } = require('./assistantContract');
const { digest, validatePayload } = require('./groundedConversation');
const FUNCTION_NAME = 'northstar_job_guidance';
function denied(message = 'Call guidance is unavailable for this call.', status = 403) {
  throw contractError('POLARIS_CALL_UNAVAILABLE', message, status);
}

// verifyRaw is the provider's raw-body signature verifier, never an account ID
// supplied by the call. loadCurrent resolves current integration ownership and
// exact agent/session identity and returns only caller-authorized published facts.
function createConnectedCallAdapter({ verifyRaw, loadCurrent, generate, record, readRecorded = async () => null, clock = Date.now }) {
  if ([verifyRaw, loadCurrent, generate, record].some(fn => typeof fn !== 'function')) throw new TypeError('Call guidance requires authenticated authority adapters.');
  return async function handle(rawBody, signature, { signal } = {}) {
    const check = () => { if(signal?.aborted) denied('Call guidance timed out. Ask the owner to review the details.',503); };
    check();
    if (!Buffer.isBuffer(rawBody) || rawBody.length > 65536 || !await verifyRaw(rawBody, signature)) denied();
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch (_) { denied('The call request could not be read.', 400); }
    if (!body || body.name !== FUNCTION_NAME || !body.call || typeof body.call.call_id !== 'string' ||
        body.call.call_id.length > 255 || !body.call.call_id || typeof body.call.agent_id !== 'string' ||
        !body.call.agent_id || body.call.agent_id.length > 255 || !body.args ||
        Object.keys(body.args).join('|') !== 'question' || typeof body.args.question !== 'string' ||
        !body.args.question.trim() || body.args.question.length > 1500) denied('The call request is incomplete.', 400);
    const identity = Object.freeze({ callId: body.call.call_id, agentId: body.call.agent_id });
    // Ignore caller-supplied tenant, customer, graph, permissions and transcript
    // authority. The canonical session supplies those associations.
    const before = await loadCurrent(identity);check();
    if (!before || before.callId !== identity.callId || before.agentId !== identity.agentId ||
        before.audience !== 'caller' || before.expiresAt <= clock() || before.state !== 'active') denied();
    const basis = digest(before);
    const key = digest({ identity, question: body.args.question, basis });
    const cached = await readRecorded({identity,key,basis});check();
    const raw = cached ? {questions:cached.questions,explanations:cached.explanations,proposalIds:[],requestedCard:'none'} : await generate({ question: body.args.question, context: before, signal });
    check();
    const answer = validatePayload(raw, {
      groundedContext: { evidence: before.evidence, proposals: [], allowedCards: [] },
    });
    const after = await loadCurrent(identity);check();
    if (!after || after.expiresAt <= clock() || digest(after) !== basis) {
      denied('The call details changed. Check the current details before continuing.', 409);
    }
    const response = {
      status: 'provisional', questions: answer.questions, explanations: answer.explanations,
      sourceReferences: before.evidence.filter(e => [...answer.questions, ...answer.explanations].some(item => item.evidenceIds.includes(e.id))),
      ownerReviewRequired: true, bookingConfirmed: false, priceApproved: false,
    };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 12000) denied('Call guidance is too long. Ask one question at a time.', 413);
    // record must recheck the same basis under the existing voice-session lock.
    // An immutable receipt is not permission to return revoked knowledge later.
    check();await record({ identity, key, basis, requestDigest: digest(body.args), response });
    check();
    return response;
  };
}

module.exports = { FUNCTION_NAME, createConnectedCallAdapter };
