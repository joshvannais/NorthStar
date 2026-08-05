'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const { ingestSimulation } = require('../../src/services/canonicalGraphService');
const { createCanonicalRouter, createCompatibilityRouter } = require('../../src/routes/canonicalPolaris');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = fs.readdirSync(path.join(ROOT, 'migrations'))
  .filter(function (filename) { return /^\d+.*\.sql$/.test(filename); })
  .sort();
const ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const SESSION_ID = 'm19-transcript-renderer-pg';
const IMAGE_PAYLOAD = '<img src="/m19-transcript-attack-pg" onerror="window.__m19TranscriptXss=1">';
const CLOSING_PAYLOAD = '</div><script>window.__m19TranscriptScript=1</script><svg onload="window.__m19TranscriptSvg=1">';
const CUSTOMER_NAME = '<img/src=/m19-transcript-attack-pg-label/onerror=window.__m19TranscriptLabelXss=1> Cedar';

function dataDigest() {
  const root = path.join(ROOT, 'data');
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    fs.readdirSync(directory, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    }).forEach(function (entry) {
      const absolute = path.join(directory, entry.name);
      hash.update(entry.isDirectory() ? 'directory:' : 'file:');
      hash.update(path.relative(root, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    });
  }
  visit(root);
  return hash.digest('hex');
}

async function applyMigrations(pool) {
  for (const filename of MIGRATIONS) {
    await pool.query(fs.readFileSync(path.join(ROOT, 'migrations', filename), 'utf8'));
  }
}

function fakeAuth(req, _res, next) {
  req.tenantContext = Object.freeze({ organizationId: ORGANIZATION_ID, userId: USER_ID, role: 'owner' });
  req.orgId = ORGANIZATION_ID;
  req.userRole = 'owner';
  req.user = Object.freeze({ id: USER_ID, organizationId: ORGANIZATION_ID, role: 'owner' });
  next();
}

function createApp(pool) {
  const app = express();
  app.use(function (req, _res, next) {
    req.requestId = 'm19-transcript-request';
    next();
  });
  app.use(express.json());
  const dependencies = {
    poolProvider: function () { return pool; },
    auth: fakeAuth,
    cache: { get: async function () { return null; }, set: async function () {}, del: async function () {} },
    audit: { record: async function () {} },
  };
  app.use('/api/v1/canonical', createCanonicalRouter(dependencies));
  app.use('/api/v1', createCompatibilityRouter(dependencies));
  return app;
}

function graphInput(profile) {
  return {
    tenantContext: { organizationId: ORGANIZATION_ID, trusted: true },
    idempotencyKey: 'm19-transcript-renderer-persistence-v1',
    source: 'simulation',
    sourceVersion: 'm19-transcript-renderer-test-v1',
    external: {
      customerId: 'm19-transcript-customer',
      callId: SESSION_ID + ':call',
      transcriptId: 'm19-transcript-source',
      communicationId: 'm19-transcript-communication',
      appointmentId: 'm19-transcript-appointment',
    },
    customer: {
      name: CUSTOMER_NAME,
      phone: '+15555550100',
      email: 'transcript-safety@example.test',
      address: { line1: '100 Cedar Lane', city: 'Testville', state: 'NY', postalCode: '10001' },
    },
    transcript: [
      { turnId: 'turn-1', speaker: 'assistant', text: 'Structured ' + IMAGE_PAYLOAD },
      { turnId: 'turn-2', speaker: 'customer', text: CLOSING_PAYLOAD },
      { turnId: 'turn-3', speaker: 'mystery', text: 'Unknown speaker remains raw' },
    ],
    facts: [
      { variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'height', normalizedValue: 6, evidenceText: 'six-foot-high', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'material', normalizedValue: 'cedar', evidenceText: 'cedar fence', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'removalRequired', normalizedValue: true, evidenceText: 'existing fence removed', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'gates', normalizedValue: [{ type: 'walk' }], evidenceText: 'one walk gate', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'permitsRequired', normalizedValue: true, evidenceText: 'permits are required', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
    ],
    service: {
      key: 'fence',
      scope: {
        jobType: 'replace', linearFeet: 100, height: 6, material: 'cedar',
        removalRequired: true, gates: [{ type: 'walk' }], permitsRequired: true,
      },
    },
    businessProfileVersion: profile.version,
    businessProfile: profile,
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    callDurationSeconds: 242,
  };
}

realPostgres('Mission 19 transcript raw PostgreSQL authority', () => {
  let suiteDatabase;
  let pool;
  let beforeData;

  beforeAll(async () => {
    beforeData = dataDigest();
    suiteDatabase = await createSuiteDatabase('transcript-renderer');
    pool = new Pool({ connectionString: suiteDatabase.connectionString, max: 4 });
    await applyMigrations(pool);
  }, 120000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (suiteDatabase) await suiteDatabase.cleanup();
    expect(dataDigest()).toBe(beforeData);
  }, 120000);

  test('production ingestion, durable text, and canonical API preserve literal transcript bytes', async () => {
    const identity = await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums`
    );
    expect(identity.rows[0].version).toMatch(/^18\.4(?:\s|$)/);
    expect(identity.rows[0].timezone).toBe('UTC');
    expect(identity.rows[0].checksums).toBe('on');

    const profile = canonicalFenceProfile({ version: 'm19-transcript-renderer-profile-v1' });
    delete profile.canonicalPricing.taxRatePercent;
    await putBusinessProfile(pool, {
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      profile: profile,
    });
    const input = graphInput(profile);
    const original = JSON.parse(JSON.stringify(input));
    const result = await ingestSimulation(pool, input);
    expect(result.status).toBe(201);
    expect(input).toEqual(original);

    const expectedText = [
      'assistant: Structured ' + IMAGE_PAYLOAD,
      'customer: ' + CLOSING_PAYLOAD,
      'mystery: Unknown speaker remains raw',
    ].join('\n');
    const durable = await pool.query(
      `SELECT transcript_text, c.name AS customer_name
         FROM canonical_transcripts t
         JOIN canonical_customers c ON c.id = t.customer_id
        WHERE t.organization_id = $1`,
      [ORGANIZATION_ID]
    );
    expect(durable.rows).toEqual([{ transcript_text: expectedText, customer_name: CUSTOMER_NAME }]);

    const response = await request(createApp(pool))
      .get('/api/v1/canonical/compat/communications')
      .set('X-NorthStar-Session-ID', SESSION_ID)
      .expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.authority).toMatchObject({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      sessionId: SESSION_ID,
    });
    expect(response.body.data.records).toHaveLength(1);
    expect(response.body.data.records[0].transcript.text).toBe(expectedText);
    expect(response.body.data.records[0].customer.name).toBe(CUSTOMER_NAME);
    expect(response.body.data.records[0].transcript.text).toContain(IMAGE_PAYLOAD);
    expect(response.body.data.records[0].transcript.text).toContain(CLOSING_PAYLOAD);
  }, 120000);
});
