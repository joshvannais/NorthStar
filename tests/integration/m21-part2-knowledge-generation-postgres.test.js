'use strict';

const fs = require('fs');
const os = require('os');
const { Pool } = require('pg');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const PART_2_LAST_MIGRATION = '025_provider_agnostic_knowledge_registry.sql';

function migrationFiles(directory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

const ORG_A = 'b1000000-0000-4000-8000-000000000001';
const OWNER_A = 'b2000000-0000-4000-8000-000000000001';
const ADMIN_A = 'b2000000-0000-4000-8000-000000000002';
const MEMBER_A = 'b2000000-0000-4000-8000-000000000003';
const ORG_B = 'b1000000-0000-4000-8000-000000000002';
const OWNER_B = 'b2000000-0000-4000-8000-000000000004';
const MEMBER_B = 'b2000000-0000-4000-8000-000000000005';
const ORG_C = 'b1000000-0000-4000-8000-000000000003';
const OWNER_C = 'b2000000-0000-4000-8000-000000000006';
const ORG_D = 'b1000000-0000-4000-8000-000000000004';
const OWNER_D = 'b2000000-0000-4000-8000-000000000007';
const ORG_E = 'b1000000-0000-4000-8000-000000000005';
const OWNER_E = 'b2000000-0000-4000-8000-000000000008';

function profile() {
  return {
    industry: 'tree-service',
    businessDescription: 'Example contractor profile.',
    company: {
      name: 'Example Tree Care',
      email: 'office@example.test',
      phone: '+15550100100',
      timeZone: 'America/New_York',
      currency: 'USD',
    },
    headquarters: { city: 'Example', state: 'PA', country: 'US' },
    serviceArea: { maxRadiusMiles: 35, maxTravelMinutes: 50, primaryTerritory: 'Example County' },
    hours: { monday: { open: '08:00', close: '17:00' } },
    routing: { dispatchFrom: 'headquarters', trafficEnabled: true },
    scheduling: { maxJobsPerDay: 4, workDayLength: 8 },
    crew: { defaultCrewSize: 2, averageHourlyRate: 40, overtimeMultiplier: 1.5 },
    vehicles: { averageFuelCost: 3.5, hourlyVehicleCost: 15, maintenanceReserve: 5 },
    services: [{
      id: 'tree-removal', name: 'Tree removal', description: 'Verified-scope tree removal.', active: true,
    }],
    canonicalPricing: { customerMarkupPercent: 30, taxRatePercent: 6, minimumJobPrice: 250 },
    canonicalCosts: { overheadPercent: 10, travelCostPerMile: 0.7 },
    policies: { weather: 'Unsafe weather requires rescheduling.' },
    faq: ['An authorized scheduler confirms availability.'],
    voiceAssistant: {
      name: 'NorthStar',
      greeting: 'Thank you for calling Example Tree Care.',
      personality: 'professional',
      conversationStyle: 'consultative',
    },
  };
}

async function seedActor(pool, organizationId, userId, role, suffix) {
  await pool.query(
    `INSERT INTO organizations (id, name, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [organizationId, `Generation ${suffix}`, `generation-${suffix}@example.test`]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, 'not-used', $5, 'active')`,
    [userId, organizationId, `Actor ${suffix}`, `actor-${suffix}@example.test`, role]
  );
  await pool.query(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $1, $3, 'active')`,
    [userId, organizationId, role]
  );
}

async function seedProfile(pool, organizationId, actorUserId, profileId, raw = profile(), options = {}) {
  const versionLabel = options.versionLabel || 'org-profile-v1';
  const normalized = adaptBusinessProfile(raw, versionLabel);
  const storedHash = options.profileHash || normalized.hash;
  await pool.query(
    `INSERT INTO canonical_business_profiles
       (id, organization_id, version_number, version_label, raw_profile,
        normalized_profile, normalized_profile_hash, is_active, created_by)
     VALUES ($1, $2, 1, $3, $4::jsonb, $5::jsonb, $6, TRUE, $7)`,
    [
      profileId, organizationId, versionLabel, JSON.stringify(raw),
      JSON.stringify(normalized), storedHash, actorUserId,
    ]
  );
}

realPostgres('Mission 21 Part 2 knowledge generation with mounted PostgreSQL', () => {
  let suiteDatabase;
  let pool;
  let part2Directory;

  beforeAll(async () => {
    suiteDatabase = await createSuiteDatabase('m21-p2-generation');
    pool = new Pool({ connectionString: suiteDatabase.connectionString, max: 8 });
    part2Directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m21-p2-through025-'));
    for (const filename of migrationFiles(MIGRATIONS).filter(name => name <= PART_2_LAST_MIGRATION)) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(part2Directory, filename));
    }
    jest.resetModules();
    const db = require('../../src/db');
    expect(await db.runMigrations({ pool, migrationsDirectory: part2Directory })).toBe(true);

    await seedActor(pool, ORG_A, OWNER_A, 'owner', 'owner-a');
    await seedActor(pool, ORG_A, ADMIN_A, 'admin', 'admin-a');
    await seedActor(pool, ORG_A, MEMBER_A, 'member', 'member-a');
    await seedActor(pool, ORG_B, OWNER_B, 'owner', 'owner-b');
    await seedActor(pool, ORG_B, MEMBER_B, 'member', 'member-b');
    await seedActor(pool, ORG_C, OWNER_C, 'owner', 'owner-c');
    await seedActor(pool, ORG_D, OWNER_D, 'owner', 'owner-d');
    await seedActor(pool, ORG_E, OWNER_E, 'owner', 'owner-e');
    await seedProfile(
      pool, ORG_A, OWNER_A, 'b3000000-0000-4000-8000-000000000001'
    );
    await seedProfile(
      pool,
      ORG_C,
      OWNER_C,
      'b3000000-0000-4000-8000-000000000003',
      profile(),
      { profileHash: 'f'.repeat(64) }
    );
    await seedProfile(
      pool,
      ORG_D,
      OWNER_D,
      'b3000000-0000-4000-8000-000000000004',
      { company: { name: 123 } }
    );
    await seedProfile(
      pool,
      ORG_E,
      OWNER_E,
      'b3000000-0000-4000-8000-000000000005',
      { company: { name: 'Example Service' }, companyValues: [], faq: [] }
    );

    await pool.query(
      `INSERT INTO workforce_skills
         (id, organization_id, skill_key, name, description, service_id,
          created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, 'climber', 'Climber', 'Qualified climbing capability.',
               'tree-removal', $3, $3)`,
      ['b4000000-0000-4000-8000-000000000001', ORG_A, OWNER_A]
    );
    await pool.query(
      `INSERT INTO workforce_crews
         (id, organization_id, crew_key, name, home_location_id,
          created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, 'crew-a', 'Crew A', 'headquarters', $3, $3)`,
      ['b5000000-0000-4000-8000-000000000001', ORG_A, OWNER_A]
    );
    await pool.query(
      `INSERT INTO workforce_crew_members
         (organization_id, crew_id, profile_id, crew_role, created_by_user_id)
       VALUES ($1, $2, $3, 'lead', $4)`,
      [ORG_A, 'b5000000-0000-4000-8000-000000000001', OWNER_A, OWNER_A]
    );
    await pool.query(
      `INSERT INTO tenant_assets
         (id, organization_id, category, name, internal_reference, manufacturer,
          model, model_year, configuration, home_location_id, catalogue_state,
          version, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, 'equipment', 'Tracked chipper', 'EQ-100', 'Example',
               'Chipper 10', 2025, 'Standard', 'headquarters', 'active', 2, $3, $3)`,
      ['b7000000-0000-4000-8000-000000000001', ORG_A, OWNER_A]
    );
    await pool.query(
      `INSERT INTO tenant_asset_service_capabilities
         (organization_id, asset_id, service_id, created_by_user_id)
       VALUES ($1, $2, 'tree-removal', $3)`,
      [ORG_A, 'b7000000-0000-4000-8000-000000000001', OWNER_A]
    );
  }, 90000);

  afterAll(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (part2Directory && path.resolve(part2Directory).startsWith(path.resolve(os.tmpdir()))) {
        fs.rmSync(part2Directory, { recursive: true, force: true });
      }
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  }, 90000);

  test('atomically persists seven deterministic drafts with exact source and audit evidence', async () => {
    const {
      generateInitialKnowledgeFromAuthorities,
      getKnowledgeVersion,
    } = require('../../src/knowledge/repository');
    const result = await generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_A,
      actorUserId: OWNER_A,
    });
    expect(result.entries.map(entry => entry.canonicalKey)).toEqual([
      'organization.availability',
      'organization.customer-guidance',
      'organization.financial-constraints',
      'organization.identity',
      'organization.operational-capabilities',
      'organization.services',
      'organization.voice-guidance',
    ]);
    expect(result.authority).toMatchObject({
      organizationId: ORG_A,
      businessProfileId: 'b3000000-0000-4000-8000-000000000001',
      businessProfileVersion: 'org-profile-v1',
      generatorVersion: 'm21-p2-v1',
    });
    expect((await pool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_entries WHERE organization_id = $1) AS entries,
         (SELECT count(*)::int FROM canonical_knowledge_versions WHERE organization_id = $1) AS versions,
         (SELECT count(*)::int FROM canonical_knowledge_provenance WHERE organization_id = $1) AS provenance,
         (SELECT count(*)::int FROM canonical_knowledge_audit_events WHERE organization_id = $1) AS audit_events`,
      [ORG_A]
    )).rows).toEqual([{ entries: 7, versions: 7, provenance: 37, audit_events: 7 }]);
    expect((await pool.query(
      `SELECT bool_and(
         version.canonical_document = public.canonical_knowledge_render_jsonb(version.document)
         AND encode(sha256(convert_to(version.canonical_document, 'UTF8')), 'hex') =
             rtrim(version.canonical_digest)
       ) AS exact
       FROM canonical_knowledge_versions version
       WHERE organization_id = $1`,
      [ORG_A]
    )).rows).toEqual([{ exact: true }]);
    expect((await pool.query(
      `SELECT DISTINCT source_type
         FROM canonical_knowledge_provenance
        WHERE organization_id = $1 ORDER BY source_type`,
      [ORG_A]
    )).rows.map(row => row.source_type)).toEqual([
      'asset_catalogue', 'business_profile', 'system_generation', 'workforce',
    ]);

    const identity = result.entries.find(entry => entry.canonicalKey === 'organization.identity');
    expect(await getKnowledgeVersion(pool, {
      organizationId: ORG_A,
      actorUserId: MEMBER_A,
      entryId: identity.id,
      versionNumber: 1,
    })).toEqual(identity);
    const financial = result.entries.find(entry => entry.canonicalKey === 'organization.financial-constraints');
    await expect(getKnowledgeVersion(pool, {
      organizationId: ORG_A,
      actorUserId: MEMBER_A,
      entryId: financial.id,
      versionNumber: 1,
    })).rejects.toMatchObject({ code: 'knowledge_not_found', status: 404 });
    expect(await getKnowledgeVersion(pool, {
      organizationId: ORG_A,
      actorUserId: ADMIN_A,
      entryId: financial.id,
      versionNumber: 1,
    })).toEqual(financial);
  });

  test('requires owner/admin before reading sources and preserves tenant isolation', async () => {
    const { generateInitialKnowledgeFromAuthorities } = require('../../src/knowledge/repository');
    await expect(generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_B,
      actorUserId: MEMBER_B,
    })).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    await expect(generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_A,
      actorUserId: OWNER_B,
    })).rejects.toMatchObject({ code: 'knowledge_authorization_required', status: 403 });
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_entries WHERE organization_id = $1',
      [ORG_B]
    )).rows).toEqual([{ count: 0 }]);
  });

  test('fails corrupted source evidence closed before creating any knowledge', async () => {
    const { generateInitialKnowledgeFromAuthorities } = require('../../src/knowledge/repository');
    await expect(generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_C,
      actorUserId: OWNER_C,
    })).rejects.toMatchObject({ code: 'knowledge_profile_digest_mismatch', status: 503 });
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_entries WHERE organization_id = $1',
      [ORG_C]
    )).rows).toEqual([{ count: 0 }]);
  });

  test('fails malformed nested evidence closed and persists empty collections only as missing review', async () => {
    const { generateInitialKnowledgeFromAuthorities } = require('../../src/knowledge/repository');
    await expect(generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_D,
      actorUserId: OWNER_D,
    })).rejects.toMatchObject({ code: 'knowledge_profile_invalid', status: 503 });
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_entries WHERE organization_id = $1',
      [ORG_D]
    )).rows).toEqual([{ count: 0 }]);

    await generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_E,
      actorUserId: OWNER_E,
    });
    const guidance = (await pool.query(
      `SELECT version.document
         FROM canonical_knowledge_entries entry
         JOIN canonical_knowledge_versions version
           ON version.organization_id = entry.organization_id
          AND version.entry_id = entry.id
        WHERE entry.organization_id = $1
          AND entry.canonical_key = 'organization.customer-guidance'`,
      [ORG_E]
    )).rows[0].document.content;
    expect(guidance.state).toBe('needs_review');
    expect(guidance.facts).not.toHaveProperty('companyValues');
    expect(guidance.facts).not.toHaveProperty('faq');
    expect(guidance.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_authoritative_section' }),
    ]));
  });

  test('rolls a repeated generation attempt back without partial entries or evidence', async () => {
    const { generateInitialKnowledgeFromAuthorities } = require('../../src/knowledge/repository');
    await expect(generateInitialKnowledgeFromAuthorities(pool, {
      organizationId: ORG_A,
      actorUserId: ADMIN_A,
    })).rejects.toMatchObject({ code: 'knowledge_key_conflict', status: 409 });
    expect((await pool.query(
      `SELECT
         (SELECT count(*)::int FROM canonical_knowledge_entries WHERE organization_id = $1) AS entries,
         (SELECT count(*)::int FROM canonical_knowledge_versions WHERE organization_id = $1) AS versions,
         (SELECT count(*)::int FROM canonical_knowledge_audit_events WHERE organization_id = $1) AS audit_events`,
      [ORG_A]
    )).rows).toEqual([{ entries: 7, versions: 7, audit_events: 7 }]);
  });

  test('introduces no publication, provider mapping, synchronization, route or tool authority', async () => {
    expect((await pool.query(
      `SELECT to_regclass('public.canonical_knowledge_publications') AS publications,
              to_regclass('public.canonical_knowledge_provider_mappings') AS provider_mappings,
              to_regclass('public.canonical_knowledge_sync_outbox') AS sync_outbox`
    )).rows).toEqual([{ publications: null, provider_mappings: null, sync_outbox: null }]);
    const repositorySource = require('fs').readFileSync(
      path.join(ROOT, 'src', 'knowledge', 'repository.js'),
      'utf8'
    );
    const generatorSource = require('fs').readFileSync(
      path.join(ROOT, 'src', 'knowledge', 'generator.js'),
      'utf8'
    );
    expect(repositorySource).not.toMatch(/express|router|fetch\(|axios|retell|provider.*request/i);
    expect(generatorSource).not.toMatch(/express|router|fetch\(|axios|retell|provider.*request/i);
  });
});
