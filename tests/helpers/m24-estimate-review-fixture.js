'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDatabaseFixture } = require('./m23-part9b-overview-fixture');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const { canonicalFenceProfile } = require('./m19-part3-business-profile');
const { ingestLead } = require('../../src/services/canonicalGraphService');
async function createEstimateReviewFixture(options = {}) {
  const extra = options.additionalCompleteEstimates || 0;
  assert(Number.isInteger(extra) && extra >= 0 && extra <= 60);
  const f = await createDatabaseFixture(options.operationalSchedule ?
    { operationalSchedule: true } : {});
  try {
    const profile = canonicalFenceProfile(); profile.company.timeZone = 'UTC';
    if (options.operationalSchedule) {
      profile.hours = Object.fromEntries(
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
          .map(day => [day, { open: '00:00', close: '23:59', lunch: '',
            emergency: false, afterHours: false, holiday: false }]));
    }
    await putBusinessProfile(f.ownerPool, { organizationId:f.org,userId:f.actors.owner.actorUserId,expectedVersion:'org-profile-v1',profile });
    f.estimateGraphs = [];
    for (const [index,incomplete] of [false,true,...Array(extra).fill(false)].entries()) {
      const key = crypto.randomUUID();
      const additional = index >= 2;
      const result = await ingestLead(f.runtimePool, {
        tenantContext:{ organizationId:f.org,trusted:true },idempotencyKey:key,sourceVersion:'m24-review-fixture-v1',
        external:{ customerId:key,callId:key,transcriptId:key,communicationId:key,appointmentId:key },
        customer:{ name:additional?`Fictional estimate customer ${index}`:incomplete?'Incomplete estimate customer':'Recorded estimate customer',phone:additional?`+1555555${String(index).padStart(4,'0')}`:incomplete?'+15555550101':'+15555550100',email:key+'@example.test',address:{line1:'1 Test Way',city:'Boston',state:'MA',postalCode:'02108'} },
        transcript:[{turnId:'scope',speaker:'customer',text:'I need a 100-foot cedar fence.'}],
        facts:incomplete?[]:[{variable:'linearFeet',normalizedValue:100,evidenceText:'100-foot',speaker:'customer',evidenceTurnId:'scope',confidence:1}],
        service:{key:'fence',scope:incomplete?{}:{jobType:'replace',linearFeet:100,height:6,material:'cedar',removalRequired:true,gates:[{type:'walk'}],permitsRequired:true,...(options.recordedLaborHours === undefined ? {} : {laborHours:options.recordedLaborHours}),...(options.recordedDescription === undefined ? {} : {description:options.recordedDescription}),...(options.proposalScope||{})}},
        businessProfile:profile,businessProfileVersion:profile.version,
      });
      assert.equal(result.status,201,JSON.stringify(result)); f.estimateGraphs.push(result.body);
    }
    return f;
  } catch(error) { await f.cleanup(); throw error; }
}
module.exports={createEstimateReviewFixture};
