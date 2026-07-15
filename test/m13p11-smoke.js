/**
 * M13-P11: Polaris Engines API Routes — Smoke Tests
 *
 * Tests that all 9 engine API routes are mounted and respond correctly.
 * Uses the Express app instance to avoid needing a running server.
 */
const express = require('express');
const http = require('http');

// Load the routes module
const polarisEngines = require('../src/routes/polaris-engines');

var pass = 0, fail = 0;
function c(l, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL:', l); } }

// Create a mini Express app with the routes
var app = express();
app.use(express.json());
app.use('/api/v1', polarisEngines);

// Helper to make test requests
function request(method, path, body) {
  return new Promise(function (resolve) {
    var options = {
      hostname: '127.0.0.1',
      port: 0,
      path: '/api/v1' + path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };

    var server = app.listen(0, function () {
      options.port = server.address().port;
      var req = http.request(options, function (res) {
        var data = '';
        res.on('data', function (chunk) { data += chunk; });
        res.on('end', function () {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', function (err) {
        server.close();
        resolve({ status: 0, body: { error: err.message } });
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// Use async test runner
async function runTests() {
  // 1. Engine status
  var res = await request('GET', '/engines');
  c('engines endpoint returns 200', res.status === 200);
  c('engines has version', res.body.version === '13.0');
  c('engines lists all engines', typeof res.body.engines === 'object');

  // 2. Customers
  res = await request('GET', '/customers');
  c('customers GET returns 200', res.status === 200);

  res = await request('POST', '/customers', { name: 'API Test Customer', email: 'api@test.com' });
  c('customers POST returns 201', res.status === 201);
  c('customers POST returns id', !!res.body.id);
  var custId = res.body.id;

  res = await request('GET', '/customers/' + custId);
  c('customers GET by id returns 200', res.status === 200);
  c('customers GET by id returns name', res.body.name === 'API Test Customer');

  res = await request('GET', '/customers/' + custId + '/health');
  c('customers health returns 200', res.status === 200);

  res = await request('DELETE', '/customers/' + custId);
  c('customers DELETE returns 200', res.status === 200);

  res = await request('POST', '/customers/' + custId + '/restore');
  c('customers restore returns 200', res.status === 200);

  // 3. Communications
  res = await request('POST', '/communications', {
    customerId: 'api_test_cust',
    type: 'call',
    direction: 'inbound',
    subject: 'API test call',
    content: 'Test communication via API',
  });
  c('communications POST returns 201', res.status === 201);
  var commId = res.body.id;

  res = await request('GET', '/communications/' + commId);
  c('communications GET by id', res.status === 200);

  res = await request('GET', '/communications/timeline/api_test_cust');
  c('communications timeline', res.status === 200);

  res = await request('GET', '/communications/intelligence/api_test_cust');
  c('communications intelligence', res.status === 200);
  c('intelligence has lastContact', typeof res.body.lastContact === 'object');

  res = await request('GET', '/communications/search?q=API');
  c('communications search', res.status === 200);

  res = await request('PUT', '/communications/' + commId + '/status', { status: 'resolved' });
  c('communications status update', res.status === 200);

  // 4. Opportunities
  res = await request('POST', '/opportunities', {
    customerId: 'api_test_opp',
    title: 'API Test Opportunity',
    estimatedValue: 10000,
    stage: 'lead',
  });
  c('opportunities POST returns 201', res.status === 201);
  var oppId = res.body.id;

  res = await request('GET', '/opportunities');
  c('opportunities GET', res.status === 200);

  res = await request('GET', '/opportunities/pipeline');
  c('opportunities pipeline', res.status === 200);

  res = await request('GET', '/opportunities/queue');
  c('opportunities queue', res.status === 200);

  res = await request('GET', '/opportunities/' + oppId);
  c('opportunities GET by id', res.status === 200);

  res = await request('PUT', '/opportunities/' + oppId + '/stage', { stage: 'qualified' });
  c('opportunities stage update', res.status === 200);

  // 5. Workflows
  res = await request('POST', '/workflows', {
    title: 'API Test Task',
    type: 'task',
    priority: 'high',
    owner: 'API Tester',
  });
  c('workflows POST returns 201', res.status === 201);
  var wfId = res.body.id;

  res = await request('GET', '/workflows');
  c('workflows GET', res.status === 200);

  res = await request('GET', '/workflows/' + wfId);
  c('workflows GET by id', res.status === 200);

  res = await request('POST', '/workflows/' + wfId + '/complete');
  c('workflows complete', res.status === 200);

  res = await request('GET', '/workflows/agenda/today');
  c('workflows agenda today', res.status === 200);

  res = await request('GET', '/workflows/agenda/overdue');
  c('workflows agenda overdue', res.status === 200);

  res = await request('GET', '/workflows/agenda/upcoming');
  c('workflows agenda upcoming', res.status === 200);

  res = await request('GET', '/workflows/metrics');
  c('workflows metrics', res.status === 200);

  // 6. Financial
  res = await request('POST', '/financial/estimates', {
    customerId: 'api_test_fin',
    title: 'API Test Estimate',
    items: [{ description: 'Service', quantity: 1, unitPrice: 500 }],
  });
  c('financial estimates POST', res.status === 201);
  var estId = res.body.id;

  res = await request('GET', '/financial/estimates');
  c('financial estimates GET', res.status === 200);

  res = await request('GET', '/financial/estimates/' + estId);
  c('financial estimates GET by id', res.status === 200);

  res = await request('POST', '/financial/invoices', {
    customerId: 'api_test_fin',
    title: 'API Test Invoice',
    items: [{ description: 'Service', quantity: 1, unitPrice: 500 }],
  });
  c('financial invoices POST', res.status === 201);
  var invId = res.body.id;

  res = await request('GET', '/financial/invoices');
  c('financial invoices GET', res.status === 200);

  res = await request('GET', '/financial/invoices/' + invId);
  c('financial invoices GET by id', res.status === 200);

  res = await request('POST', '/financial/invoices/' + invId + '/send');
  c('financial invoices send', res.status === 200);

  res = await request('POST', '/financial/payments', {
    invoiceId: invId,
    amount: 500,
    method: 'creditCard',
  });
  c('financial payments POST', res.status === 201);

  res = await request('GET', '/financial/metrics');
  c('financial metrics', res.status === 200);

  // 7. Assets
  res = await request('POST', '/assets', {
    name: 'API Test Asset',
    type: 'vehicle',
    purchaseCost: 30000,
  });
  c('assets POST', res.status === 201);
  var astId = res.body.id;

  res = await request('GET', '/assets');
  c('assets GET', res.status === 200);

  res = await request('GET', '/assets/' + astId);
  c('assets GET by id', res.status === 200);

  res = await request('GET', '/assets/metrics');
  c('assets metrics', res.status === 200);

  res = await request('GET', '/assets/' + astId + '/analytics');
  c('assets analytics', res.status === 200);

  // 8. Crew
  res = await request('POST', '/crew/employees', {
    name: 'API Test Employee',
    role: 'foreman',
    hourlyRate: 35,
  });
  c('crew employees POST', res.status === 201);
  var empId = res.body.id;

  res = await request('GET', '/crew/employees');
  c('crew employees GET', res.status === 200);

  res = await request('GET', '/crew/employees/' + empId);
  c('crew employees GET by id', res.status === 200);

  res = await request('POST', '/crew/crews', { name: 'API Test Crew' });
  c('crew crews POST', res.status === 201);
  var crewId = res.body.id;

  res = await request('GET', '/crew/crews');
  c('crew crews GET', res.status === 200);

  res = await request('GET', '/crew/metrics');
  c('crew metrics', res.status === 200);

  // 9. Jobs
  res = await request('POST', '/jobs', {
    title: 'API Test Job',
    customerId: 'api_test_job',
    estimatedCost: 5000,
  });
  c('jobs POST', res.status === 201);
  var jobId = res.body.id;

  res = await request('GET', '/jobs');
  c('jobs GET', res.status === 200);

  res = await request('GET', '/jobs/' + jobId);
  c('jobs GET by id', res.status === 200);

  res = await request('GET', '/jobs/metrics');
  c('jobs metrics', res.status === 200);

  res = await request('GET', '/jobs/' + jobId + '/analytics');
  c('jobs analytics', res.status === 200);

  // 10. Analytics
  res = await request('GET', '/analytics/dashboard');
  c('analytics dashboard', res.status === 200);

  res = await request('GET', '/analytics/executive');
  c('analytics executive', res.status === 200);

  res = await request('GET', '/analytics/kpis');
  c('analytics kpis', res.status === 200);

  res = await request('GET', '/analytics/alerts');
  c('analytics alerts', res.status === 200);

  res = await request('GET', '/analytics/financial');
  c('analytics by category', res.status === 200);

  res = await request('GET', '/analytics/reports/list');
  c('analytics reports list', res.status === 200);

  // Summary
  console.log('PASSED: ' + pass + '/' + (pass + fail));
  if (fail > 0) process.exit(1);
  console.log('ALL TESTS PASSED');
}

runTests().catch(function (err) {
  console.error('Test runner error:', err);
  process.exit(1);
});