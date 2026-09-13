'use strict';
const workspace=require('../../src/commandCenter/workspace'),cards=require('../../src/polaris/assistantContract'),context=require('../../src/polaris/groundedContext'),conversation=require('../../src/polaris/groundedConversation');
const tenant='11111111-1111-4111-8111-111111111111';
// Reviewed desired-answer fixtures, not generated quality or live provider proof.
const examples={
 fence:['Can the crew reach the fence line without going through the house?','The owner can check the access and installation details before refining the plan.'],
 roofing:['Is there a clear place outside for the crew to set up?','The owner should review the roof and site access before refining the work plan.'],
 hvac:['Where is the indoor unit located, and how is it reached?','The owner can check the equipment configuration and installation access.'],
 plumbing:['Where is the affected fixture located in the building?','The owner can inspect the reported problem before confirming the repair scope.'],
 electrical:['Which part of the building is affected?','The owner should check the existing installation and the work requirements.'],
 concrete:['Can a vehicle reach the area where the work is planned?','The owner can assess site access and ground preparation before refining the plan.'],
};
test.each(Object.keys(examples))('%s actual synthetic scope reaches a bounded owner-progressive question fixture',service=>{
 const graph=workspace.buildSimulatedGraph({tenantId:tenant,key:'grounded-'+service,serviceKey:service,createdAt:'2026-09-13T12:00:00Z'});
 const item=workspace.demoCanonicalItems({tenant:{id:tenant},graphs:[graph],configuration:workspace.demoConfiguration()})[0];
 const selected={kind:'work',id:item.ids.appointment},card=cards.buildCustomerIntelligenceCard(item,selected),groundedContext=context.build({message:'What should be clarified?',card,authority:{organizationId:tenant,role:'owner'}});
 expect(groundedContext.service).toBe(service);expect(groundedContext.evidence[0].value).toContain('jobType');expect(groundedContext.evidence[0].label).toBe('Original Recorded Scope');
 const [question,explanation]=examples[service],raw={questions:[{text:question,evidenceIds:['recorded_scope']}],explanations:[{text:explanation,evidenceIds:['recorded_scope']}],proposalIds:[],requestedCard:'none'};
 expect(conversation.validatePayload(raw,{groundedContext})).toEqual(raw);
 expect(groundedContext.sourceLimits.join(' ')).toMatch(/later by the owner or estimator/);
 expect(groundedContext.allowedCards).toEqual([]);expect(groundedContext.proposals).toEqual([]);
});
test('original missing details are qualified separately from a later selected cost basis',()=>{
 const card={answer:'Original scope',authority:{snapshotId:'original'},evidence:[],unknowns:[{code:'labor_missing',label:'Labor cost is missing.'}],subtitle:'fence'};
 const review={selectedRevision:2,pins:{estimateId:'original'},isCurrent:true,decisions:{writeBasis:{revision:2,digest:'current'}},capellaScenarios:{directCosts:'400.00',currency:'USD',overhead:{incremental:'0.00'},prices:[]}};
 const value=context.build({message:'Review costs',card,review,authority:{role:'owner'}});
 expect(value.evidence.find(e=>e.id==='unknown:labor_missing').label).toBe('Original Record: Not Recorded');expect(value.trustedFacts.find(f=>f.label==='Known Direct Costs').value).toBe('400.00');expect(value.sourceLimits.join(' ')).toMatch(/selected estimate costs and review may have changed later/);
});
