/**
 * Polaris Business Intelligence & Analytics Engine
 *
 * Executive dashboards, KPI aggregation, forecasting, reporting,
 * historical analytics, operational metrics, and company-wide
 * performance analytics for the Polaris platform.
 *
 * This is a READ-ONLY aggregator — it consumes public APIs from
 * all other Polaris engines but does NOT create its own data.
 *
 * Ownership Boundary:
 *   - Dashboard generation (executive, operations, financial, sales, etc.)
 *   - KPI aggregation and calculation
 *   - Revenue and profit reporting
 *   - Forecasting and trend analysis
 *   - Performance and productivity reporting
 *   - Utilization and efficiency reporting
 *   - Customer insights and growth metrics
 *   - Alert generation
 *
 * Dependencies (consumed via public APIs):
 *   - store.js (persistence for report metadata)
 *   - All other engines via require() with graceful error handling
 */

const store = require('./store');
const sessionReg = require('../routes/simulation/session-registry');

// ── Session-aware filtering ──
function _filterBySession(records, sessionId) {
  if (!sessionId) return records;
  var allSessionIds = sessionReg.getAllSessionRecordIds();
  return records.filter(function(r) {
    if (!r || !r.id) return true;
    if (!allSessionIds.has(r.id)) return true;
    return sessionReg.isInSession(r.id, sessionId);
  });
}

// ── In-memory report cache ──
var _reportCache = {};
var _lastRefresh = null;

function _now() {
  return new Date().toISOString();
}

function _safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

// ── Engine Accessors (with graceful fallback) ──

function _getCustomerEngine() {
  try { return require('./customer-engine'); } catch (e) { return null; }
}

function _getCommsEngine() {
  try { return require('./communications-engine'); } catch (e) { return null; }
}

function _getOppEngine() {
  try { return require('./opportunity-engine'); } catch (e) { return null; }
}

function _getWfEngine() {
  try { return require('./workflow-engine'); } catch (e) { return null; }
}

function _getFinEngine() {
  try { return require('./financial-engine'); } catch (e) { return null; }
}

function _getAssetEngine() {
  try { return require('./asset-engine'); } catch (e) { return null; }
}

function _getCrewEngine() {
  try { return require('./crew-engine'); } catch (e) { return null; }
}

function _getJobEngine() {
  try { return require('./job-engine'); } catch (e) { return null; }
}

// ── Init ──

function init() {
  _lastRefresh = _now();
  return { initialized: true, at: _lastRefresh };
}

// ── KPI Aggregation ──

function generateKPIs(sessionId) {
  var kpis = {};

  // Revenue KPIs
  var fin = _getFinEngine();
  kpis.totalRevenue = _safe(function () { return fin.getFinancialMetrics().totalRevenue; }, 0);
  kpis.totalInvoiced = _safe(function () { return fin.getFinancialMetrics().totalInvoiced; }, 0);
  kpis.outstandingRevenue = _safe(function () { return fin.getFinancialMetrics().totalOutstanding; }, 0);
  kpis.averageInvoiceValue = _safe(function () { return fin.getFinancialMetrics().averageInvoiceValue; }, 0);
  kpis.collectionRate = _safe(function () { return fin.getFinancialMetrics().collectionRate; }, 0);

  // Opportunity KPIs — session-filtered when sessionId provided
    var opp = _getOppEngine();
    if (sessionId) {
      var allOpps = _safe(function () { return opp.listOpportunities({ includeArchived: false }); }, { opportunities: [], total: 0 });
      var filteredOpps = _filterBySession(allOpps.opportunities || [], sessionId);
      var activeOpps = filteredOpps.filter(function(o) { return o.status === 'open'; });
      kpis.totalDeals = filteredOpps.length;
      kpis.activeDeals = activeOpps.length;
      kpis.wonDeals = filteredOpps.filter(function(o) { return o.stage === 'closed-won'; }).length;
      kpis.winRate = kpis.totalDeals > 0 ? Math.round(kpis.wonDeals / kpis.totalDeals * 100) : 0;
      kpis.pipelineValue = activeOpps.reduce(function(s, o) { return s + (parseFloat(o.estimatedValue) || 0); }, 0);
      kpis.weightedPipelineValue = activeOpps.reduce(function(s, o) { return s + (parseFloat(o.expectedRevenue) || 0); }, 0);
      kpis.averageOpportunityValue = activeOpps.length > 0 ? Math.round(kpis.pipelineValue / activeOpps.length) : 0;
    } else {
      var oppMetrics = _safe(function () { return opp.getPipelineMetrics(); }, {});
      kpis.totalDeals = oppMetrics.totalDeals || 0;
      kpis.activeDeals = oppMetrics.activeDeals || 0;
      kpis.wonDeals = oppMetrics.wonDeals || 0;
      kpis.winRate = oppMetrics.winRate || 0;
      kpis.pipelineValue = oppMetrics.totalPipelineValue || 0;
      kpis.weightedPipelineValue = oppMetrics.weightedPipelineValue || 0;
      kpis.averageOpportunityValue = oppMetrics.averageOpportunityValue || 0;
    }

    // Estimate-based pipeline indicators (NOT revenue — future potential)
    kpis.pendingEstimates = _safe(function () { return fin.getFinancialMetrics().pendingEstimateCount; }, 0);
    kpis.estimatedPipelineValue = _safe(function () { return fin.getFinancialMetrics().pendingEstimateTotal; }, 0);

  // Workflow KPIs
  var wf = _getWfEngine();
  var wfMetrics = _safe(function () { return wf.getWorkflowMetrics(); }, {});
  kpis.totalTasks = wfMetrics.totalTasks || 0;
  kpis.completedTasks = wfMetrics.completedTasks || 0;
  kpis.overdueTasks = wfMetrics.overdueTasks || 0;
  kpis.taskCompletionRate = wfMetrics.completionRate || 0;
  kpis.avgCompletionTimeHours = wfMetrics.avgCompletionTimeHours || 0;

  // Job KPIs
  var job = _getJobEngine();
  var jobMetrics = _safe(function () { return job.getJobMetrics(); }, {});
  kpis.totalJobs = jobMetrics.totalJobs || 0;
  kpis.completedJobs = jobMetrics.completedJobs || 0;
  kpis.inProgressJobs = jobMetrics.inProgressJobs || 0;
  kpis.openIssues = jobMetrics.openIssues || 0;

  // Asset KPIs
  var ast = _getAssetEngine();
  var astMetrics = _safe(function () { return ast.getAssetMetrics(); }, {});
  kpis.totalAssets = astMetrics.totalAssets || 0;
  kpis.assetsInMaintenance = astMetrics.inMaintenance || 0;
  kpis.assetsOutOfService = astMetrics.outOfService || 0;
  kpis.upcomingMaintenance = astMetrics.upcomingMaintenance || 0;
  kpis.totalAssetValue = astMetrics.totalValue || 0;

  // Crew KPIs
  var crew = _getCrewEngine();
  var crewMetrics = _safe(function () { return crew.getCrewMetrics(); }, {});
  kpis.totalEmployees = crewMetrics.totalEmployees || 0;
  kpis.totalCrews = crewMetrics.totalCrews || 0;
  kpis.deployedCrews = crewMetrics.deployedCrews || 0;
  kpis.totalLaborCost = crewMetrics.totalLaborCost || 0;
  kpis.expiredCertifications = crewMetrics.expiredCertifications || 0;

  // Calculated KPIs
  var healthResult = _calculateHealthScore(kpis);
  kpis.companyHealthScore = healthResult.score;
  kpis.healthStatus = healthResult.status;
  kpis.healthEligibleDimensions = healthResult.eligibleDimensions;
  kpis.healthMessage = healthResult.message;
  kpis.cashFlow = kpis.totalRevenue - kpis.totalLaborCost;

  // Customer KPIs — session-filtered when sessionId provided
  var cust = _getCustomerEngine();
  if (sessionId) {
    var allCusts = _safe(function () { return cust.listCustomers(); }, { customers: [], total: 0 });
    var filteredCusts = _filterBySession(allCusts.customers || [], sessionId);
    kpis.totalCustomers = filteredCusts.length;
  } else {
    var custList = _safe(function () { return cust.listCustomers(); }, { customers: [], total: 0 });
    kpis.totalCustomers = custList.total || 0;
  }

  _lastRefresh = _now();
  return { kpis: kpis, calculatedAt: _lastRefresh };
}

function _calculateHealthScore(kpis) {
  var score = 0;
  var eligible = [];
  var totalDimensions = 5; // Revenue, Collection, Sales/Pipeline, Operations, Customer

  // --- Revenue Health: requires at least 1 paid or invoiced transaction
  if (kpis.totalRevenue > 0 || kpis.totalInvoiced > 0) {
    eligible.push('revenue');
    if (kpis.totalRevenue > 50000) score += 20;
    else if (kpis.totalRevenue > 25000) score += 15;
    else if (kpis.totalRevenue > 10000) score += 10;
    else score += 5;
  }

  // --- Collection Rate: requires at least 1 invoice with collectible value
  if (kpis.totalInvoiced > 0) {
    eligible.push('collection');
    if (kpis.collectionRate > 90) score += 20;
    else if (kpis.collectionRate > 75) score += 15;
    else if (kpis.collectionRate > 50) score += 10;
    else score += 5;
  }

  // --- Sales/Pipeline Health: requires activeDeals > 0
  if (kpis.activeDeals > 0) {
    eligible.push('sales');
    if (kpis.winRate > 50) score += 20;
    else if (kpis.winRate > 30) score += 15;
    else if (kpis.winRate > 15) score += 10;
    else score += 5;
  }

  // --- Operations Health: requires totalJobs > 0
  if (kpis.totalJobs > 0) {
    eligible.push('operations');
    if (kpis.openIssues === 0) score += 20;
    else if (kpis.openIssues < 3) score += 15;
    else if (kpis.openIssues < 10) score += 10;
    else score += 5;
  }

  // --- Customer Health: requires totalCustomers > 0
  if (kpis.totalCustomers > 0) {
    eligible.push('customer');
    if (kpis.totalCustomers > 10) score += 20;
    else if (kpis.totalCustomers > 5) score += 15;
    else score += 10;
  }

  var eligibleCount = eligible.length;

  // Normalize: if fewer than all dimensions are eligible, scale to 0-100
  if (eligibleCount > 0 && eligibleCount < totalDimensions) {
    score = Math.round((score / (eligibleCount * 20)) * 100);
  } else if (eligibleCount === 0) {
    score = 0;
  }

  var status = eligibleCount >= 3 ? 'established' : 'baseline';

  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    eligibleDimensions: eligibleCount,
    totalDimensions: totalDimensions,
    status: status,
    message: status === 'baseline' ? 'Building baseline: insufficient data for meaningful health score' : null,
  };
}

// ── Dashboards ──

function generateDashboard(sessionId) {
  var kpis = generateKPIs(sessionId);
  return {
    summary: kpis.kpis,
    companyHealth: kpis.kpis.companyHealthScore,
    calculatedAt: kpis.calculatedAt,
  };
}

function generateExecutiveSummary(sessionId) {
  var kpis = generateKPIs(sessionId).kpis;
  var fin = _getFinEngine();
  var opp = _getOppEngine();

  var forecast = _safe(function () { return fin.calculateRevenueForecast(3); }, {});
  var profitability = _safe(function () { return fin.calculateProfitability(); }, {});

  return {
    title: 'Executive Summary',
    companyHealth: kpis.companyHealthScore,
    revenue: {
      total: kpis.totalRevenue,
      outstanding: kpis.outstandingRevenue,
      forecast: forecast.totalForecast || 0,
      collectionRate: kpis.collectionRate + '%',
    },
    pipeline: {
      totalDeals: kpis.totalDeals,
      activeDeals: kpis.activeDeals,
      weightedValue: kpis.weightedPipelineValue,
      pipelineValue: kpis.pipelineValue,
      averageOpportunityValue: kpis.averageOpportunityValue,
      pendingEstimateCount: kpis.pendingEstimates,
      pendingEstimateTotal: kpis.estimatedPipelineValue,
      winRate: kpis.winRate + '%',
    },
    operations: {
      totalJobs: kpis.totalJobs,
      completedJobs: kpis.completedJobs,
      inProgress: kpis.inProgressJobs,
      taskCompletion: kpis.taskCompletionRate + '%',
    },
    resources: {
      totalEmployees: kpis.totalEmployees,
      totalCrews: kpis.totalCrews,
      totalAssets: kpis.totalAssets,
      utilization: kpis.assetsInMaintenance + ' assets in maintenance',
    },
    profitability: {
      totalRevenue: profitability.totalRevenue || 0,
      collectionRate: profitability.collectionRateDisplay || '0%',
    },
    generatedAt: _now(),
  };
}

function generateFinancialDashboard() {
  var fin = _getFinEngine();
  return {
    title: 'Financial Dashboard',
    metrics: _safe(function () { return fin.getFinancialMetrics(); }, {}),
    profitability: _safe(function () { return fin.calculateProfitability(); }, {}),
    forecast: _safe(function () { return fin.calculateRevenueForecast(3); }, {}),
    generatedAt: _now(),
  };
}

function generateSalesDashboard() {
  var opp = _getOppEngine();
  var pipeline = _safe(function () { return opp.getPipeline(); }, {});
  var metrics = _safe(function () { return opp.getPipelineMetrics(); }, {});
  var stages = _safe(function () { return opp.getStageTotals(); }, {});

  return {
    title: 'Sales Dashboard',
    pipeline: pipeline,
    metrics: metrics,
    stageTotals: stages,
    generatedAt: _now(),
  };
}

function generateCustomerDashboard() {
  var cust = _getCustomerEngine();
  var all = _safe(function () { return cust.listCustomers(); }, { customers: [], total: 0 });

  var activeCustomers = 0;
  if (all.customers) {
    all.customers.forEach(function (c) { if (c.status === 'active') activeCustomers++; });
  }

  var fin = _getFinEngine();
  var totalRevenue = 0;
  if (all.customers) {
    all.customers.forEach(function (c) {
      var cr = _safe(function () { return fin.calculateCustomerRevenue(c.id); }, {});
      totalRevenue += cr.totalRevenue || 0;
    });
  }

  return {
    title: 'Customer Dashboard',
    totalCustomers: all.total || 0,
    activeCustomers: activeCustomers,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    avgRevenuePerCustomer: all.total > 0 ? Math.round((totalRevenue / all.total) * 100) / 100 : 0,
    generatedAt: _now(),
  };
}

function generateCrewDashboard() {
  var crew = _getCrewEngine();
  return {
    title: 'Crew Dashboard',
    metrics: _safe(function () { return crew.getCrewMetrics(); }, {}),
    generatedAt: _now(),
  };
}

function generateAssetDashboard() {
  var ast = _getAssetEngine();
  return {
    title: 'Asset Dashboard',
    metrics: _safe(function () { return ast.getAssetMetrics(); }, {}),
    upcomingMaintenance: _safe(function () { return ast.getUpcomingMaintenance(30); }, {}),
    generatedAt: _now(),
  };
}

function generateJobDashboard() {
  var job = _getJobEngine();
  return {
    title: 'Job Dashboard',
    metrics: _safe(function () { return job.getJobMetrics(); }, {}),
    upcomingJobs: _safe(function () { return job.getUpcomingJobs(7); }, {}),
    generatedAt: _now(),
  };
}

function generateWorkflowDashboard() {
  var wf = _getWfEngine();
  return {
    title: 'Workflow Dashboard',
    metrics: _safe(function () { return wf.getWorkflowMetrics(); }, {}),
    todayAgenda: _safe(function () { return wf.getTodayAgenda(); }, {}),
    overdue: _safe(function () { return wf.getOverdueTasks(); }, {}),
    generatedAt: _now(),
  };
}

function generateOperationsDashboard() {
  var job = _getJobEngine();
  var wf = _getWfEngine();
  var ast = _getAssetEngine();
  var crew = _getCrewEngine();

  return {
    title: 'Operations Dashboard',
    jobs: _safe(function () { return job.getJobMetrics(); }, {}),
    workflows: _safe(function () { return wf.getWorkflowMetrics(); }, {}),
    assets: _safe(function () { return ast.getAssetMetrics(); }, {}),
    crew: _safe(function () { return crew.getCrewMetrics(); }, {}),
    generatedAt: _now(),
  };
}

// ── Reports ──

function generateRevenueReport() {
  var fin = _getFinEngine();
  return {
    title: 'Revenue Report',
    metrics: _safe(function () { return fin.getFinancialMetrics(); }, {}),
    profitability: _safe(function () { return fin.calculateProfitability(); }, {}),
    forecast: _safe(function () { return fin.calculateRevenueForecast(12); }, {}),
    generatedAt: _now(),
  };
}

function generateProfitReport() {
  var fin = _getFinEngine();
  return {
    title: 'Profitability Report',
    profitability: _safe(function () { return fin.calculateProfitability(); }, {}),
    forecast: _safe(function () { return fin.calculateRevenueForecast(3); }, {}),
    generatedAt: _now(),
  };
}

function generateForecast() {
  var fin = _getFinEngine();
  var opp = _getOppEngine();

  var revenueForecast = _safe(function () { return fin.calculateRevenueForecast(12); }, {});
  var pipelineForecast = _safe(function () { return opp.calculateForecastRevenue(); }, {});

  return {
    title: 'Company Forecast',
    revenueForecast: revenueForecast,
    pipelineForecast: pipelineForecast,
    totalForecastRevenue: (revenueForecast.totalForecast || 0) + (pipelineForecast.forecast ? pipelineForecast.forecast.mostLikely : 0),
    generatedAt: _now(),
  };
}

function generateTrendAnalysis() {
  return {
    title: 'Trend Analysis',
    note: 'Trend analysis requires historical data snapshots. Run generateDashboard() periodically to build history.',
    generatedAt: _now(),
  };
}

function generatePerformanceReport() {
  var crew = _getCrewEngine();
  var wf = _getWfEngine();
  var job = _getJobEngine();

  return {
    title: 'Performance Report',
    crew: _safe(function () { return crew.getCrewMetrics(); }, {}),
    workflows: _safe(function () { return wf.getWorkflowMetrics(); }, {}),
    jobs: _safe(function () { return job.getJobMetrics(); }, {}),
    generatedAt: _now(),
  };
}

function generateProductivityReport() {
  var wf = _getWfEngine();
  var crew = _getCrewEngine();

  return {
    title: 'Productivity Report',
    workflowMetrics: _safe(function () { return wf.getWorkflowMetrics(); }, {}),
    crewMetrics: _safe(function () { return crew.getCrewMetrics(); }, {}),
    generatedAt: _now(),
  };
}

function generateUtilizationReport() {
  var ast = _getAssetEngine();
  var crew = _getCrewEngine();

  return {
    title: 'Utilization Report',
    assetMetrics: _safe(function () { return ast.getAssetMetrics(); }, {}),
    crewMetrics: _safe(function () { return crew.getCrewMetrics(); }, {}),
    generatedAt: _now(),
  };
}

function generateCustomerInsights() {
  var cust = _getCustomerEngine();
  var comms = _getCommsEngine();
  var opp = _getOppEngine();
  var fin = _getFinEngine();

  var allCustomers = _safe(function () { return cust.listCustomers(); }, { customers: [], total: 0 });
  var customers = allCustomers.customers || [];

  var insights = {
    title: 'Customer Insights',
    totalCustomers: allCustomers.total || 0,
    totalRevenue: 0,
    avgRevenue: 0,
    atRiskCustomers: 0,
    topCustomers: [],
    generatedAt: _now(),
  };

  var customerData = [];
  customers.forEach(function (c) {
    var revenue = _safe(function () { return fin.calculateCustomerRevenue(c.id); }, { totalRevenue: 0 });
    var lastContact = _safe(function () { return comms.getLastContact(c.id); }, { daysSince: null });
    var opps = _safe(function () { return opp.getCustomerOpportunities(c.id); }, { total: 0 });

    var isAtRisk = (lastContact.daysSince === null || lastContact.daysSince > 90);
    if (isAtRisk) insights.atRiskCustomers++;

    insights.totalRevenue += revenue.totalRevenue || 0;

    customerData.push({
      id: c.id,
      name: c.name || c.id,
      revenue: revenue.totalRevenue || 0,
      lastContactDays: lastContact.daysSince,
      activeOpportunities: opps.total || 0,
      atRisk: isAtRisk,
    });
  });

  customerData.sort(function (a, b) { return b.revenue - a.revenue; });
  insights.topCustomers = customerData.slice(0, 5);
  insights.avgRevenue = insights.totalCustomers > 0 ? Math.round((insights.totalRevenue / insights.totalCustomers) * 100) / 100 : 0;
  insights.totalRevenue = Math.round(insights.totalRevenue * 100) / 100;

  return insights;
}

function generateGrowthMetrics() {
  return {
    title: 'Growth Metrics',
    note: 'Growth metrics require historical data. Start tracking KPIs regularly to build growth trends.',
    generatedAt: _now(),
  };
}

function generateRetentionMetrics() {
  return {
    title: 'Retention Metrics',
    customerInsights: _safe(function () { return generateCustomerInsights(); }, {}),
    generatedAt: _now(),
  };
}

function generateAlerts() {
  var alerts = [];
  var kpis = generateKPIs().kpis;

  // Financial alerts — only if actual invoicing activity exists
  if (kpis.totalInvoiced > 0) {
    if (kpis.outstandingRevenue > 10000) {
      alerts.push({ severity: 'warning', category: 'financial', message: 'Outstanding revenue of $' + kpis.outstandingRevenue.toFixed(2) + ' needs attention' });
    }
    if (kpis.collectionRate < 50) {
      alerts.push({ severity: 'critical', category: 'financial', message: 'Collection rate is low at ' + kpis.collectionRate + '%' });
    }
  }

  // Operations alerts — only if tasks/jobs exist
  if (kpis.totalTasks > 0 && kpis.overdueTasks > 5) {
    alerts.push({ severity: 'warning', category: 'operations', message: kpis.overdueTasks + ' overdue tasks require attention' });
  }
  if (kpis.totalJobs > 0 && kpis.openIssues > 5) {
    alerts.push({ severity: 'warning', category: 'operations', message: kpis.openIssues + ' open issues on jobs' });
  }

  // Asset alerts
  if (kpis.assetsOutOfService > 0) {
    alerts.push({ severity: 'warning', category: 'assets', message: kpis.assetsOutOfService + ' asset(s) out of service' });
  }
  if (kpis.upcomingMaintenance > 5) {
    alerts.push({ severity: 'info', category: 'assets', message: kpis.upcomingMaintenance + ' maintenance tasks upcoming in 30 days' });
  }

  // Crew alerts
  if (kpis.expiredCertifications > 0) {
    alerts.push({ severity: 'warning', category: 'crew', message: kpis.expiredCertifications + ' expired certification(s)' });
  }

  // Pipeline alerts — only if system has been active
  if (kpis.activeDeals === 0 && kpis.totalDeals === 0 && kpis.totalCustomers > 0) {
    alerts.push({ severity: 'info', category: 'sales', message: 'Pipeline is empty — start a conversation to generate opportunities' });
  }

  // Company health — only when status is established (not baseline)
  if (kpis.healthStatus === 'established') {
    if (kpis.companyHealthScore < 40) {
      alerts.push({ severity: 'critical', category: 'company', message: 'Company health score is critical at ' + kpis.companyHealthScore + '/100' });
    } else if (kpis.companyHealthScore < 60) {
      alerts.push({ severity: 'warning', category: 'company', message: 'Company health score needs improvement at ' + kpis.companyHealthScore + '/100' });
    }
  }

  // Baseline-building info alerts — only when genuinely pre-activity.
  // A business with customers, deals, or jobs has graduated past the onboarding baseline.
  // Business guidance evolves with company maturity:
  //   No data → Onboarding   |  Customers → Engagement
  //   Active Leads → Sales   |  Jobs → Operations   |  Growing → Optimization
  var hasActivity = kpis.totalCustomers > 0 || kpis.activeDeals > 0 || kpis.totalDeals > 0 || kpis.totalJobs > 0;

  if (kpis.healthStatus === 'baseline' && !hasActivity) {
    alerts.push({ severity: 'info', category: 'company', message: 'Building baseline metrics — engage with customers to generate actionable intelligence' });
  }
  if (kpis.activeDeals === 0 && kpis.totalDeals === 0 && kpis.totalCustomers === 0 && kpis.totalJobs === 0) {
    alerts.push({ severity: 'info', category: 'sales', message: 'Building pipeline baseline — your first customer interaction will populate pipeline data' });
  }

  return {
    alerts: alerts,
    totalAlerts: alerts.length,
    criticalCount: alerts.filter(function (a) { return a.severity === 'critical'; }).length,
    warningCount: alerts.filter(function (a) { return a.severity === 'warning'; }).length,
    infoCount: alerts.filter(function (a) { return a.severity === 'info'; }).length,
    generatedAt: _now(),
  };
}

// ── Generic Access ──

function getAnalytics(category) {
  switch (category) {
    case 'executive': return generateExecutiveSummary();
    case 'financial': return generateFinancialDashboard();
    case 'sales': return generateSalesDashboard();
    case 'customer': return generateCustomerDashboard();
    case 'crew': return generateCrewDashboard();
    case 'asset': return generateAssetDashboard();
    case 'job': return generateJobDashboard();
    case 'workflow': return generateWorkflowDashboard();
    case 'operations': return generateOperationsDashboard();
    case 'kpis': return generateKPIs();
    case 'alerts': return generateAlerts();
    case 'forecast': return generateForecast();
    default: return generateDashboard();
  }
}

function listReports() {
  var reports = [
    { id: 'executive-summary', name: 'Executive Summary', category: 'executive' },
    { id: 'financial-dashboard', name: 'Financial Dashboard', category: 'financial' },
    { id: 'sales-dashboard', name: 'Sales Dashboard', category: 'sales' },
    { id: 'customer-dashboard', name: 'Customer Dashboard', category: 'customer' },
    { id: 'crew-dashboard', name: 'Crew Dashboard', category: 'crew' },
    { id: 'asset-dashboard', name: 'Asset Dashboard', category: 'asset' },
    { id: 'job-dashboard', name: 'Job Dashboard', category: 'job' },
    { id: 'workflow-dashboard', name: 'Workflow Dashboard', category: 'workflow' },
    { id: 'operations-dashboard', name: 'Operations Dashboard', category: 'operations' },
    { id: 'revenue-report', name: 'Revenue Report', category: 'financial' },
    { id: 'profit-report', name: 'Profitability Report', category: 'financial' },
    { id: 'forecast', name: 'Company Forecast', category: 'financial' },
    { id: 'performance-report', name: 'Performance Report', category: 'operations' },
    { id: 'productivity-report', name: 'Productivity Report', category: 'operations' },
    { id: 'utilization-report', name: 'Utilization Report', category: 'operations' },
    { id: 'customer-insights', name: 'Customer Insights', category: 'customer' },
    { id: 'growth-metrics', name: 'Growth Metrics', category: 'customer' },
    { id: 'retention-metrics', name: 'Retention Metrics', category: 'customer' },
    { id: 'kpis', name: 'Key Performance Indicators', category: 'executive' },
    { id: 'alerts', name: 'Alerts & Notifications', category: 'executive' },
  ];
  return { reports: reports, total: reports.length };
}

function searchReports(query) {
  if (!query) return { error: 'Search query is required' };
  var all = listReports().reports;
  var q = query.toLowerCase();
  var results = all.filter(function (r) {
    return r.name.toLowerCase().indexOf(q) !== -1 || r.category.toLowerCase().indexOf(q) !== -1;
  });
  return { reports: results, total: results.length };
}

// ── Module Exports ──

module.exports = {
  init: init,

  // Dashboards
  generateDashboard: generateDashboard,
  generateExecutiveSummary: generateExecutiveSummary,
  generateOperationsDashboard: generateOperationsDashboard,
  generateFinancialDashboard: generateFinancialDashboard,
  generateSalesDashboard: generateSalesDashboard,
  generateCustomerDashboard: generateCustomerDashboard,
  generateCrewDashboard: generateCrewDashboard,
  generateAssetDashboard: generateAssetDashboard,
  generateJobDashboard: generateJobDashboard,
  generateWorkflowDashboard: generateWorkflowDashboard,

  // Reports
  generateRevenueReport: generateRevenueReport,
  generateProfitReport: generateProfitReport,
  generateForecast: generateForecast,
  generateTrendAnalysis: generateTrendAnalysis,
  generatePerformanceReport: generatePerformanceReport,
  generateProductivityReport: generateProductivityReport,
  generateUtilizationReport: generateUtilizationReport,

  // Insights
  generateCustomerInsights: generateCustomerInsights,
  generateGrowthMetrics: generateGrowthMetrics,
  generateRetentionMetrics: generateRetentionMetrics,

  // KPIs & Alerts
  generateKPIs: generateKPIs,
  generateAlerts: generateAlerts,

  // Generic Access
  getAnalytics: getAnalytics,
  listReports: listReports,
  searchReports: searchReports,
};