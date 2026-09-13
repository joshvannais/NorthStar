'use strict';
const { TaxPreparationWorker } = require('./taxPreparationWorker');
const policy = require('../polaris/connectedPolicy');
class TaxResearchWorker extends TaxPreparationWorker {
  constructor(options = {}) { super(options); this.acquire = options.acquire || null; this.nextRetirementAt=0; this.controllers=new Set(); this.stopEpoch=0; }
  stop(){this.stopEpoch++;super.stop();for(const controller of this.controllers)controller.abort();}
  async enqueue(organizationId) {
    if (!policy.researchEnabled) return 0;
    return this.transaction(async client => (await client.query('SELECT public.canonical_tax_research_enqueue($1) count', [organizationId])).rows[0].count);
  }
  async tick() {
    if (this.running || !policy.researchEnabled) return { processed: 0, paused: !policy.researchEnabled };
    this.running = true; const epoch=this.stopEpoch; let processed = 0;
    try {
      if(Date.now()>=this.nextRetirementAt){await this.transaction(async client=>{await client.query('SELECT public.canonical_call_provider_retire()');return client.query('SELECT public.connected_reasoning_retire()');});this.nextRetirementAt=Date.now()+60000;}
      await this.enqueue(null);
      // Backfill can wait durably without claiming attempts or implying coverage.
      if (typeof this.acquire !== 'function') return { processed: 0, adapterUnavailable: true };
      for (let i = 0; i < this.batchSize && policy.researchEnabled && this.stopEpoch===epoch; i++) {
        const job = await this.transaction(async client => (await client.query('SELECT public.canonical_tax_research_claim() result')).rows[0].result);
        if (!job || this.stopEpoch!==epoch || !policy.researchEnabled) break;
        const controller = new AbortController(); this.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 10000);
        let result;
        try {
          // Claim committed and connection released before public transport.
          result = await Promise.race([this.acquire(job.context, { signal: controller.signal }), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Source retrieval interrupted')), { once: true }))]);
        } catch (_) { result = {}; } finally { clearTimeout(timeout); controller.abort(); this.controllers.delete(controller); }
        if (!policy.researchEnabled || this.stopEpoch!==epoch) break;
        await this.transaction(client => { if(typeof this.acquire.isCurrent==='function'&&!this.acquire.isCurrent(result))result={}; return client.query('SELECT public.canonical_tax_research_finish($1,$2,$3::jsonb)', [job.id, job.leaseToken, result]); });
        processed++;
      }
      return { processed, paused: !policy.researchEnabled };
    } finally { this.running = false; }
  }
}
module.exports = { TaxResearchWorker };
