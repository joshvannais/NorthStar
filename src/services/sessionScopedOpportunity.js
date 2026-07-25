'use strict';

const demoScope = require('./demoRecordScope');

/**
 * Build the legacy opportunity pipeline response from records visible to a
 * demo session. Real records are always visible; simulations require an exact
 * session match.
 */
function buildSnapshot(engine, sessionId) {
  const opportunities = demoScope.filterRecords(
    engine.listOpportunities({ includeArchived: false }).opportunities || [],
    sessionId
  );
  const stageDefinitions = engine.PIPELINE_STAGES || {};
  const activeStageKeys = Object.keys(stageDefinitions).filter(function (stage) {
    return stageDefinitions[stage].category === 'active';
  });
  const active = opportunities.filter(function (item) { return item.status === 'open'; });
  const won = opportunities.filter(function (item) { return item.status === 'won'; });
  const lost = opportunities.filter(function (item) { return item.status === 'lost'; });
  const pipelineValue = active.reduce(function (sum, item) {
    return sum + (Number(item.estimatedValue) || 0);
  }, 0);
  const weightedValue = active.reduce(function (sum, item) {
    return sum + (Number(item.expectedRevenue) || 0);
  }, 0);
  const allValue = opportunities.reduce(function (sum, item) {
    return sum + (Number(item.estimatedValue) || 0);
  }, 0);
  const allWeightedValue = opportunities.reduce(function (sum, item) {
    return sum + (Number(item.expectedRevenue) || 0);
  }, 0);
  const wonValue = won.reduce(function (sum, item) {
    return sum + (Number(item.estimatedValue) || 0);
  }, 0);

  const byStage = {};
  activeStageKeys.forEach(function (stage) { byStage[stage] = []; });
  opportunities.forEach(function (item) {
    if (byStage[item.stage]) byStage[item.stage].push(item);
  });

  const stageCounts = {};
  const stageValues = {};
  activeStageKeys.forEach(function (stage) {
    stageCounts[stage] = byStage[stage].length;
    stageValues[stage] = byStage[stage].reduce(function (sum, item) {
      return sum + (Number(item.estimatedValue) || 0);
    }, 0);
  });

  const totalClosed = won.length + lost.length;
  const winRate = totalClosed ? Math.round(won.length / totalClosed * 10000) / 100 : 0;
  const lossRate = totalClosed ? Math.round(lost.length / totalClosed * 10000) / 100 : 0;
  const staleThreshold = new Date(Date.now() - 30 * 86400000).toISOString();
  const staleDeals = active.filter(function (item) {
    return item.lastActivity < staleThreshold;
  }).length;

  const stageTotals = {};
  Object.keys(stageDefinitions).forEach(function (stage) {
    const stageOpportunities = opportunities.filter(function (item) {
      return item.stage === stage;
    });
    const totalValue = stageOpportunities.reduce(function (sum, item) {
      return sum + (Number(item.estimatedValue) || 0);
    }, 0);
    const stageWeightedValue = stageOpportunities.reduce(function (sum, item) {
      return sum + (Number(item.expectedRevenue) || 0);
    }, 0);
    stageTotals[stage] = {
      stage: stage,
      displayName: stageDefinitions[stage].displayName,
      count: stageOpportunities.length,
      totalValue: totalValue,
      weightedValue: Math.round(stageWeightedValue * 100) / 100,
      averageValue: stageOpportunities.length
        ? Math.round(totalValue / stageOpportunities.length * 100) / 100
        : 0,
    };
  });

  const conversionRates = {};
  for (let i = 0; i < activeStageKeys.length - 1; i++) {
    const current = activeStageKeys[i];
    const next = activeStageKeys[i + 1];
    const currentAndNext = stageTotals[current].count + stageTotals[next].count;
    conversionRates[current + '_to_' + next] = {
      from: current,
      to: next,
      count: stageTotals[next].count,
      rate: currentAndNext
        ? Math.round(stageTotals[next].count / currentAndNext * 10000) / 100 + '%'
        : '0%',
    };
  }

  const lateStageValue = active.filter(function (item) {
    return item.stage === 'negotiation' || item.stage === 'verbalCommitment';
  }).reduce(function (sum, item) {
    return sum + (Number(item.expectedRevenue) || 0);
  }, 0);

  return {
    pipeline: {
      totalDeals: opportunities.length,
      totalValue: allValue,
      weightedValue: allWeightedValue,
      stageCounts: stageCounts,
      stageValues: stageValues,
      byStage: byStage,
    },
    metrics: {
      totalDeals: opportunities.length,
      activeDeals: active.length,
      wonDeals: won.length,
      lostDeals: lost.length,
      totalPipelineValue: pipelineValue,
      weightedPipelineValue: weightedValue,
      wonValue: wonValue,
      averageDealValue: opportunities.length
        ? Math.round(allValue / opportunities.length * 100) / 100 : 0,
      averageOpportunityValue: active.length
        ? Math.round(pipelineValue / active.length * 100) / 100 : 0,
      winRate: winRate,
      lossRate: lossRate,
      staleDeals: staleDeals,
      winRateDisplay: winRate + '%',
      lossRateDisplay: lossRate + '%',
    },
    stages: { stages: stageTotals, conversionRates: conversionRates },
    forecast: {
      totalActiveDeals: active.length,
      totalActiveValue: pipelineValue,
      weightedPipelineValue: Math.round(weightedValue * 100) / 100,
      lateStageValue: Math.round(lateStageValue * 100) / 100,
      forecast: {
        worstCase: Math.round(weightedValue * 0.5 * 100) / 100,
        mostLikely: Math.round(weightedValue * 100) / 100,
        bestCase: pipelineValue,
      },
      calculatedAt: new Date().toISOString(),
    },
  };
}

module.exports = { buildSnapshot };
