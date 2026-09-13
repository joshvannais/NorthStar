'use strict';
// Offline-only artifact construction. This module is never mounted by the server
// and cannot write the registry or authenticate an independent human review.
const {createHash}=require('node:crypto');
const {stableStringify}=require('../services/businessProfileAdapter');
const {publicContext}=require('./taxSourceAcquisition');
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function fail(){throw new Error('Coverage publication requires exact independently reviewed source, rule and current registry identities.');}
function buildCoverageArtifact({manifest,candidates,registry}){
 if(!manifest||manifest.version!=='tax-coverage-review-v1'||!['synthetic_fixture','reviewed_release'].includes(manifest.mode)||!Array.isArray(manifest.entries)||!manifest.entries.length||manifest.entries.length>100||!Array.isArray(candidates)||candidates.length>100||!Array.isArray(registry)||registry.length>1000)fail();
 const review=manifest.review;if(!review||review.verdict!=='approved'||typeof review.authorId!=='string'||!review.authorId||typeof review.reviewerId!=='string'||!review.reviewerId||review.authorId===review.reviewerId||!day(review.reviewedOn)||!hex(review.evidenceDigest))fail();
 const keys=new Set(),operations=[];
 for(const entry of manifest.entries){
  if(!entry||typeof entry.ruleKey!=='string'||!entry.ruleKey||entry.ruleKey.length>200||keys.has(entry.ruleKey)||!Number.isSafeInteger(entry.expectedRevision)||entry.expectedRevision<0||entry.expectedRevision>10000||!(entry.expectedDigest==='none'&&entry.expectedRevision===0||hex(entry.expectedDigest)&&entry.expectedRevision>0)||!hex(entry.candidateDigest)||!hex(entry.sourceDigest)||!hex(entry.reviewedRuleDigest))fail();keys.add(entry.ruleKey);
  const matches=candidates.filter(c=>c.digest===entry.candidateDigest);if(matches.length!==1)fail();const c=matches[0];if(typeof c.contentText!=='string'||Buffer.byteLength(c.contentText)>65536||hash(c.contentText)!==c.digest)fail();let candidate;try{candidate=JSON.parse(c.contentText);}catch(_){fail();}
  if(candidate.version!=='tax-source-candidate-v1'||candidate.state!=='candidate'||!Array.isArray(candidate.candidates))fail();const sources=candidate.candidates.filter(s=>s.contentDigest===entry.sourceDigest);if(sources.length!==1)fail();const source=sources[0];if(typeof source.excerpt!=='string'||hash(source.excerpt)!==source.contentDigest||!day(source.fetchedOn)||!day(source.effectiveOn)||!day(source.endsOn)||source.endsOn<source.effectiveOn||source.reviewRequired!==true)fail();
  const rule=entry.rule,ruleKeys=['version','validation','simulated','active','treatment','behavior','ratePercent','effectiveOn','endsOn','registration','collectionBasis','country','region','locality','jurisdiction','serviceKey','classification'];if(!rule||Object.keys(rule).length!==ruleKeys.length||!ruleKeys.every(k=>Object.hasOwn(rule,k))||rule.version!=='tax-preparation-v1'||rule.validation!=='validated'||rule.simulated!==false||typeof rule.active!=='boolean'||!['taxable','zero_rate','exempt'].includes(rule.treatment)||!['exclusive','inclusive'].includes(rule.behavior)||typeof rule.ratePercent!=='string'||!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,4})?$/.test(rule.ratePercent)||Number(rule.ratePercent)>100||['zero_rate','exempt'].includes(rule.treatment)&&Number(rule.ratePercent)!==0||!day(rule.effectiveOn)||!day(rule.endsOn)||rule.endsOn<rule.effectiveOn||rule.effectiveOn<source.effectiveOn||rule.endsOn>source.endsOn||typeof rule.registration!=='string'||!['registered','not_registered','exempt','unknown'].includes(rule.registration)||typeof rule.collectionBasis!=='string'||!rule.collectionBasis.trim())fail();
  const context=publicContext(source.context);for(const key of Object.keys(context))if(rule[key]!==context[key])fail();
  const contentText=stableStringify(rule);if(hash(contentText)!==entry.reviewedRuleDigest)fail();
  const old=registry.filter(r=>r.ruleKey===entry.ruleKey).sort((a,b)=>b.revision-a.revision)[0];if((old?.revision||0)!==entry.expectedRevision||(old?.digest||'none')!==entry.expectedDigest)fail();
  operations.push({ruleKey:entry.ruleKey,expectedRevision:entry.expectedRevision,expectedDigest:entry.expectedDigest,revision:entry.expectedRevision+1,content:rule,digest:entry.reviewedRuleDigest,candidateDigest:entry.candidateDigest,sourceDigest:entry.sourceDigest});
 }
 const content={version:'tax-coverage-publication-artifact-v1',mode:manifest.mode,syntheticFixture:manifest.mode==='synthetic_fixture',releaseAuthorizationRequired:true,reviewEvidenceDigest:review.evidenceDigest,reviewerId:review.reviewerId,operations};
 return {...content,artifactDigest:hash(stableStringify(content))};
}
function verifyCoverageArtifact(artifact,input){const rebuilt=buildCoverageArtifact(input);if(stableStringify(artifact)!==stableStringify(rebuilt))fail();return {matches:true,writes:0,releaseAuthorizationRequired:true,syntheticFixture:rebuilt.syntheticFixture};}
module.exports={buildCoverageArtifact,verifyCoverageArtifact};
