'use strict';

const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '83000000-0000-4000-8000-000000000001';
const ORG_B = '83000000-0000-4000-8000-000000000002';
const OWNER_A = '84000000-0000-4000-8000-000000000001';
const ADMIN_A = '84000000-0000-4000-8000-000000000002';
const MEMBER_A = '84000000-0000-4000-8000-000000000003';
const VIEWER_A = '84000000-0000-4000-8000-000000000004';
const OWNER_B = '84000000-0000-4000-8000-000000000005';

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

function profileFor(name, officeId, serviceId) {
  const profile = canonicalFenceProfile({ companyName: name, serviceName: name + ' primary service' });
  profile.services[0].id = serviceId;
  profile.headquarters = {
    street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
    additionalOffices: [{
      id: officeId, name: name + ' office', street: '', city: '', state: '', zip: '', country: 'US',
      latitude: null, longitude: null,
    }],
  };
  return profile;
}

function assetBody(overrides = {}) {
  return {
    category: 'equipment',
    name: '  Mini <img src=x onerror=window.__assetXss++> Excavator 🧰  ',
    internalReference: '  EQ-42 <A&B>  ',
    manufacturer: '  Acme é  ',
    model: '  X-200 <script>data-only()</script>  ',
    modelYear: 2024,
    configuration: '\n  Cab + thumb </textarea><svg onload=window.__assetXss++> 🌌  \n',
    serialNumber: '  SERIAL-<img src=x>  ',
    vin: '  VIN-🌌-RAW  ',
    homeLocationId: 'office-north',
    serviceIds: ['fence-repair'],
    ...overrides,
  };
}

function editableAsset(asset, overrides = {}) {
  return {
    category: asset.category,
    name: asset.name,
    internalReference: asset.internalReference,
    manufacturer: asset.manufacturer,
    model: asset.model,
    modelYear: asset.modelYear,
    configuration: asset.configuration,
    serialNumber: asset.serialNumber,
    vin: asset.vin,
    homeLocationId: asset.homeLocationId,
    serviceIds: asset.serviceIds,
    version: asset.version,
    ...overrides,
  };
}

realPostgres('Mission 20 Part 2F mounted tenant asset catalogue PostgreSQL authority', () => {
  let suiteDatabase;
  let originalDatabaseUrl;
  let db;
  let pool;
  let app;
  let auth;
  let profileBefore;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m20-part2f-assets');
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1,'Asset Organization A','asset-a@example.test'),
        ($2,'Asset Organization B','asset-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, name, email, role] of [
      [OWNER_A, ORG_A, 'Owner A', 'asset-owner-a@example.test', 'owner'],
      [ADMIN_A, ORG_A, 'Admin A', 'asset-admin-a@example.test', 'admin'],
      [MEMBER_A, ORG_A, 'Member A', 'asset-member-a@example.test', 'member'],
      [VIEWER_A, ORG_A, 'Viewer A', 'asset-viewer-a@example.test', 'viewer'],
      [OWNER_B, ORG_B, 'Owner B', 'asset-owner-b@example.test', 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, name, email, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: null,
      profile: profileFor('Asset A', 'Office-North', 'Fence-Repair'),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, expectedVersion: null,
      profile: profileFor('Asset B', 'Office-Other', 'Other-Service'),
    });
    profileBefore = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];

    auth = new Map();
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      auth.set(userId, (await provisionDurableSession(pool, { userId, organizationId, role })).headers);
    }

    ({ app } = require('../../src/server'));
    const { AssetCatalogueRepository } = require('../../src/assets/repository');
    const { AssetCatalogueService } = require('../../src/assets/service');
    app.locals.assetCatalogueService = new AssetCatalogueService(new AssetCatalogueRepository(pool));
  }, 60000);

  afterAll(async () => {
    try {
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('mounted CRUD, role, tenant, version, audit, reference, and raw-byte contracts hold', async () => {
    for (const userId of [OWNER_A, ADMIN_A, MEMBER_A, VIEWER_A, OWNER_B]) {
      const read = await request(app).get('/api/assets').set(auth.get(userId));
      expect(read.status).toBe(200);
      expect(read.body.data.authority).toBe('postgresql');
      expect(read.body.data.canManage).toBe([OWNER_A, ADMIN_A, OWNER_B].includes(userId));
    }
    expect((await request(app).get('/api/assets')).status).toBe(401);
    expect((await request(app).get('/api/assets').set('Authorization', 'Bearer forged')).status).toBe(401);
    expect((await request(app).get('/api/v1/assets/historical-id').set(auth.get(OWNER_A))).status).toBe(410);

    const created = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody());
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      id: expect.any(String), category: 'equipment', name: assetBody().name,
      internalReference: assetBody().internalReference, manufacturer: assetBody().manufacturer,
      model: assetBody().model, modelYear: 2024, configuration: assetBody().configuration,
      serialNumber: assetBody().serialNumber, vin: assetBody().vin,
      homeLocationId: 'Office-North', serviceIds: ['Fence-Repair'],
      catalogueState: 'active', version: 1,
    });
    const assetId = created.body.data.id;

    const adminCreated = await request(app).post('/api/assets').set(auth.get(ADMIN_A)).send(assetBody({
      category: 'vehicle', name: '  Admin Truck <b>literal</b>  ', internalReference: 'TRUCK-7',
      serialNumber: '', vin: '', homeLocationId: 'headquarters', serviceIds: [],
    }));
    expect(adminCreated.status).toBe(201);
    for (const userId of [MEMBER_A, VIEWER_A]) {
      expect((await request(app).post('/api/assets').set(auth.get(userId)).send(assetBody({
        name: 'Forbidden', internalReference: 'forbidden-' + userId.slice(-1),
      }))).status).toBe(403);
    }
    const other = await request(app).post('/api/assets').set(auth.get(OWNER_B)).send(assetBody({
      name: 'Other tenant asset', internalReference: 'other-tenant', homeLocationId: 'office-other',
      serviceIds: ['other-service'],
    }));
    expect(other.status).toBe(201);

    const ownerSnapshot = await request(app).get('/api/assets').set(auth.get(OWNER_A));
    expect(ownerSnapshot.body.data.assets.map(asset => asset.id)).toEqual(expect.arrayContaining([
      assetId, adminCreated.body.data.id,
    ]));
    expect(ownerSnapshot.body.data.assets.some(asset => asset.id === other.body.data.id)).toBe(false);
    expect(ownerSnapshot.body.data.locations).toEqual(expect.arrayContaining([
      { id: 'headquarters', name: 'Headquarters' },
      { id: 'Office-North', name: 'Asset A office' },
    ]));
    expect(ownerSnapshot.body.data.services).toEqual([
      { id: 'Fence-Repair', name: 'Asset A primary service' },
    ]);
    expect((await request(app).get('/api/assets').set(auth.get(OWNER_B))).body.data.assets)
      .toEqual([expect.objectContaining({ id: other.body.data.id })]);

    const stored = await pool.query(
      `SELECT encode(convert_to(name, 'UTF8'), 'hex') AS name_hex,
              encode(convert_to(internal_reference, 'UTF8'), 'hex') AS internal_reference_hex,
              encode(convert_to(manufacturer, 'UTF8'), 'hex') AS manufacturer_hex,
              encode(convert_to(model, 'UTF8'), 'hex') AS model_hex,
              encode(convert_to(configuration, 'UTF8'), 'hex') AS configuration_hex,
              encode(convert_to(serial_number, 'UTF8'), 'hex') AS serial_hex,
              encode(convert_to(vin, 'UTF8'), 'hex') AS vin_hex,
              home_location_id, catalogue_state, version
         FROM tenant_assets WHERE organization_id = $1 AND id = $2`,
      [ORG_A, assetId]
    );
    expect(stored.rows).toEqual([{
      name_hex: hex(assetBody().name),
      internal_reference_hex: hex(assetBody().internalReference),
      manufacturer_hex: hex(assetBody().manufacturer),
      model_hex: hex(assetBody().model),
      configuration_hex: hex(assetBody().configuration),
      serial_hex: hex(assetBody().serialNumber),
      vin_hex: hex(assetBody().vin),
      home_location_id: 'Office-North', catalogue_state: 'active', version: 1,
    }]);

    const updatedName = '  Updated </textarea><img src=x onerror=never()> 🌌  ';
    const updated = await request(app).put('/api/assets/' + assetId).set(auth.get(ADMIN_A)).send(
      editableAsset(created.body.data, { name: updatedName, serviceIds: [], homeLocationId: 'HEADQUARTERS' })
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id: assetId, name: updatedName, serviceIds: [], homeLocationId: 'headquarters', version: 2,
    });
    const stale = await request(app).put('/api/assets/' + assetId).set(auth.get(OWNER_A)).send(
      editableAsset(created.body.data, { name: 'Stale overwrite' })
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('asset_catalogue_version_conflict');
    expect((await pool.query(
      'SELECT name, version FROM tenant_assets WHERE organization_id = $1 AND id = $2',
      [ORG_A, assetId]
    )).rows).toEqual([{ name: updatedName, version: 2 }]);

    const archiveForbidden = await request(app)
      .patch('/api/assets/' + assetId + '/catalogue-state')
      .set(auth.get(VIEWER_A)).send({ version: 2, catalogueState: 'archived' });
    expect(archiveForbidden.status).toBe(403);
    const archived = await request(app)
      .patch('/api/assets/' + assetId + '/catalogue-state')
      .set(auth.get(ADMIN_A)).send({ version: 2, catalogueState: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.data).toMatchObject({ catalogueState: 'archived', version: 3 });
    const restored = await request(app)
      .patch('/api/assets/' + assetId + '/catalogue-state')
      .set(auth.get(OWNER_A)).send({ version: 3, catalogueState: 'active' });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ catalogueState: 'active', version: 4 });

    const duplicate = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody({
      name: 'Duplicate reference', internalReference: 'eq-42 <a&b>',
    }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('asset_catalogue_identity_conflict');
    const crossTenantLocation = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody({
      name: 'Cross location', internalReference: 'cross-location', homeLocationId: 'office-other',
    }));
    expect(crossTenantLocation.status).toBe(400);
    const crossTenantService = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody({
      name: 'Cross service', internalReference: 'cross-service', serviceIds: ['other-service'],
    }));
    expect(crossTenantService.status).toBe(400);
    const crossTenantId = await request(app).put('/api/assets/' + other.body.data.id).set(auth.get(OWNER_A)).send(
      editableAsset(other.body.data, { name: 'Cross tenant overwrite' })
    );
    expect(crossTenantId.status).toBe(404);

    for (const forbiddenField of ['assignmentId', 'availability', 'hours', 'condition', 'maintenance', 'providerMappings']) {
      const forbidden = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody({
        name: 'Forbidden ' + forbiddenField, internalReference: 'forbidden-' + forbiddenField,
        [forbiddenField]: 'outside-mission',
      }));
      expect(forbidden.status).toBe(400);
      expect(forbidden.body.error.code).toBe('invalid_asset_catalogue_item');
    }

    const profileAfter = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    expect(profileAfter).toEqual(profileBefore);
    expect(Object.prototype.hasOwnProperty.call(profileAfter.raw_profile, 'assets')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(profileAfter.raw_profile, 'assetCatalogue')).toBe(false);

    const audits = await pool.query(
      `SELECT action, actor_user_id, subject_id
         FROM tenant_asset_audit_events WHERE organization_id = $1 ORDER BY created_at, id`,
      [ORG_A]
    );
    expect(audits.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'asset_created', actor_user_id: OWNER_A, subject_id: assetId }),
      expect.objectContaining({ action: 'asset_updated', actor_user_id: ADMIN_A, subject_id: assetId }),
      expect.objectContaining({ action: 'asset_archived', actor_user_id: ADMIN_A, subject_id: assetId }),
      expect.objectContaining({ action: 'asset_restored', actor_user_id: OWNER_A, subject_id: assetId }),
    ]));
  }, 60000);

  test('restore fails closed for stale Business Profile references and permits archived repair', async () => {
    const created = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody({
      name: 'Archived location repair', internalReference: 'ARCHIVED-LOCATION', vin: '', serviceIds: [],
    }));
    expect(created.status).toBe(201);
    const assetId = created.body.data.id;
    const archived = await request(app)
      .patch('/api/assets/' + assetId + '/catalogue-state')
      .set(auth.get(OWNER_A)).send({ version: 1, catalogueState: 'archived' });
    expect(archived.status).toBe(200);
    expect(archived.body.data).toMatchObject({ catalogueState: 'archived', version: 2 });
    const serviceCreated = await request(app).post('/api/assets').set(auth.get(OWNER_A)).send(assetBody({
      name: 'Archived service repair', internalReference: 'ARCHIVED-SERVICE', vin: '',
      homeLocationId: 'headquarters',
    }));
    expect(serviceCreated.status).toBe(201);
    const serviceAssetId = serviceCreated.body.data.id;
    const serviceArchived = await request(app)
      .patch('/api/assets/' + serviceAssetId + '/catalogue-state')
      .set(auth.get(OWNER_A)).send({ version: 1, catalogueState: 'archived' });
    expect(serviceArchived.status).toBe(200);

    const replacementProfile = profileFor('Asset A Replacement', 'Office-Replacement', 'Other-Service');
    replacementProfile.headquarters.additionalOffices = [];
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: profileBefore.version_label,
      profile: replacementProfile,
    });
    const replacementProfileBefore = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];

    const staleRestore = await request(app)
      .patch('/api/assets/' + assetId + '/catalogue-state')
      .set(auth.get(OWNER_A)).send({ version: 2, catalogueState: 'active' });
    expect(staleRestore.status).toBe(409);
    expect(staleRestore.body.error.code).toBe('asset_catalogue_reference_conflict');
    expect((await pool.query(
      `SELECT catalogue_state, version, home_location_id
         FROM tenant_assets WHERE organization_id = $1 AND id = $2`,
      [ORG_A, assetId]
    )).rows).toEqual([{
      catalogue_state: 'archived', version: 2, home_location_id: 'Office-North',
    }]);
    const staleServiceRestore = await request(app)
      .patch('/api/assets/' + serviceAssetId + '/catalogue-state')
      .set(auth.get(ADMIN_A)).send({ version: 2, catalogueState: 'active' });
    expect(staleServiceRestore.status).toBe(409);
    expect(staleServiceRestore.body.error.code).toBe('asset_catalogue_reference_conflict');
    expect((await pool.query(
      `SELECT catalogue_state, version FROM tenant_assets
        WHERE organization_id = $1 AND id = $2`,
      [ORG_A, serviceAssetId]
    )).rows).toEqual([{ catalogue_state: 'archived', version: 2 }]);

    const repaired = await request(app).put('/api/assets/' + assetId).set(auth.get(ADMIN_A)).send(
      editableAsset(created.body.data, {
        version: 2, homeLocationId: 'headquarters', serviceIds: ['Other-Service'],
      })
    );
    expect(repaired.status).toBe(200);
    expect(repaired.body.data).toMatchObject({
      catalogueState: 'archived', version: 3,
      homeLocationId: 'headquarters', serviceIds: ['Other-Service'],
    });
    const restored = await request(app)
      .patch('/api/assets/' + assetId + '/catalogue-state')
      .set(auth.get(OWNER_A)).send({ version: 3, catalogueState: 'active' });
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({
      catalogueState: 'active', version: 4,
      homeLocationId: 'headquarters', serviceIds: ['Other-Service'],
    });
    const replacementProfileAfter = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    expect(replacementProfileAfter).toEqual(replacementProfileBefore);
  }, 60000);
});
