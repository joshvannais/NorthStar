/**
 * NorthStar Solutions — Polaris Engine
 * Shared revenue-intelligence engine. Produces insights for a single lead
 * and for the full lead set. Exposed on window.PolarisEngine.
 */
(function () {
  const confidence = (price) => {
    if (price > 2000) return { level: 'High', cls: 'high' };
    if (price > 500)  return { level: 'Medium', cls: 'medium' };
    return { level: 'Low', cls: 'low' };
  };

  const PolarisEngine = {
    /**
     * Analyze a single lead and return a normalized insight object.
     *  {
     *    summary, upsell, confidence: { level, cls },
     *    recommendedAction, reasons[]
     *  }
     */
    analyzeLead(lead) {
      if (!lead) return null;
      const price = Number(lead.avgPrice) || 0;
      const cf = confidence(price);
      const service = lead.service || 'service';
      const caller = lead.caller || 'this lead';

      const reasons = [];
      if (price > 2000) reasons.push('High estimated job value ($' + price.toLocaleString() + ').');
      if (lead.status === 'scheduled') reasons.push('Appointment already booked — focus on show-rate.');
      if (lead.status === 'new') reasons.push('New lead — fast follow-up multiplies conversion.');
      if (lead.transcript) reasons.push('Full transcript available — call back with specifics.');

      const upsell = price > 1500
        ? 'Consider bundling related ' + service + ' services to grow ticket size.'
        : 'Add a small add-on (warranty, maintenance plan) to lift value.';

      const recommendedAction = lead.status === 'scheduled'
        ? 'Confirm appointment 24h in advance; send prep checklist.'
        : lead.status === 'completed'
          ? 'Request a review and ask for a referral.'
          : 'Call within 5 minutes — fastest contact wins.';

      const insight = {
        leadId: lead.id,
        summary: caller + ' · ' + service + ' · $' + price.toLocaleString(),
        confidence: cf,
        upsell,
        recommendedAction,
        reasons,
        score: price * (lead.status === 'scheduled' ? 1.25 : 1)
      };

      if (window.EventBus) window.EventBus.emit('polaris:analysis-complete', insight);
      return insight;
    },

    /**
     * Analyze the full lead set (typically pulled from AppStore.getLeads()).
     * Returns: { topOpportunity, pipeline, recommendedFocus, insights[] }
     */
    analyzeSet(leads) {
      const list = Array.isArray(leads) ? leads : [];
      if (list.length === 0) {
        return {
          topOpportunity: null,
          pipeline: 0,
          recommendedFocus: null,
          insights: []
        };
      }

      const sorted = list.slice().sort((a, b) => (b.avgPrice || 0) - (a.avgPrice || 0));
      const top = sorted[0];
      const topInsight = this.analyzeLead(top);

      const pipeline = list.reduce((s, l) => s + (Number(l.avgPrice) || 0), 0);
      const pipeConfidence = list.length > 5 ? 'High' : list.length > 2 ? 'Medium' : 'Low';

      const svcCounts = {};
      list.forEach(l => {
        const svc = l.service || 'Other';
        svcCounts[svc] = (svcCounts[svc] || 0) + 1;
      });
      let topSvc = null, topSvcCount = 0;
      Object.keys(svcCounts).forEach(svc => {
        if (svcCounts[svc] > topSvcCount) { topSvc = svc; topSvcCount = svcCounts[svc]; }
      });
      const focusConfidence = topSvcCount > 3 ? 'High' : topSvcCount > 1 ? 'Medium' : 'Low';

      return {
        topOpportunity: top,
        topOpportunityInsight: topInsight,
        pipeline,
        pipelineConfidence: pipeConfidence,
        recommendedFocus: topSvc ? { service: topSvc, count: topSvcCount, confidence: focusConfidence } : null,
        insights: sorted.slice(0, 10).map(l => this.analyzeLead(l))
      };
    }
  };

  window.PolarisEngine = PolarisEngine;
})();
