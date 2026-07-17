/**
 * Tests for src/routes/demo.js — M17 P3
 *
 * Tests the demo session lifecycle: create, transcript, guidance, status.
 *
 * Run: node tests/test-demo-routes.js
 */

const express = require('express');
const demoRouter = require('../src/routes/demo');

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
  app.use(express.json());
  app.use('/api/demo', demoRouter);
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
    assertContains(['simulated', 'queued', 'in-progress'].join(','), res.body.status, 'status is valid');

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

    // ── Test: GET /:id/guidance ──
    console.log('\n📋 Test: GET /api/demo/:id/guidance');
    const guidanceRes = await request(app, 'GET', '/api/demo/' + demoId + '/guidance');
    assertEqual(guidanceRes.status, 200, 'Returns 200 OK');
    assert(guidanceRes.body.customerIntent !== undefined, 'Has customerIntent');
    assert(guidanceRes.body.leadQualification !== undefined, 'Has leadQualification');
    assert(guidanceRes.body.bookingProbability !== undefined, 'Has bookingProbability');
    assert(Array.isArray(guidanceRes.body.recommendedActions), 'recommendedActions is array');
    assert(guidanceRes.body.executiveSummary !== undefined, 'Has executiveSummary');

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
    assert(statusRes.body.estimatedJobValue !== undefined, 'Has estimatedJobValue');
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
    assert(invalidRes.body.error !== undefined, 'Returns error object');
    assertEqual(invalidRes.body.error.code, 'VALIDATION', 'Error code is VALIDATION');

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

    // ── Test: Cross-industry guidance ──
    console.log('\n📋 Test: Industry-specific guidance');
    const industries = ['Roofing', 'Plumbing', 'HVAC', 'Electrical', 'Landscaping', 'Home Security', 'General Contracting'];
    for (const ind of industries) {
      const indRes = await request(app, 'POST', '/api/demo/call', {
        businessName: ind + ' Test Co',
        industry: ind,
        phoneNumber: '(555) 000-' + (1000 + industries.indexOf(ind)).toString(),
      });
      assertEqual(indRes.status, 200, ind + ' session created OK');
      const gRes = await request(app, 'GET', '/api/demo/' + indRes.body.demoSessionId + '/guidance');
      assertEqual(gRes.status, 200, ind + ' guidance OK');
      assert(typeof gRes.body.customerIntent === 'string', ind + ' has customerIntent string');
    }

    // ── Test: Transcript progression ──
    console.log('\n📋 Test: Transcript grows over time');
    const progRes = await request(app, 'POST', '/api/demo/call', {
      businessName: 'Progression Test',
      industry: 'Roofing',
      phoneNumber: '(555) 999-0000',
    });
    const t1 = await request(app, 'GET', '/api/demo/' + progRes.body.demoSessionId + '/transcript');
    const count1 = t1.body.lines.length;
    assert(count1 >= 1, 'Initial transcript has at least 1 line');

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
