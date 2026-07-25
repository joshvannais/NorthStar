/**
 * Tests for src/routes/demo.js — M17 P3
 *
 * Tests the demo session lifecycle: create, transcript, guidance, status.
 *
 * Run: node tests/test-demo-routes.js
 */

const express = require('express');
const demoRouter = require('../src/routes/demo');
const { correlationId } = require('../src/middleware/auditLog');
const { errorHandler, normalizeErrorResponses } = require('../src/middleware/errorHandler');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ FAIL: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ FAIL: ' + message + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function assertContains(haystack, needle, message) {
  if (haystack && haystack.includes(needle)) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ FAIL: ' + message + ' — "' + needle + '" not found');
  }
}

// ── Setup minimal Express app for testing routes ──
function createTestApp() {
  const app = express();
  app.use(correlationId);
  app.use(normalizeErrorResponses);
  app.use(express.json());
  app.use('/api/demo', demoRouter);
  app.use(errorHandler);
  return app;
}

// ── Helper: simulate HTTP requests ──
function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: 'localhost',
        port,
        path: path,
        method,
        headers: { 'Content-Type': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch(e) {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ── Run all tests ──
async function runTests() {
  const app = createTestApp();

  // ── Test: POST /call — valid request ──
  console.log('\n📋 Test: POST /api/demo/call — valid');
  try {
    const res = await request(app, 'POST', '/api/demo/call', {
      businessName: 'Test Roofing Co',
      industry: 'Roofing',
      phoneNumber: '(555) 111-2222',
    });
    assertEqual(res.status, 200, 'Returns 200 OK');
    assert(res.body.demoSessionId !== undefined, 'Returns demoSessionId');
    assert(res.body.callId !== undefined, 'Returns callId');
    assert(res.body.status !== undefined, 'Returns status');
    assert(typeof res.body.demoSessionId === 'string', 'demoSessionId is string');
    assert(res.body.demoSessionId.length > 0, 'demoSessionId is non-empty');
    assertContains(['idle', 'call_created'].join(','), res.body.status, 'status matches the supported ready state');

    var demoId = res.body.demoSessionId;

    // ── Test: GET /:id/transcript ──
    console.log('\n📋 Test: GET /api/demo/:id/transcript');
    const transcriptRes = await request(app, 'GET', '/api/demo/' + demoId + '/transcript');
    assertEqual(transcriptRes.status, 200, 'Returns 200 OK');
    assert(transcriptRes.body.lines !== undefined, 'Returns lines array');
    assert(Array.isArray(transcriptRes.body.lines), 'lines is array');
    assert(transcriptRes.body.count !== undefined, 'Returns count');
    assertEqual(transcriptRes.body.sessionId, demoId, 'sessionId matches');

    // Check transcript line structure
    if (transcriptRes.body.lines.length > 0) {
      const line = transcriptRes.body.lines[0];
      assert(line.speaker !== undefined, 'Line has speaker');
      assert(line.text !== undefined, 'Line has text');
      assertContains(['ai', 'customer', 'system'].join(','), line.speaker, 'Speaker is valid');
    }

    // ── Test: GET /:id/polaris-estimate ──
    // The retired /guidance route was replaced by the status AI panels and
    // the canonical Polaris estimate endpoint.
    console.log('\n📋 Test: GET /api/demo/:id/polaris-estimate');
    const estimateRes = await request(app, 'GET', '/api/demo/' + demoId + '/polaris-estimate');
    assertEqual(estimateRes.status, 200, 'Returns 200 OK');
    assertEqual(estimateRes.body.polairsState, 'waiting', 'Pre-live Polaris state is waiting');
    assertEqual(estimateRes.body.confidence, 0, 'Pre-live confidence is zero');
    assert(Array.isArray(estimateRes.body.reasoning), 'Pre-live reasoning is an array');

    // ── Test: GET /:id/status ──
    console.log('\n📋 Test: GET /api/demo/:id/status');
    const statusRes = await request(app, 'GET', '/api/demo/' + demoId + '/status');
    assertEqual(statusRes.status, 200, 'Returns 200 OK');
    assert(statusRes.body.sessionId !== undefined, 'Has sessionId');
    assert(statusRes.body.callId !== undefined, 'Has callId');
    assert(statusRes.body.callStatus !== undefined, 'Has callStatus');
    assert(typeof statusRes.body.duration === 'number', 'duration is number');
    assert(statusRes.body.businessName !== undefined, 'Has businessName');
    assert(statusRes.body.industry !== undefined, 'Has industry');
    assert(statusRes.body.customerIntent !== undefined, 'Has customerIntent');
    assert(statusRes.body.polarisEstimate !== undefined, 'Has canonical Polaris estimate');
    assert(statusRes.body.polarisState !== undefined, 'Has canonical Polaris state');
    assert(statusRes.body.leadQualification !== undefined, 'Has leadQualification');
    assert(statusRes.body.bookingProbability !== undefined, 'Has bookingProbability');
    assert(Array.isArray(statusRes.body.recommendedActions), 'Has recommendedActions array');
    assert(statusRes.body.executiveSummary !== undefined, 'Has executiveSummary');

    // ── Test: GET /:id/* — nonexistent session ──
    console.log('\n📋 Test: 404 for nonexistent session');
    const notFoundRes = await request(app, 'GET', '/api/demo/nonexistent-id/transcript');
    assertEqual(notFoundRes.status, 404, 'Returns 404 for nonexistent session');

    // ── Test: POST /call — validation ──
    console.log('\n📋 Test: POST /api/demo/call — validation');
    const invalidRes = await request(app, 'POST', '/api/demo/call', {
      businessName: 'Test',
      // missing industry and phoneNumber
    });
    assertEqual(invalidRes.status, 400, 'Returns 400 for missing fields');
    assert(typeof invalidRes.body.error === 'string', 'Returns backward-compatible error string');
    assertEqual(invalidRes.body.code, 'bad_request', 'Returns normalized validation code');
    assert(/^[0-9a-f-]{36}$/i.test(invalidRes.body.requestId), 'Returns canonical request ID');

    // ── Test: POST /call — invalid industry ──
    console.log('\n📋 Test: POST /api/demo/call — invalid industry');
    const badIndustryRes = await request(app, 'POST', '/api/demo/call', {
      businessName: 'Test',
      industry: 'InvalidIndustry',
      phoneNumber: '(555) 000-0000',
    });
    assertEqual(badIndustryRes.status, 400, 'Returns 400 for invalid industry');

    // ── Test: Multiple sessions ──
    console.log('\n📋 Test: Multiple demo sessions');
    const res2 = await request(app, 'POST', '/api/demo/call', {
      businessName: 'Plumbing Pro',
      industry: 'Plumbing',
      phoneNumber: '(555) 333-4444',
    });
    assertEqual(res2.status, 200, 'Second session created');
    assert(res2.body.demoSessionId !== demoId, 'Second session has different ID');

    // ── Test: Cross-industry status intelligence ──
    console.log('\n📋 Test: Industry-specific status intelligence');
    const industries = ['Roofing', 'Plumbing', 'HVAC', 'Electrical', 'Landscaping', 'Home Security', 'General Contracting'];
    for (const ind of industries) {
      const indRes = await request(app, 'POST', '/api/demo/call', {
        businessName: ind + ' Test Co',
        industry: ind,
        phoneNumber: '(555) 000-' + (1000 + industries.indexOf(ind)).toString(),
      });
      assertEqual(indRes.status, 200, ind + ' session created OK');
      const status = await request(app, 'GET', '/api/demo/' + indRes.body.demoSessionId + '/status');
      assertEqual(status.status, 200, ind + ' status intelligence OK');
      assertEqual(status.body.industry, ind, ind + ' preserves industry');
      assert(typeof status.body.customerIntent === 'string', ind + ' has customerIntent string');
      assert(status.body.polarisEstimate !== undefined, ind + ' has Polaris estimate');
    }

    // ── Test: Transcript progression ──
    console.log('\n📋 Test: Transcript grows over time');
    const progRes = await request(app, 'POST', '/api/demo/call', {
      businessName: 'Progression Test',
      industry: 'Roofing',
      phoneNumber: '(555) 999-0000',
    });
    const t1 = await request(app, 'GET', '/api/demo/' + progRes.body.demoSessionId + '/transcript');
    assertEqual(t1.body.lines.length, 0, 'Ready-state transcript is empty');
    assertEqual(t1.body.conversationState, 'waiting', 'Ready-state transcript reports waiting');
    const simulate = await request(app, 'POST', '/api/demo/' + progRes.body.demoSessionId + '/simulate');
    assertEqual(simulate.status, 200, 'Simulation starts from idle');
    assertEqual(simulate.body.status, 'simulation', 'Simulation enters simulation state');
    await new Promise(resolve => setTimeout(resolve, 3200));
    const t2 = await request(app, 'GET', '/api/demo/' + progRes.body.demoSessionId + '/transcript');
    assert(t2.body.lines.length >= 1, 'Transcript grows after simulation enters live state');
    assertEqual(t2.body.conversationState, 'live', 'Progressed transcript reports live state');

  } catch (err) {
    failed++;
    console.error('  ✗ FAIL: Test threw: ' + err.message);
    console.error(err.stack);
  }

  // ── Results ──
  console.log('\n═══════════════════════════════════');
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('═══════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
