'use strict';
const {parseCallCanaryBinding}=require('../../src/polaris/callCanaryBinding');
async function attest(pool,voiceSessionId,rawBinding,evidenceDigest='c'.repeat(64)){
 const binding=parseCallCanaryBinding(rawBinding);if(!binding)throw new TypeError('Valid canary binding required');
 await pool.query(`INSERT INTO canonical_call_provider_canary_attestations(
  voice_session_id,organization_id,integration_ownership_id,canary_binding_digest,agent_id,agent_version,
  llm_id,llm_version,base_prompt_digest,consent_version,provider_evidence_digest,synthetic_only,exclusive,status,observed_at,expires_at)
 SELECT id,organization_id,integration_ownership_id,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,TRUE,'active',started_at,started_at+interval '60 seconds'
 FROM canonical_voice_sessions WHERE id=$1`,[voiceSessionId,binding.bindingDigest,binding.agentId,binding.agentVersion,binding.llmId,binding.llmVersion,binding.basePromptDigest,binding.consentVersion,evidenceDigest]);
 return binding;
}
module.exports={attest};
