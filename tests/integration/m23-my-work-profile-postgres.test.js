'use strict';
const crypto = require('crypto');
const request = require('supertest');
const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
real('My Work Profile mounted PostgreSQL authority', () => {
  let fixture;
  beforeAll(async () => {
    for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
    jest.spyOn(require('https'),'request').mockImplementation(() => { throw new Error('External transport forbidden'); });
    fixture = await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
  },180000);
  afterAll(async () => { try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); } },180000);
  const profile = () => ({ title:'Service technician',summary:'Residential repair and clear handovers.',skills:['Fixture repair','Site preparation'],
    certifications:[{ id:'safety',name:'Safety training',issuer:'Example Training',expiresOn:'2099-09-09',documentReference:'CERT-014' }] });
  const target = actor => fixture.actors[actor].actorUserId;
  const get = (actor='member',reviewTarget=null,query='') => request(fixture.app).get('/api/work-profiles/' + (reviewTarget ? 'reviews/'+target(reviewTarget) : 'me') + query).set(fixture.actors[actor].session.headers);
  const send = (body,actor='member',reviewTarget=null,key=crypto.randomUUID()) => request(fixture.app).post('/api/work-profiles/' + (reviewTarget ? 'reviews/'+target(reviewTarget) : 'me'))
    .set(fixture.actors[actor].session.headers).set('Idempotency-Key',key).send(body);
  const current = async (actor='member') => { const result = await get(actor); expect(result.status).toBe(200); return result.body.data; };
  const submit = async () => {
    const before = await current();
    const result = await send({ action:'submit',expectedRevision:before.profile.revision,profile:profile() });
    expect(result.status).toBe(200); return (await current()).profile.revision;
  };
  test('starts empty, projects owner-assigned role separately and derives self editability', async () => {
    const data = await current(); expect(data.profile.status).toBe('empty');
    expect(data.person.operationalRole).toBe('technician'); expect(data.permissions.canSubmit).toBe(true);
    expect(data.permissions.canReview).toBe(false);
    expect((await current('viewer')).permissions.canSubmit).toBe(false);
    expect((await current('owner')).permissions.canSubmit).toBe(false);
  });
  test('authentication, CSRF and tenant/role isolation are enforced by mounted routes', async () => {
    expect((await request(fixture.app).get('/api/work-profiles/me')).status).toBe(401);
    for (const actor of ['member','dispatcher','viewer']) expect((await get(actor,'member')).status).toBe(403);
    expect((await get('otherOwner','member')).status).toBe(404);
    const body={ action:'submit',expectedRevision:0,profile:profile() };
    expect((await request(fixture.app).post('/api/work-profiles/me').set('Cookie',fixture.actors.member.session.headers.Cookie).set('Idempotency-Key',crypto.randomUUID()).send(body)).status).toBe(403);
    for (const actor of ['viewer','owner','admin']) expect((await send(body,actor)).status).toBe(403);
  });
  test('employee submits, owner approves exact version and certifications remain organization-reviewed only', async () => {
    const rev=await submit();
    expect((await current()).certifications[0].state).toBe('unverified');
    const approved=await send({ action:'approve',expectedRevision:rev,reason:'Checked the original training record',verifiedCertificationIds:['safety'] },'owner','member');
    expect(approved.status).toBe(200);
    const data=await current(); expect(data.profile.status).toBe('approved'); expect(data.certifications[0].state).toBe('verified');
    expect(data.person.operationalRole).toBe('technician'); expect(data.person.accessRole).toBe('member');
    expect(data.history[0].actorAccessRole).toBe('owner'); expect(data.history[1].action).toBe('submit');
  });
  test('same-key retry is durable and different requests cannot consume one revision twice', async () => {
    const revision=(await current()).profile.revision;
    const body={ action:'submit',expectedRevision:revision,profile:profile() },key=crypto.randomUUID();
    const responses=await Promise.all([send(body,'member',null,key),send(body,'member',null,key)]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect((await send({...body,profile:{...profile(),title:'Changed'}},'member',null,key)).status).toBe(409);
    const next={...body,expectedRevision:revision+1};
    const raced=await Promise.all([send(next),send(next)]);
    expect(raced.map(r=>r.status).sort()).toEqual([200,409]);
  });
  test('review transitions reject stale decisions, allow rejection/resubmission, and revoke approval durably', async () => {
    let revision=(await current()).profile.revision;
    expect((await send({action:'reject',expectedRevision:revision-1,reason:'Needs clarification'},'admin','member')).status).toBe(409);
    expect((await send({action:'reject',expectedRevision:revision,reason:'Please provide the current training record'},'admin','member')).status).toBe(200);
    revision=await submit();
    expect((await send({action:'approve',expectedRevision:revision,reason:'Reviewed the claim, evidence not verified',verifiedCertificationIds:[]},'admin','member')).status).toBe(200);
    expect((await current()).certifications[0].state).toBe('unverified');
    revision=(await current()).profile.revision;
    expect((await send({action:'revoke',expectedRevision:revision,reason:'Training record withdrawn'},'owner','member')).status).toBe(200);
    const data=await current(); expect(data.profile.status).toBe('revoked'); expect(data.certifications[0].state).toBe('revoked');
    expect(data.history.some(e=>e.status==='approved')).toBe(true);
  });
  test('expired evidence cannot be verified and safe references never grant document access', async () => {
    const body=profile(); body.certifications[0].expiresOn='2020-01-01';
    let revision=(await current()).profile.revision;
    expect((await send({action:'submit',expectedRevision:revision,profile:body})).status).toBe(200);
    revision=(await current()).profile.revision;
    expect((await current()).certifications[0].state).toBe('expired');
    expect((await send({action:'approve',expectedRevision:revision,reason:'Reviewed record',verifiedCertificationIds:['safety']},'owner','member')).status).toBe(400);
    expect((await send({action:'approve',expectedRevision:revision,reason:'Reviewed record',verifiedCertificationIds:['missing']},'owner','member')).status).toBe(400);
    body.certifications[0].documentReference='https://example.test/document';
    expect((await send({action:'submit',expectedRevision:revision,profile:body})).status).toBe(400);
  });
  test('current availability uses a separate revision and cannot change durable profile or schedule', async () => {
    const before=await current();
    const result=await send({action:'availability',expectedRevision:before.availability.revision,availability:{status:'limited',note:'Available after lunch',until:new Date(Date.now()+3600000).toISOString()}});
    expect(result.status).toBe(200);
    const after=await current(); expect(after.profile).toEqual(before.profile); expect(after.availability.status).toBe('limited');
    expect(after.availability.revision).toBe(before.availability.revision+1);
    expect((await send({action:'availability',expectedRevision:after.availability.revision,availability:{status:'not_shared',note:'',until:null}})).status).toBe(200);
    expect((await current()).availability.status).toBe('not_shared');
  });
  test('live subscription, session and membership revocation fail closed', async () => {
    const data=await current();
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1",[fixture.org]);
    try {
      expect((await current()).permissions.canSubmit).toBe(false);
      expect((await send({action:'submit',expectedRevision:data.profile.revision,profile:profile()})).status).toBe(403);
    } finally { await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1",[fixture.org]); }
    await fixture.ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='local test' WHERE id=$1",[fixture.actors.member.authSessionId]);
    try { expect((await get()).status).toBe(401); }
    finally { await fixture.ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1",[fixture.actors.member.authSessionId]); }
    await fixture.ownerPool.query("UPDATE organization_memberships SET status='suspended' WHERE id=$1",[target('member')]);
    try { expect((await get()).status).toBe(403); expect((await get('owner','member')).body.data.permissions.canReview).toBe(false); }
    finally { await fixture.ownerPool.query("UPDATE organization_memberships SET status='active' WHERE id=$1",[target('member')]); }
  });
  test('incomplete onboarding with an active business profile never advertises mutation capability', async () => {
    expect((await fixture.ownerPool.query('SELECT count(*)::int AS count FROM canonical_business_profiles WHERE organization_id=$1 AND is_active',[fixture.org])).rows[0].count).toBeGreaterThan(0);
    const completedAt=(await fixture.ownerPool.query('SELECT completed_at FROM organization_onboarding WHERE organization_id=$1',[fixture.org])).rows[0].completed_at;
    await fixture.ownerPool.query("UPDATE organization_onboarding SET status='business_profile_required',completed_at=NULL WHERE organization_id=$1",[fixture.org]);
    try {
      const employee=await current();
      const owner=await get('owner','member');
      expect(owner.status).toBe(200);
      for(const data of [employee,owner.body.data]){
        expect(data.permissions.canSubmit).toBe(false);
        expect(data.permissions.canReview).toBe(false);
        expect(data.permissions.readOnlyReason).toBe('subscription_or_onboarding_read_only');
      }
      expect((await send({action:'submit',expectedRevision:employee.profile.revision,profile:profile()})).status).toBe(403);
      expect((await send({action:'approve',expectedRevision:employee.profile.revision,reason:'Read-only onboarding',verifiedCertificationIds:[]},'owner','member')).status).toBe(403);
      expect((await current()).profile).toEqual(employee.profile);
    } finally { await fixture.ownerPool.query("UPDATE organization_onboarding SET status='complete',completed_at=$2 WHERE organization_id=$1",[fixture.org,completedAt]); }
  });
  test('runtime cannot read/change ledger directly; stored history rejects destructive mutation', async () => {
    for (const sql of ['SELECT * FROM canonical_work_profile_events','DELETE FROM canonical_work_profile_events','UPDATE canonical_work_profile_events SET reason=reason']) {
      await expect(fixture.runtimePool.query(sql)).rejects.toHaveProperty('code','42501');
    }
    await expect(fixture.ownerPool.query('UPDATE canonical_work_profile_events SET reason=reason')).rejects.toHaveProperty('code','42501');
    await expect(fixture.ownerPool.query('TRUNCATE canonical_work_profile_events')).rejects.toHaveProperty('code','42501');
  });
  test('direct guarded entry also rejects client authority, malformed claims and self review', async () => {
    const a=fixture.actors.member;
    const call=(body,actor=a,targetId=null)=>fixture.runtimePool.query('SELECT canonical_work_profile_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [actor.organizationId,actor.actorUserId,actor.actorAccessRole,actor.authSessionId,actor.csrfToken,targetId,crypto.randomUUID(),body]);
    await expect(call({action:'submit',expectedRevision:0,profile:profile(),accessRole:'owner'})).rejects.toHaveProperty('code','22023');
    await expect(call({action:'approve',expectedRevision:0,reason:'self review',verifiedCertificationIds:[]})).rejects.toHaveProperty('code','42501');
    const body=profile(); body.certifications[0].expiresOn='2026-02-30';
    await expect(call({action:'submit',expectedRevision:0,profile:body})).rejects.toHaveProperty('code','22023');
  });
  test('review directory is owner/admin-only and history pages are bounded', async () => {
    for (const actor of ['owner','admin']) {
      const r=await request(fixture.app).get('/api/work-profiles/reviews').set(fixture.actors[actor].session.headers);
      expect(r.status).toBe(200); expect(r.body.data.records.some(p=>p.id===target('member'))).toBe(true);
    }
    expect((await request(fixture.app).get('/api/work-profiles/reviews').set(fixture.actors.member.session.headers)).status).toBe(403);
    const data=(await get('owner','member','?historyOffset=0')).body.data;
    expect(data.history.length).toBeLessThanOrEqual(25); expect(data.historyTotal).toBeGreaterThan(3);
    expect((await get('owner','member','?organizationId=foreign')).status).toBe(400);
  });
  test('availability expires without editing history and its original request remains replayable', async () => {
    const a=fixture.actors.dispatcher,repo=require('../../src/workforce/workProfileRepository'),key=crypto.randomUUID();
    const body={action:'availability',expectedRevision:0,availability:{status:'available',note:'Short-lived local test',until:new Date(Date.now()+700).toISOString()}};
    const first=await repo.mutate(fixture.runtimePool,a,null,key,body);
    await new Promise(resolve=>setTimeout(resolve,900));
    const expired=await repo.readProfile(fixture.runtimePool,a);
    expect(expired.availability.status).toBe('expired');expect(expired.availability.document.note).toBe('Short-lived local test');
    const replay=await repo.mutate(fixture.runtimePool,a,null,key,body);
    expect(replay.id).toBe(first.id);expect(replay.replayed).toBe(true);
    expect((await repo.readProfile(fixture.runtimePool,a)).historyTotal).toBe(1);
  });
  test('omitted/stale access-role inputs cannot bypass the guarded read boundary', async () => {
    const repo=require('../../src/workforce/workProfileRepository'),a=fixture.actors.member;
    for(const role of [null,'owner','unknown']) await expect(repo.readProfile(fixture.runtimePool,{...a,actorAccessRole:role},target('member'))).rejects.toHaveProperty('status',403);
  });
  test('a pending employee edit and owner decision race against the same profile revision', async () => {
    const revision=await submit();
    const results=await Promise.all([
      send({action:'submit',expectedRevision:revision,profile:{...profile(),summary:'Clarification entered by the employee.'}}),
      send({action:'approve',expectedRevision:revision,reason:'Reviewed this exact profile version',verifiedCertificationIds:[]},'owner','member'),
    ]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await current()).profile.revision).toBe(revision+1);
  });
  test('migration replay preserves exact checksum, existing records and runtime withholding', async () => {
    const before=await current(),fs=require('fs'),path=require('path');
    const replayPool=new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,max:1});
    try { await fixture.db.runMigrations({pool:fixture.ownerPool,runtimePool:replayPool}); }
    finally { await replayPool.end(); }
    const row=(await fixture.ownerPool.query("SELECT checksum FROM _migrations WHERE filename='055_workforce_self_profile_authority.sql'")).rows[0];
    expect(row.checksum.trim()).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../../migrations/055_workforce_self_profile_authority.sql'))).digest('hex'));
    const after=await current();expect(after.profile).toEqual(before.profile);expect(after.historyTotal).toBe(before.historyTotal);
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_work_profile_events')).rejects.toHaveProperty('code','42501');
  });
});
