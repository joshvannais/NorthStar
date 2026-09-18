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

 test('mounts one ordered source-to-owner journey using released authorities',()=>{
  const journey=read('tests/api/m25-part13g-lifecycle-propagation.test.js');
  const stages=['/consent','/batches','/matches','/imported-labor-duration-outcomes','/imported-labor-calibration-consent','/imported-labor-calibrations/fence','/job-outcome-graph/consent','}/job-outcome-graph`','/job-outcome-graph/evaluation','/job-outcome-summary','/job-outcome-proposals','/job-outcome-proposal-registry','/job-outcome-planning-values'];
  let previous=-1;for(const stage of stages){const current=journey.indexOf(stage);expect(current).toBeGreaterThan(previous);previous=current;}
  for(const proof of ['sampleSize).toBe(5)','medianActualToPlannedRatio).toBe(\'1.2500\')','idempotency-replayed','f.actors.otherOwner.session.headers','recordsBefore=await recordCounts()','recordCounts()).toEqual(recordsBefore)'])expect(journey).toContain(proof);
 });

 test('adds no rendered or production mutation path',()=>{
  const evidence=read('docs/evidence/MISSION_25_PART14A_ACCEPTANCE.md');
  expect(evidence).toContain('No rendered application path changes in Slice A.');
  expect(evidence).toContain('No provider, credential, private-production, push, pull-request, merge or deployment action was performed.');
 });
});
