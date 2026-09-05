'use strict';
const assert = require('assert');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { createSuiteDatabase } = require('./m19-part3-postgres-database');
const { provisionDurableSession } = require('./account-session-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');
const quote = value => '"' + value.replace(/"/g, '""') + '"';
async function createFixture(name) {
  const database = await createSuiteDatabase(name);
  const ownerRole = `m23p5_browser_owner_${process.pid}`, runtimeRole = `m23p5_browser_runtime_${process.pid}`;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quote(ownerRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quote(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quote(database.databaseName)} OWNER TO ${quote(ownerRole)}`);
  } finally { await admin.end(); }
  const url = role => { const result = new URL(database.connectionString); result.username = role; result.password = ''; return result.toString(); };
  process.env.DATABASE_URL = url(runtimeRole); process.env.MIGRATION_DATABASE_URL = url(ownerRole);
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  const ownerPool = new Pool({ connectionString: url(ownerRole) });
  const db = require('../../src/db'); assert.strictEqual(await db.initDatabase(), true);
  const org = crypto.randomUUID(), user = crypto.randomUUID(), member = crypto.randomUUID();
  await ownerPool.query("INSERT INTO organizations(id,name,email) VALUES($1,'Equipment browser fixture','equipment-browser@example.test')", [org]);
  for (const [id, role] of [[user, 'owner'], [member, 'member']]) {
    await ownerPool.query("INSERT INTO users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,'Equipment browser fixture',$3,'unused',$4,'active')", [id, org, `${id}@example.test`, role]);
    await ownerPool.query("INSERT INTO organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,$3,'active')", [id, org, role]);
  }
  const raw = require('./m19-part3-business-profile').canonicalFenceProfile({ companyName: 'Equipment browser fixture', serviceName: 'Equipment fixture work' });
  raw.polaris = {};
  const normalized = adaptBusinessProfile(raw, 'm23-equipment-browser');
  await ownerPool.query("INSERT INTO canonical_business_profiles(organization_id,version_number,version_label,raw_profile,normalized_profile,normalized_profile_hash,is_active,created_by) VALUES($1,1,'m23-equipment-browser',$2,$3,$4,true,$5)", [org, raw, normalized, normalized.hash, user]);
  const session = await provisionDurableSession(ownerPool, { organizationId: org, userId: user, membershipId: user, role: 'owner' });
  const memberSession = await provisionDurableSession(ownerPool, { organizationId: org, userId: member, membershipId: member, role: 'member' });
  const identity = { manufacturer: 'Example Manufacturer', model: 'Exact 350', modelYear: '2024', series: 'Test Series', engine: 'Test Engine', configuration: 'Test Configuration' };
  const date = new Date();
  const research = { schemaVersion: 1, identity, category: 'vehicle', categoryLabel: 'Trucks', specifications: [],
    sources: [{ url: 'https://manufacturer.example/manual', title: 'Synthetic browser fixture — not real research', publisher: 'Example Manufacturer', sourceVersion: 'fixture-v1', documentDigest: 'a'.repeat(64), accessedAt: date.toISOString() }],
    confidence: 'high', reviewedAt: date.toISOString(), freshUntil: new Date(+date + 86400000).toISOString(), state: 'approved' };
  await ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)', [research, 'Deterministic fixture reviewer', 'b'.repeat(64), 'Test only, no live import']);
  const { app } = require('../../src/server');
  return { app, db, ownerPool, org, user, session, memberSession, identity,
    async close() {
      await ownerPool.end(); await db.close(); await database.cleanup();
      const cleanup = new Client({ connectionString: process.env.M19_PG_ADMIN_URL }); await cleanup.connect();
      try { await cleanup.query(`DROP ROLE ${quote(runtimeRole)}`); await cleanup.query(`DROP ROLE ${quote(ownerRole)}`); } finally { await cleanup.end(); }
    } };
}
module.exports = { createFixture };
