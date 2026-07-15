/**
 * M13-P10: Business Intelligence & Analytics Engine — Smoke Tests
 */
const store = require('../src/polaris/store');
const bi = require('../src/polaris/analytics-engine');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

// Init
var initResult = bi.init();
c('init returns object', typeof initResult === 'object');
c('init initialized', initResult.initialized === true);

// Create some data in the other engines for realistic analytics
try {
  var cust = require('../src/polaris/customer-engine');
  cust.init();
  cust.createCustomer({name: 'Analytics Test Customer', email: 'test@test.com'});
} catch(e) {}

try {
  var comms = require('../src/polaris/communications-engine');
  comms.init();
  comms.recordCommunication({customerId: 'analytics_test', type: 'call', direction: 'inbound', subject: 'Test call'});
} catch(e) {}

// 1. Dashboard
var dash = bi.generateDashboard();
c('dashboard has summary', typeof dash.summary === 'object');
c('dashboard has companyHealth', typeof dash.companyHealth === 'number');
c('dashboard has calculatedAt', typeof dash.calculatedAt === 'string');

// 2. Executive Summary
var exec = bi.generateExecutiveSummary();
c('executive summary title', exec.title === 'Executive Summary');
c('executive has revenue', typeof exec.revenue === 'object');
c('executive has pipeline', typeof exec.pipeline === 'object');
c('executive has operations', typeof exec.operations === 'object');

// 3. Financial Dashboard
var finDash = bi.generateFinancialDashboard();
c('financial dashboard title', finDash.title === 'Financial Dashboard');
c('financial has metrics', typeof finDash.metrics === 'object');

// 4. Sales Dashboard
var salesDash = bi.generateSalesDashboard();
c('sales dashboard title', salesDash.title === 'Sales Dashboard');
c('sales has pipeline', typeof salesDash.pipeline === 'object');
c('sales has metrics', typeof salesDash.metrics === 'object');

// 5. Customer Dashboard
var custDash = bi.generateCustomerDashboard();
c('customer dashboard title', custDash.title === 'Customer Dashboard');
c('customer has totalCustomers', typeof custDash.totalCustomers === 'number');

// 6. Crew Dashboard
var crewDash = bi.generateCrewDashboard();
c('crew dashboard title', crewDash.title === 'Crew Dashboard');

// 7. Asset Dashboard
var astDash = bi.generateAssetDashboard();
c('asset dashboard title', astDash.title === 'Asset Dashboard');

// 8. Job Dashboard
var jobDash = bi.generateJobDashboard();
c('job dashboard title', jobDash.title === 'Job Dashboard');

// 9. Workflow Dashboard
var wfDash = bi.generateWorkflowDashboard();
c('workflow dashboard title', wfDash.title === 'Workflow Dashboard');

// 10. Operations Dashboard
var opsDash = bi.generateOperationsDashboard();
c('operations dashboard title', opsDash.title === 'Operations Dashboard');
c('operations has jobs', typeof opsDash.jobs === 'object');
c('operations has workflows', typeof opsDash.workflows === 'object');
c('operations has assets', typeof opsDash.assets === 'object');
c('operations has crew', typeof opsDash.crew === 'object');

// 11. Revenue Report
var revReport = bi.generateRevenueReport();
c('revenue report title', revReport.title === 'Revenue Report');

// 12. Profit Report
var profReport = bi.generateProfitReport();
c('profit report title', profReport.title === 'Profitability Report');

// 13. Forecast
var fc = bi.generateForecast();
c('forecast title', fc.title === 'Company Forecast');
c('forecast has revenueForecast', typeof fc.revenueForecast === 'object');
c('forecast totalForecastRevenue', typeof fc.totalForecastRevenue === 'number');

// 14. Trend Analysis
var trend = bi.generateTrendAnalysis();
c('trend title', trend.title === 'Trend Analysis');

// 15. Performance Report
var perf = bi.generatePerformanceReport();
c('performance title', perf.title === 'Performance Report');

// 16. Productivity Report
var prod = bi.generateProductivityReport();
c('productivity title', prod.title === 'Productivity Report');

// 17. Utilization Report
var util = bi.generateUtilizationReport();
c('utilization title', util.title === 'Utilization Report');

// 18. Customer Insights
var ci = bi.generateCustomerInsights();
c('customer insights title', ci.title === 'Customer Insights');
c('insights has totalCustomers', typeof ci.totalCustomers === 'number');
c('insights has topCustomers', Array.isArray(ci.topCustomers));
c('insights has atRiskCustomers', typeof ci.atRiskCustomers === 'number');

// 19. Growth Metrics
var growth = bi.generateGrowthMetrics();
c('growth title', growth.title === 'Growth Metrics');

// 20. Retention Metrics
var ret = bi.generateRetentionMetrics();
c('retention title', ret.title === 'Retention Metrics');

// 21. KPIs
var kpis = bi.generateKPIs();
c('kpis object', typeof kpis.kpis === 'object');
c('kpis has totalRevenue', typeof kpis.kpis.totalRevenue === 'number');
c('kpis has winRate', typeof kpis.kpis.winRate === 'number');
c('kpis has taskCompletionRate', typeof kpis.kpis.taskCompletionRate === 'number');
c('kpis has companyHealthScore', kpis.kpis.companyHealthScore >= 0 && kpis.kpis.companyHealthScore <= 100);
c('kpis has totalAssets', typeof kpis.kpis.totalAssets === 'number');
c('kpis has totalEmployees', typeof kpis.kpis.totalEmployees === 'number');
c('kpis has totalCustomers', typeof kpis.kpis.totalCustomers === 'number');

// 22. Alerts
var alerts = bi.generateAlerts();
c('alerts has alerts array', Array.isArray(alerts.alerts));
c('alerts totalAlerts', typeof alerts.totalAlerts === 'number');
c('alerts criticalCount', typeof alerts.criticalCount === 'number');
c('alerts warningCount', typeof alerts.warningCount === 'number');

// 23. Get Analytics by Category
var exec2 = bi.getAnalytics('executive');
c('getAnalytics executive', exec2.title === 'Executive Summary');

var fin2 = bi.getAnalytics('financial');
c('getAnalytics financial', fin2.title === 'Financial Dashboard');

var sales2 = bi.getAnalytics('sales');
c('getAnalytics sales', sales2.title === 'Sales Dashboard');

var kpis2 = bi.getAnalytics('kpis');
c('getAnalytics kpis', typeof kpis2.kpis === 'object');

var alerts2 = bi.getAnalytics('alerts');
c('getAnalytics alerts', Array.isArray(alerts2.alerts));

var fc2 = bi.getAnalytics('forecast');
c('getAnalytics forecast', fc2.title === 'Company Forecast');

var defaultDash = bi.getAnalytics('unknown');
c('getAnalytics default', typeof defaultDash.summary === 'object');

// 24. List Reports
var list = bi.listReports();
c('list reports array', Array.isArray(list.reports));
c('list reports total', list.total >= 20);

// 25. Search Reports
var sr = bi.searchReports('financial');
c('search reports', sr.total >= 3 && Array.isArray(sr.reports));
c('search without query', bi.searchReports().error !== undefined);

// 26. Multiple Dashboard Types
var custDash2 = bi.generateCustomerDashboard();
c('customer dashboard avgRevenue', typeof custDash2.avgRevenuePerCustomer === 'number');

var wfDash2 = bi.generateWorkflowDashboard();
c('workflow has todayAgenda', typeof wfDash2.todayAgenda === 'object');
c('workflow has overdue', typeof wfDash2.overdue === 'object');

console.log('PASSED: ' + pass + '/' + (pass + fail));
if (fail > 0) process.exit(1);
console.log('ALL TESTS PASSED');