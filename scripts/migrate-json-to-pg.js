/**
 * JSON to PostgreSQL Migration Script
 * Run: node scripts/migrate-json-to-pg.js
 *
 * Reads existing JSON user data and inserts into PostgreSQL.
 */
const path = require('path');
const fs = require('fs');
const db = require('../src/db');

async function migrate() {
  console.log('=== NorthStar JSON → PostgreSQL Migration ===\n');

  // Initialize database
  const ready = await db.initDatabase();
  if (!ready) {
    console.error('❌ Database not available. Check DATABASE_URL.');
    process.exit(1);
  }

  // Read JSON users
  const usersFile = path.join(__dirname, '..', 'data', 'users.json');
  if (!fs.existsSync(usersFile)) {
    console.log('No users.json found — nothing to migrate.');
    process.exit(0);
  }

  const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  const users = data.users || [];
  console.log(`Found ${users.length} user(s) to migrate.\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const u of users) {
    try {
      // Check if user already exists
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [u.email]);
      if (existing.rows.length > 0) {
        console.log(`  ⏭️  ${u.email} — already exists, skipping`);
        skipped++;
        continue;
      }

      // Create organization
      const orgResult = await db.query(
        `INSERT INTO organizations (name, owner_name, email, phone, business_address)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [u.businessName || u.name, u.name || '', u.email, u.phone || '', '']
      );
      const orgId = orgResult.rows[0].id;

      // Create user
      await db.query(
        `INSERT INTO users (id, organization_id, name, email, phone, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (email) DO NOTHING`,
        [u.id, orgId, u.name || u.businessName, u.email, u.phone || '', u.passwordHash || '', 'owner', u.status || 'active']
      );

      // Create subscription
      await db.query(
        `INSERT INTO subscriptions (organization_id, plan_type, status, trial_ends)
         VALUES ($1, $2, $3, $4)`,
        [orgId, u.planType || 'Trial', u.status || 'trial', u.trialEnds || null]
      );

      // Create notification preferences
      await db.query(
        `INSERT INTO notification_preferences (organization_id, notification_email, notification_phone)
         VALUES ($1, $2, $3)`,
        [orgId, u.email, u.phone || '']
      );

      console.log(`  ✅ ${u.email} — migrated successfully`);
      migrated++;
    } catch (err) {
      console.error(`  ❌ ${u.email} — error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`  ✅ ${migrated} migrated`);
  console.log(`  ⏭️  ${skipped} skipped`);
  console.log(`  ❌ ${errors} errors`);

  process.exit(errors > 0 ? 1 : 0);
}

migrate();