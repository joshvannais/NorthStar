'use strict';

const VERSION = 'm23-progress-facts-v1';
const UNIT_VERSION = 'm23-progress-units-v1';
const UNITS = ['ea','m','m2','m3','ft','ft2','ft3','yd3','kg','lb','l','gal'];
const ACTIONS = ['record_progress','update_progress','record_blocker','record_exception','record_change','issue_state','correct','review'];
const REVISION_ACTIONS = ['update_progress','issue_state','correct','review'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;
function fail(status = 400, code = 'INVALID_PROGRESS_REQUEST') {
  const error = new Error('Operational progress evidence is invalid or unavailable.');
  Object.assign(error, { status, statusCode: status, code }); throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k))) fail();
  return value;
}
function one(value, choices) { if (!choices.includes(value)) fail(); return value; }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value; }
function hash(value) { if (typeof value !== 'string' || !HASH.test(value)) fail(); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) fail(); return value; }
function text(value, maximum = 1000) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value !== value.normalize('NFC') ||
    Array.from(value).length > maximum || Buffer.byteLength(value, 'utf8') > maximum * 4 ||
    /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f-\u1160\u17b4-\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ud800-\udfff\ufeff\uffa0\ufff9-\ufffd\u{e0000}-\u{e007f}<>]/u.test(value) ||
    /(?:https?:\/\/|data:|javascript:|www\.)/iu.test(value)) fail();
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  return value;
}
function pin(value) { exact(value, ['id','revision','digest']); return { id: uuid(value.id), revision: revision(value.revision), digest: hash(value.digest) }; }
function pins(value, required = false) {
  if (!Array.isArray(value) || value.length > 20 || required && value.length === 0) fail();
  const result = value.map(pin); if (new Set(result.map(p => p.id)).size !== result.length) fail(); return result;
}
function zone(value) {
  exact(value, ['businessProfileId','version','hash','timeZone']);
  text(value.timeZone, 100); try { new Intl.DateTimeFormat('en-US', {timeZone:value.timeZone}); } catch (_) { fail(); }
  return { businessProfileId:uuid(value.businessProfileId), version:revision(value.version), hash:hash(value.hash), timeZone:value.timeZone };
}
function quantity(value) {
  if (value === null) return null;
  exact(value, ['completed','total','unit']);
  if (typeof value.completed !== 'string' || typeof value.total !== 'string' || !DECIMAL.test(value.completed) || !DECIMAL.test(value.total)) fail();
  const number = s => { const [a,b=''] = s.split('.'); return BigInt(a)*1000000n + BigInt(b.padEnd(6,'0')); };
  if (number(value.total) === 0n || number(value.completed) > number(value.total)) fail();
  return { completed:value.completed, total:value.total, unit:one(value.unit,UNITS), contractVersion:UNIT_VERSION };
}
function resolution(value) {
  if (value === null) return null;
  exact(value, ['description','observedAt','evidence']);
  return { description:text(value.description), observedAt:instant(value.observedAt), evidence:pins(value.evidence,true) };
}
function document(value) {
  const common = ['kind','description','observedAt','timeZoneAuthority','evidence'];
  const fields = { progress:['workKey','quantity','milestone','uncertainty','uncertaintyReason'],
    blocker:['category','impact','severity','followUp','state','resolution'], exception:['category','impact','severity','followUp','state','resolution'],
    field_change:['difference','initiator','affectedWork','scheduleImplications','resourceImplications'] };
  if (!value || !Object.hasOwn(fields,value.kind)) fail(); exact(value, [...common,...fields[value.kind]]);
  const result = { kind:value.kind, description:text(value.description), observedAt:instant(value.observedAt),
    timeZoneAuthority:zone(value.timeZoneAuthority), evidence:pins(value.evidence), contractVersion:VERSION, reviewState:'needs_review' };
  if (value.kind === 'progress') {
    if (typeof value.workKey !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value.workKey)) fail();
    let milestone = null;
    if (value.milestone !== null) {
      exact(value.milestone, ['key','state','checklist']); text(value.milestone.key,64);
      milestone = { key:value.milestone.key, state:one(value.milestone.state,['not_started','in_progress','done','unavailable']),
        checklist:value.milestone.checklist === null ? null : pin(value.milestone.checklist) };
    }
    const q = quantity(value.quantity), uncertainty = one(value.uncertainty,['measured','estimated','unknown']);
    if (!q && !milestone || uncertainty === 'unknown' && (q || milestone.state !== 'unavailable')) fail();
    const uncertaintyReason = value.uncertaintyReason === null ? null : text(value.uncertaintyReason);
    if (uncertainty !== 'measured' && !uncertaintyReason) fail();
    Object.assign(result, {workKey:value.workKey,quantity:q,milestone,uncertainty,uncertaintyReason});
  } else if (['blocker','exception'].includes(value.kind)) {
    exact(value.followUp,['profileId','action']);
    Object.assign(result, { category:one(value.category,['access','weather','material','equipment','scope','quality','coordination','other']),
      impact:one(value.impact,['prevents_work','constrains_work','no_current_constraint','unknown']),
      severity:one(value.severity,['low','moderate','high','unknown']),followUp:{profileId:uuid(value.followUp.profileId),action:text(value.followUp.action)},
      state:one(value.state,['open','investigating','awaiting_follow_up','resolved']),resolution:resolution(value.resolution) });
    if ((result.state === 'resolved') !== (result.resolution !== null)) fail();
  } else {
    exact(value.initiator,['source','description']);
    Object.assign(result, { difference:one(value.difference,['requested','observed']),
      initiator:{source:one(value.initiator.source,['worker','owner','customer_reported','other_reported','unknown']),description:text(value.initiator.description)},
      affectedWork:text(value.affectedWork),scheduleImplications:text(value.scheduleImplications),resourceImplications:text(value.resourceImplications) });
  }
  if (Buffer.byteLength(JSON.stringify(result),'utf8') > 12000) fail(413);
  return result;
}
function normalizeProgressAction(input) {
  const body = input && input.body;
  if (!body || !ACTIONS.includes(body.action)) fail();
  const required=['action','performerProfileId','expectedExecutionRevision','expectedExecutionDigest','expectedAssignmentRevision','expectedAssignmentDigest','reason','document'];
  if (required.some(k => !Object.hasOwn(body,k) || body[k] === null)) fail(428,'PROGRESS_PRECONDITION_REQUIRED');
  const updating=REVISION_ACTIONS.includes(body.action);
  exact(body,[...required,...(updating?['recordId','expectedRecordRevision','expectedRecordDigest']:[])]);
  let doc;
  if(body.action==='review'){exact(body.document,['outcome']);doc={outcome:one(body.document.outcome,['owner_confirmed','worker_acknowledged','disputed','needs_review'])};}
  else if(body.action==='issue_state') {exact(body.document,['state','resolution']);doc={state:one(body.document.state,['open','investigating','awaiting_follow_up','resolved']),resolution:resolution(body.document.resolution)};if((doc.state==='resolved')!==(doc.resolution!==null))fail();}
  else doc=document(body.document);
  const createKind={record_progress:'progress',record_blocker:'blocker',record_exception:'exception',record_change:'field_change',update_progress:'progress'};
  if(createKind[body.action] && createKind[body.action]!==doc.kind)fail();
  if(['record_blocker','record_exception'].includes(body.action) && doc.state!=='open')fail();
  if(typeof input.idempotencyKey!=='string'||!/^[!-~]{16,128}$/.test(input.idempotencyKey))fail();
  return {organizationId:uuid(input.organizationId),actorUserId:uuid(input.actorUserId),actorAccessRole:input.actorAccessRole,authSessionId:uuid(input.authSessionId),
    executionId:uuid(input.executionId),action:body.action,performerProfileId:uuid(body.performerProfileId),
    recordId:updating?uuid(body.recordId):null,expectedRecordRevision:updating?revision(body.expectedRecordRevision):null,expectedRecordDigest:updating?hash(body.expectedRecordDigest):null,
    expectedExecutionRevision:revision(body.expectedExecutionRevision),expectedExecutionDigest:hash(body.expectedExecutionDigest),
    expectedAssignmentRevision:revision(body.expectedAssignmentRevision),expectedAssignmentDigest:hash(body.expectedAssignmentDigest),
    document:doc,reason:text(body.reason),idempotencyKey:input.idempotencyKey};
}
function normalizeProgressRead(query) {
  if (!query || typeof query !== 'object' || Object.keys(query).some(k=>!['limit','cursor'].includes(k))) fail();
  let limit=50,cursor=null;
  if(Object.hasOwn(query,'limit')){if(typeof query.limit!=='string'||!/^(?:[1-9][0-9]?|1[0-9]{2}|200)$/.test(query.limit))fail();limit=Number(query.limit);}
  if(Object.hasOwn(query,'cursor')) {
    if(typeof query.cursor!=='string'||query.cursor.length>1024||!/^[A-Za-z0-9_-]+$/.test(query.cursor))fail();
    try {cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));} catch(_){fail();}
    exact(cursor,['executionId','cutoff','lastTime','lastId']);uuid(cursor.executionId);instant(cursor.cutoff);instant(cursor.lastTime);uuid(cursor.lastId);
  }
  return {limit,cursor};
}
module.exports={normalizeProgressAction,normalizeProgressRead,VERSION,UNIT_VERSION};
