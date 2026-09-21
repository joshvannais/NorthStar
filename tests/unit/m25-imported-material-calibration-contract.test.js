'use strict';
const assert=require('node:assert/strict');
const contract=require('../../src/learning/importedMaterialCalibrationContract');const digest='a'.repeat(64);
test('normalizes explicit material calibration consent and proposal inputs',()=>{
 const consent=contract.normalizeConsent('materials.costs',{action:'grant',expectedRevision:0,expectedDigest:'none',reason:'Use current reviewed material and purchasing outcomes.',confirmed:true,confirmationVersion:'m25-imported-material-calibration-consent-v1'});assert.equal(consent.sourceKey,'materials.costs');
 const proposal=contract.normalizeProposal('materials.costs','tree_service',{expectedConsentRevision:1,expectedConsentDigest:digest,reason:'Review the current same-service material sample.',confirmed:true,confirmationVersion:'m25-imported-material-calibration-proposal-v1'});assert.equal(proposal.serviceKey,'tree_service');
});
test('rejects malformed, extra, unconfirmed and stale-shaped calibration input',()=>{const base={expectedConsentRevision:1,expectedConsentDigest:digest,reason:'Review current outcomes.',confirmed:true,confirmationVersion:'m25-imported-material-calibration-proposal-v1'};for(const value of[{...base,confirmed:false},{...base,extra:true},{...base,expectedConsentRevision:0},{...base,expectedConsentDigest:'bad'}])assert.throws(()=>contract.normalizeProposal('materials.costs','tree_service',value),error=>error.code==='M25_IMPORTED_MATERIAL_CALIBRATION_INPUT_INVALID');assert.throws(()=>contract.normalizeServiceKey('Tree Service'),error=>error.code==='M25_IMPORTED_MATERIAL_CALIBRATION_INPUT_INVALID');});
