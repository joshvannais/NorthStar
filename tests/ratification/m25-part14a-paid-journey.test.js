'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'../..');const read=value=>fs.readFileSync(path.join(root,value),'utf8');

describe('Mission 25 Part 14A paid-tenant journey acceptance',()=>{
 test('freezes the exact first Part 14 acceptance slice',()=>{
  const roadmap=read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
  expect(roadmap).toContain('| A | Complete paid-tenant source-to-observation-to-calibration-to-adoption journey. |');
  expect(roadmap).toContain('## Part 14 Slice A candidate — complete paid-tenant learning journey');
  expect(roadmap).toContain('The isolated-demo journey, mission-wide recovery, performance, accessibility, responsive review, independent audit, merge, deployment and founder verdict remain Slices B-G.');
 });

 test('binds the successful owner journey to one exact current labor calibration',()=>{
  const journey=read('tests/api/m25-part13g-lifecycle-propagation.test.js');
  const migration=read('migrations/132_canonical_paid_learning_calibration_lineage.sql');
  const stages=['/consent','/batches','/matches','/imported-labor-duration-outcomes','/imported-labor-calibration-consent','/job-outcome-graph/consent','}/job-outcome-graph`','/job-outcome-graph/evaluation','/job-outcome-summary','M25_JOB_OUTCOME_PROPOSAL_CALIBRATION_REQUIRED','/imported-labor-calibrations/fence',"const concurrent=await Promise.all([post('/api/v1/learning/job-outcome-proposals/fence'",'/job-outcome-proposal-registry','/job-outcome-planning-values'];
  let previous=-1;for(const stage of stages){const current=journey.indexOf(stage);expect(current).toBeGreaterThan(previous);previous=current;}
  for(const proof of ['M25_JOB_OUTCOME_PROPOSAL_CALIBRATION_REQUIRED','value.laborCalibration.id===laborCalibration.id','medianActualToPlannedRatio).toBe(\'1.2500\')','lifecycle-correction-1','Stop imported labor calibration review.','Start a new imported labor calibration review period.'])expect(journey).toContain(proof);
  for(const proof of ['canonical_imported_labor_calibration_read','calibration_observation_ids IS DISTINCT FROM canonical_selected_labor_ids',"'laborCalibration',calibration_pin",'job_outcome_proposal_calibration_unavailable','pinned_count NOT IN(0,item_count)','pin IS DISTINCT FROM first_pin'])expect(migration).toContain(proof);
  const repository=read('src/learning/jobOutcomeProposalRepository.js');expect(repository).toContain('The current labor calibration is missing, out of date, or does not cover the selected jobs. Create or refresh it before preparing this advice.');expect(journey).toContain("message:'The current labor calibration is missing, out of date, or does not cover the selected jobs. Create or refresh it before preparing this advice.'");
 });

 test('uses exact digests for every protected operating-state class and names unavailable native financial tables',()=>{
  const journey=read('tests/api/m25-part13g-lifecycle-propagation.test.js');
  for(const area of ['externalSourceAuthority','companyState','customerAndPlans','schedule','jobAndExecution','assets','sourceEvidence','financial','provider'])expect(journey).toContain(`'${area}'`);
  for(const proof of ['migrationTableInventory','requiredProtectedTableAreas','reviewedUnprotectedGroups','reviewedUnprotectedReasons','protectedInventory.map(value=>value.name)).toEqual(expectedProtectedNames)','toHaveLength(273)','toHaveLength(199)','externalSourceAuthority:84','tenant_assets','canonical_business_profiles','canonical_native_equipment_utilization_observations','canonical_native_material_outcome_observations','retell_webhook_replay_claims','webhook_deliveries','canonical_external_communication_time_zones','canonical_external_financial_time_zones','assetAfter.count','assetAfter.digest'])expect(journey).toContain(proof);
  for(const unavailable of ['canonical_invoices','canonical_payments','canonical_collections'])expect(journey).toContain(`'${unavailable}'`);
  expect(journey).toContain('sha256(convert_to');expect(journey).toContain('protectedStateDigest()).toEqual(protectedStateBefore)');expect(journey).toContain('missingPinManifest');expect(journey).toContain('splitPinManifest');expect(journey).toContain('nullPinManifest');expect(journey).toContain('pinConflicts');
 });

 test('adds no rendered or provider mutation path',()=>{
  const evidence=read('docs/evidence/MISSION_25_PART14A_ACCEPTANCE.md');
  expect(evidence).toContain('No rendered application path changes in Slice A.');
  expect(evidence).toContain('No provider, credential, private-production, push, pull-request, merge or deployment action was performed.');
 });
});
