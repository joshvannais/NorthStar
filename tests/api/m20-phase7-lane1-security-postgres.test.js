'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const ORGANIZATION_ID = '7e100000-0000-4000-8000-000000000001';
const OWNER_ID = '7e200000-0000-4000-8000-000000000001';
const MEMBER_ID = '7e200000-0000-4000-8000-000000000002';
const POISON = Object.freeze({
  name: 'Customer\"><a data-phase7-name href="https://phase7.invalid/navigation" onclick="window.__phase7name=1">Poison</a><img data-phase7-name src="https://phase7.invalid/name" onerror="window.__phase7name=1">',
  phone: '555</div><svg data-phase7-phone onload="window.__phase7phone=1"></svg>',
  email: 'mail<a data-phase7-email href="https://phase7.invalid/email">@example.test</a>',
  address: '1 Main</div><iframe data-phase7-address src="https://phase7.invalid/address"></iframe>',
  service: 'repair</div><img data-phase7-service src="https://phase7.invalid/service">',
});
const FORMULA_VARIANTS = Object.freeze([
  '=HYPERLINK("https://phase7.invalid/formula","x,y")',
  '+SUM(1,2)',
  '-1+2',
  '@SUM(1,2)',
  '\t=HYPERLINK("https://phase7.invalid/tab","tab")',
  '\r=HYPERLINK("https://phase7.invalid/cr","cr")',
  '\n=HYPERLINK("https://phase7.invalid/lf","lf")',
  '\u0001=CONTROL()',
  '\u007f=DEL()',
  '\u0085=CONTROL()',
  '   =SUM(3,4)',
  '\u00a0@SUM(5,6)',
  '\u2003+SUM(7,8)',
  '\tordinary-control-prefix',
  '  ordinary leading space',
  'Zo\u00eb \u6771\u4eac',
  'Acme, "North"',
]);
const PROVIDER_ENVIRONMENT = Object.freeze([
  'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
]);

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

function utf8Hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

async function canonicalAuthorityDigest(pool) {
  const result = await pool.query(
    `SELECT c.id, c.name, c.phone, c.email, c.address,
            o.id AS opportunity_id, o.service_type, o.status, e.customer_price
       FROM canonical_customers c
       JOIN canonical_opportunities o
         ON o.organization_id = c.organization_id AND o.customer_id = c.id
       JOIN canonical_estimates e
         ON e.organization_id = o.organization_id AND e.operation_id = o.operation_id
      WHERE c.organization_id = $1
      ORDER BY c.id, o.id`,
    [ORGANIZATION_ID]
  );
  return crypto.createHash('sha256').update(JSON.stringify(result.rows), 'utf8').digest('hex');
}

function expectedSpreadsheetText(value) {
  const text = value === undefined || value === null ? '' : String(value);
  const beginsWithControl = /^[\u0000-\u001f\u007f-\u009f]/u.test(text);
  const formulaAfterLeadingSpaceOrControl = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text);
  return beginsWithControl || formulaAfterLeadingSpaceOrControl ? "'" + text : text;
}

function parseCsv(raw) {
  const text = String(raw).replace(/^\ufeff/u, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function canonicalScope() {
  return {
    jobType: 'replace', linearFeet: 100, height: 6, material: 'cedar',
    removalRequired: true, gates: [{ type: 'walk' }], permitsRequired: true,
  };
}

realPostgres('Mission 20 Phase 7 Lane 1 customer and CSV security boundary', () => {
  let suiteDatabase;
  let db;
  let pool;
  let app;
  let ownerSession;
  let memberSession;
  let beforeData;
  let originalEnvironment;
  let poisonIds;

  beforeAll(async () => {
    beforeData = dataDigest();
    originalEnvironment = new Map(['DATABASE_URL', 'AUTH_ACCESS_SECRET'].concat(PROVIDER_ENVIRONMENT)
      .map(name => [name, process.env[name]]));
    suiteDatabase = await createSuiteDatabase('m20-phase7-lane1-api');
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    PROVIDER_ENVIRONMENT.forEach(name => { delete process.env[name]; });

    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    const identity = await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums`
    );
    expect(identity.rows[0].version).toMatch(/^18\.4(?:\s|$)/);
    expect(identity.rows[0].timezone).toBe('UTC');
    expect(identity.rows[0].checksums).toBe('on');

    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Phase 7 Lane 1', 'phase7-lane1@example.test')`,
      [ORGANIZATION_ID]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES
         ($1,$3,'Phase 7 Owner','phase7-owner@example.test','not-used','owner','active'),
         ($2,$3,'Phase 7 Member','phase7-member@example.test','not-used','member','active')`,
      [OWNER_ID, MEMBER_ID, ORGANIZATION_ID]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const businessProfile = canonicalFenceProfile({ version: 'm20-phase7-lane1-api-v1' });
    businessProfile.company.timeZone = 'America/New_York';
    await putBusinessProfile(pool, {
      organizationId: ORGANIZATION_ID,
      userId: OWNER_ID,
      expectedVersion: null,
      profile: businessProfile,
    });
    ownerSession = await provisionDurableSession(pool, {
      userId: OWNER_ID, organizationId: ORGANIZATION_ID, role: 'owner',
    });
    memberSession = await provisionDurableSession(pool, {
      userId: MEMBER_ID, organizationId: ORGANIZATION_ID, role: 'member',
    });
    ({ app } = require('../../src/server'));

    const created = await request(app).post('/api/leads')
      .set(memberSession.headers)
      .set('Idempotency-Key', 'phase7-lane1-poison')
      .send({
        customerName: POISON.name,
        phone: POISON.phone,
        email: POISON.email,
        address: POISON.address,
        service: POISON.service,
        externalCustomerId: 'phase7-lane1-poison-customer',
      });
    expect(created.status).toBe(201);
    poisonIds = created.body.ids;
  }, 120000);

  afterAll(async () => {
    if (db) await db.close();
    if (suiteDatabase) await suiteDatabase.cleanup();
    if (originalEnvironment) {
      originalEnvironment.forEach((value, name) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }
    expect(dataDigest()).toBe(beforeData);
  }, 120000);

  test('mounted member write, PostgreSQL bytes, and canonical read APIs preserve customer authority exactly', async () => {
    const durable = await pool.query(
      `SELECT
         encode(convert_to(c.name, 'UTF8'), 'hex') AS name_hex,
         encode(convert_to(c.phone, 'UTF8'), 'hex') AS phone_hex,
         encode(convert_to(c.email, 'UTF8'), 'hex') AS email_hex,
         encode(convert_to(c.address #>> '{}', 'UTF8'), 'hex') AS address_hex,
         encode(convert_to(o.service_type, 'UTF8'), 'hex') AS service_hex
       FROM canonical_customers c
       JOIN canonical_opportunities o
         ON o.organization_id = c.organization_id AND o.customer_id = c.id
       WHERE c.organization_id = $1 AND c.id = $2`,
      [ORGANIZATION_ID, poisonIds.customer]
    );
    expect(durable.rows).toEqual([{
      name_hex: utf8Hex(POISON.name),
      phone_hex: utf8Hex(POISON.phone),
      email_hex: utf8Hex(POISON.email),
      address_hex: utf8Hex(POISON.address),
      service_hex: utf8Hex(POISON.service.toLowerCase()),
    }]);

    const endpoints = [
      ['/api/v1/customers', 'customers', true],
      ['/api/v1/opportunities', 'opportunities', false],
      ['/api/v1/communications', 'communications', false],
      ['/api/v1/workflows/agenda/today', 'tasks', false],
    ];
    for (const [endpoint, key, customerRoot] of endpoints) {
      const response = await request(app).get(endpoint).set(ownerSession.headers);
      expect(response.status).toBe(200);
      const records = response.body[key];
      expect(Array.isArray(records)).toBe(true);
      const record = records.find(item => customerRoot
        ? item.id === poisonIds.customer
        : item.customer && item.customer.id === poisonIds.customer);
      expect(record).toBeTruthy();
      expect(customerRoot ? record : record.customer).toMatchObject({
        name: POISON.name, phone: POISON.phone, email: POISON.email, address: POISON.address,
      });
    }
  }, 120000);

  test('mounted lead export neutralizes the full formula/control corpus in every projected text field without changing PostgreSQL', async () => {
    const corpus = [];
    for (let index = 0; index < FORMULA_VARIANTS.length; index += 1) {
      const created = await request(app).post('/api/leads')
        .set(memberSession.headers)
        .set('Idempotency-Key', `phase7-lane1-csv-${index}`)
        .send({
          customerName: `CSV Customer ${index}`,
          phone: `+1555501${String(index).padStart(4, '0')}`,
          email: `phase7-csv-${index}@example.test`,
          address: `${index} CSV Lane`,
          service: 'fence',
          scope: canonicalScope(),
          externalCustomerId: `phase7-lane1-csv-customer-${index}`,
        });
      expect(created.status).toBe(201);
      const variant = FORMULA_VARIANTS[index];
      await pool.query(
        `UPDATE canonical_customers
            SET name = $3, phone = $3, email = $3
          WHERE organization_id = $1 AND id = $2`,
        [ORGANIZATION_ID, created.body.ids.customer, variant]
      );
      await pool.query(
        `UPDATE canonical_opportunities
            SET service_type = $3, status = $3
          WHERE organization_id = $1 AND id = $2`,
        [ORGANIZATION_ID, created.body.ids.opportunity, variant]
      );
      corpus.push({ variant, ids: created.body.ids });
    }

    const before = await canonicalAuthorityDigest(pool);
    const exported = await request(app).get('/api/leads/export').set(ownerSession.headers);
    const after = await canonicalAuthorityDigest(pool);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toMatch(/^text\/csv/);
    expect(after).toBe(before);

    const rows = parseCsv(exported.text);
    const headers = rows[0];
    expect(headers).toEqual(['id', 'customerId', 'customerName', 'phone', 'email', 'service', 'status', 'estimatedPrice']);
    const records = rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
    for (const entry of corpus) {
      const record = records.find(candidate => candidate.id === entry.ids.opportunity);
      expect(record).toBeTruthy();
      const expected = expectedSpreadsheetText(entry.variant);
      expect(record.customerId).toBe(entry.ids.customer);
      expect(record.customerName).toBe(expected);
      expect(record.phone).toBe(expected);
      expect(record.email).toBe(expected);
      expect(record.service).toBe(expected);
      expect(record.status).toBe(expected);
      expect(record.estimatedPrice === '' || /^\d+(?:\.\d+)?$/u.test(record.estimatedPrice)).toBe(true);
    }
  }, 120000);
});
