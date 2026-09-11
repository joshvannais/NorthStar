'use strict';
const request = require('supertest');
const crypto = require('crypto');
const time = require('../../public/js/scheduling-time-contract');
function session(app) {
  let agent=request(app),cookie='',workspace;
  async function read(){const r=await agent.get('/api/demo/command-center').set('Cookie',cookie);if(r.status!==200)throw new Error('Demo read '+r.status);if(!cookie)cookie=r.headers['set-cookie'][0].split(';')[0];workspace=r.body.data;return workspace;}
  function headers(intent,revision,key=crypto.randomUUID()){return{Host:'northstar.test',Origin:'http://northstar.test','Sec-Fetch-Site':'same-origin',Cookie:cookie,'X-NorthStar-Demo-Intent':intent,'X-NorthStar-Demo-Revision':String(revision),'Idempotency-Key':key};}
  async function setup(){
    const w=await read(),id=w.schedulingOverview.records.find(r=>r.allowedActions.length).appointmentId;
    const zone=w.configuration.businessProfile.timeZone,next=new Date(Date.now()+86400000);while([0,6].includes(next.getUTCDay()))next.setUTCDate(next.getUTCDate()+1);const day=next.toISOString().slice(0,10);
    const interval=['10:00','11:00'].map(t=>time.resolveWallTime(day,t,zone).candidates[0].rfc3339);
    const target=w.schedulingOperator.targets.find(t=>t.kind==='crew');
    for(const action of ['schedule','assign','dispatch']){
      const current=await read(),a=current.schedulingOverview.records.find(r=>r.appointmentId===id).authority;
      const body={action,expectedRevision:a.revision,expectedDigest:a.digest,expectedTimeZone:zone,
        target:action==='schedule'?{kind:'unassigned',id:null}:{kind:target.kind,id:target.id},scheduledStart:interval[0],scheduledEnd:interval[1],appointmentStatus:a.appointmentStatus,reason:'Review this simulated job assignment and time.'};
      const p=await agent.post('/api/demo/command-center/appointments/'+id+'/mutation-previews').set(headers('schedule-times',current.integrity.revision)).send(body);
      if(p.status!==201)throw new Error('Schedule preview '+JSON.stringify(p.body));
      const v=p.body.data,r=await agent.post('/api/demo/command-center/appointments/'+id+'/mutation-approvals').set(headers('schedule-times',v.demoWorkspaceRevision)).send({previewId:v.id,previewDigest:v.previewDigest,acknowledgedWarningDigests:v.warningDigests,acknowledgedReviewReasonDigests:v.reviewReasonDigests,reason:body.reason});
      if(r.status!==201)throw new Error('Schedule approval '+JSON.stringify(r.body));
    }
    return id;
  }
  async function detail(id){const r=await agent.get('/api/demo/command-center/operations/appointments/'+id).set('Cookie',cookie);if(r.status!==200)throw new Error('Detail '+r.status+' '+JSON.stringify(r.body));return r.body.data;}
  function pins(d,transition=false){return{...(d.execution?(transition?{expectedRevision:d.execution.revision,expectedDigest:d.execution.digest}:{expectedExecutionRevision:d.execution.revision,expectedExecutionDigest:d.execution.digest}):{}),expectedAssignmentRevision:d.assignment.revision,expectedAssignmentDigest:d.assignment.digest,reason:'Explicit review of this simulated work.'};}
  function send(id,family,body,revision,key){return agent.post('/api/demo/command-center/operations/appointments/'+id+'/actions').set(headers('owner-operations',revision,key)).send({family,body});}
  async function act(id,family,extra={},key){const d=await detail(id);return send(id,family,{...pins(d,family==='transition'),...extra},d.demoWorkspaceRevision,key);}
  return{get agent(){return agent;},use(app){agent=request(app);},read,setup,detail,pins,send,act,get cookie(){return cookie;},get workspace(){return workspace;}};
}
module.exports={session};
