#!/usr/bin/env node
'use strict';

const db = require('../src/db');
const { TrialReminderRepository } = require('../src/accounts/trialReminderRepository');
const { TrialReminderService } = require('../src/accounts/trialReminderService');
const { createProductionTransactionalEmail } = require('../src/email/transactional');

const REQUIRED_PRIOR_MIGRATION = '013_stripe_billing_authority.sql';
const REQUIRED_PRIOR_CHECKSUM = '216052cc8072e826531ca5d3f1d49ce3304838eb733ab45440caf402f0f08cd5';

async function requireReleaseOrder(pool) {
  const result = await pool.query(
    'SELECT checksum FROM public._migrations WHERE filename = $1',
    [REQUIRED_PRIOR_MIGRATION]
  );
  const checksum = result.rowCount === 1 ? String(result.rows[0].checksum || '').trim() : '';
  if (checksum !== REQUIRED_PRIOR_CHECKSUM) {
    throw new Error('Trial reminder release gate requires reviewed migration 013');
  }
}

async function main() {
  const delivery = createProductionTransactionalEmail(process.env);
  if (!delivery) throw new Error('Trial reminder delivery configuration is unavailable');
  const pool = db.getPool();
  if (!pool) throw new Error('DATABASE_URL is required for trial reminder authority');

  // Read-only preflight prevents this branch from applying 014 ahead of the
  // separately reviewed 013 release. The normal migration runner remains the
  // sole schema/ledger writer once the required predecessor is present.
  await requireReleaseOrder(pool);
  if (!await db.initDatabase()) throw new Error('PostgreSQL trial reminder authority is unavailable');
  const service = new TrialReminderService(new TrialReminderRepository(pool), {
    transactionalEmail: delivery,
  });
  const summary = await service.runOnce();
  console.log('[TrialReminders] One-shot run complete:', summary);
}

if (require.main === module) {
  main()
    .catch(error => {
      console.error('[TrialReminders] One-shot run failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { main, requireReleaseOrder };
