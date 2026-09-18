'use strict';
const crypto=require('node:crypto');const contract=require('../../src/learning/jobOutcomePlanningValueContract');
const id=crypto.randomUUID(),digest='a'.repeat(64),base={registryVersionId:id,expectedRegistryDigest:digest,expectedPreviewDigest:digest,planningArea:'labor_planning',metricKey:'worker_hours',basis:'NorthStar worker hours'};
describe('Mission 25 Part 13F planning value contract',()=>{
 test('accepts exact preview and owner-adoption pins',()=>{expect(contract.normalizePreview('fence',base)).toMatchObject({serviceKey:'fence',registryVersionId:id});expect(contract.normalizeAdopt('fence',{...base,expectedSelectionDigest:digest,expectedPlanningRevision:0,expectedPlanningDigest:'none',reason:'Adopt this exact reviewed planning value.',confirmed:true,confirmationVersion:'m25-job-outcome-planning-adoption-v1'})).toMatchObject({planningArea:'labor_planning',expectedPlanningRevision:0});});
 test('accepts exact rollback to unset or a prior value',()=>{const common={planningArea:'labor_planning',metricKey:'worker_hours',basis:'NorthStar worker hours',expectedPlanningRevision:1,expectedPlanningDigest:digest,reason:'Restore the earlier owner-approved value.',confirmed:true,confirmationVersion:'m25-job-outcome-planning-adoption-v1'};expect(contract.normalizeRollback('fence',{...common,rollbackToId:null,expectedRollbackToDigest:'none'}).rollbackToId).toBeNull();expect(contract.normalizeRollback('fence',{...common,rollbackToId:id,expectedRollbackToDigest:digest}).rollbackToId).toBe(id);});
 test.each([
  [{...base,planningArea:'financial_reference'}],
  [{...base,metricKey:'Gross Margin'}],
  [{...base,basis:'Connected material|bad@example.com'}],
  [{...base,extra:true}],
 ])('rejects unsupported or expanded selections',body=>expect(()=>contract.normalizePreview('fence',body)).toThrow(/invalid|current/i));
 test('requires exact concurrency and confirmation pins',()=>{expect(()=>contract.normalizeAdopt('fence',{...base,expectedSelectionDigest:digest,expectedPlanningRevision:0,expectedPlanningDigest:digest,reason:'Review.',confirmed:true,confirmationVersion:'m25-job-outcome-planning-adoption-v1'})).toThrow(/invalid/i);expect(()=>contract.normalizeRollback('fence',{planningArea:'labor_planning',metricKey:'worker_hours',basis:'NorthStar worker hours',expectedPlanningRevision:1,expectedPlanningDigest:digest,rollbackToId:null,expectedRollbackToDigest:digest,reason:'Review.',confirmed:true,confirmationVersion:'m25-job-outcome-planning-adoption-v1'})).toThrow(/invalid/i);});
});
