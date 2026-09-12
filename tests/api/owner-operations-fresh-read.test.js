'use strict';
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const {session}=require('../helpers/owner-operations-demo-session');
const {DemoCommandCenterRepository,normalizeToken}=require('../../src/commandCenter/demoRepository');
const suite=process.env.M19_PG_ADMIN_URL?describe:describe.skip;
suite('Owner Operations initial and persisted read basis',()=>{
 let f;
 beforeAll(async()=>{f=await createDatabaseFixture();},60000);
 afterAll(async()=>{if(f)await f.cleanup();},30000);
 const token=s=>normalizeToken(decodeURIComponent(s.cookie.slice(s.cookie.indexOf('=')+1)),new Date());
 test('fresh API list, details and overview use the same initial basis without persisting or granting actions',async()=>{
  const s=session(f.app),before=await s.read();
  for(let i=0;i<2;i++){
   const list=await s.agent.get('/api/demo/command-center/operations').set('Cookie',s.cookie);
   expect(list.status).toBe(200);expect(list.body.data.records).toHaveLength(3);
   expect(list.body.data.records.map(r=>r.appointmentId)).toEqual(before.graphs.map(g=>g.ids.appointment||g.ids.work));
   for(const r of list.body.data.records){const detail=await s.detail(r.appointmentId);expect(detail.execution).toBeNull();expect(detail.allowedActions).toEqual([]);expect(detail.demoWorkspaceRevision).toBe(1);}
   const overview=await s.agent.get('/api/demo/command-center/operations/overview').set('Cookie',s.cookie);
   expect(overview.status).toBe(200);expect(overview.body.data.records).toEqual([]);
  }
  expect((await s.read()).graphs).toEqual(before.graphs);
  expect((await f.ownerPool.query('SELECT count(*)::int count FROM demo_command_center_sessions WHERE id=$1',[before.session.id])).rows[0].count).toBe(0);
 });
 test('persisted scheduled work and history remain read from the saved row',async()=>{
  const s=session(f.app),id=await s.setup();expect((await s.act(id,'initialize')).status).toBe(201);
  const before=(await f.ownerPool.query('SELECT * FROM demo_command_center_sessions WHERE id=$1',[(await s.read()).session.id])).rows[0];
  const detail=await s.detail(id);expect(detail.execution.lifecycleState).toBe('not_started');expect(detail.allowedActions).toContain('start');
  const overview=await s.agent.get('/api/demo/command-center/operations/overview').set('Cookie',s.cookie);expect(overview.status).toBe(200);expect(overview.body.data.records[0].executionId).toBe(detail.execution.id);
  expect((await f.ownerPool.query('SELECT * FROM demo_command_center_sessions WHERE id=$1',[before.id])).rows[0]).toEqual(before);
 },45000);
 test('expired initial token and disappeared persisted basis are rejected instead of recreated',async()=>{
  const s=session(f.app);await s.read();const t=token(s),repo=new DemoCommandCenterRepository(()=>f.runtimePool);
  await expect(repo.readOperations({...t,expiresAt:new Date(Date.now()-1000)})).rejects.toMatchObject({status:410});
  const admitted=await repo.read(t);const spy=jest.spyOn(repo,'read').mockResolvedValue({...admitted,persisted:true});
  try{await expect(repo.readOperations(t)).rejects.toMatchObject({status:409,code:'DEMO_STATE_CHANGED'});}finally{spy.mockRestore();}
 });
});
