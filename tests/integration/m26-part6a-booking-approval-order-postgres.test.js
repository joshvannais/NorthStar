'use strict';

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { reviewedMigrationTimeoutValues } = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A booking approval source order', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture({ operationalSchedule: true }); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('real Mission 22 human approvals receive ordered private sidecars', async () => {
    for (const migration of [
      '153_canonical_forecast_booking_approval_order.sql',
      '154_schedule_deferred_approval_validator_owner.sql',
    ]) {
      expect(reviewedMigrationTimeoutValues(migration,
        { lock_timeout: '0', statement_timeout: '0' }))
        .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
      expect(reviewedMigrationTimeoutValues(migration,
        { lock_timeout: '200', statement_timeout: '1000' }))
        .toEqual({ lockTimeout: '200ms', statementTimeout: '1000ms' });
    }
    const validator = (await fixture.ownerPool.query(`
      SELECT procedure.prosecdef AS owner_authority,
             has_function_privilege($1,
               'public.canonical_schedule_validate_human_approval_completion()',
               'EXECUTE') AS runtime_can_invoke_validator,
             has_function_privilege($1,
               'public.canonical_schedule_part4_approval_request_digest(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text)',
               'EXECUTE') AS runtime_can_invoke_digest
        FROM pg_proc procedure
       WHERE procedure.oid =
         'public.canonical_schedule_validate_human_approval_completion()'::regprocedure`,
    [fixture.roles.runtime])).rows[0];
    expect(validator).toEqual({ owner_authority: true,
      runtime_can_invoke_validator: false, runtime_can_invoke_digest: false });
    const first = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const second = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const rows = (await fixture.ownerPool.query(
      `SELECT source.appointment_id,source.approval_id,source.source_order,
              source.observed_at,approval.action_code,
              approval.approved_appointment_status
         FROM public.canonical_forecast_booking_approval_orders source
         JOIN public.canonical_schedule_human_approvals approval
           ON approval.organization_id=source.organization_id
          AND approval.id=source.approval_id
        WHERE source.organization_id=$1 ORDER BY source.source_order`,
      [fixture.org])).rows;
    expect(rows).toHaveLength(4);
    expect(rows.map(row => row.appointment_id)).toEqual([
      first.appointment, first.appointment, second.appointment, second.appointment]);
    expect(rows.map(row => row.action_code)).toEqual([
      'assign', 'dispatch', 'assign', 'dispatch']);
    expect(rows.every(row => row.approved_appointment_status === 'scheduled')).toBe(true);
    expect(rows.every(row => row.observed_at instanceof Date)).toBe(true);
    expect(rows.map(row => Number(row.source_order))).toEqual(
      [...rows.map(row => Number(row.source_order))].sort((a, b) => a - b));
    await expect(fixture.runtimePool.query(
      'SELECT * FROM public.canonical_forecast_booking_approval_orders WHERE organization_id=$1',
      [fixture.org])).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM public.canonical_forecast_booking_approval_orders WHERE organization_id=$1',
      [fixture.org])).rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('startup rejects inherited access to the owner-authority validator', async () => {
    const startup = async () => {
      const client = await fixture.ownerPool.connect();
      try {
        await client.query('BEGIN');
        try {
          await fixture.db.grantAndVerifyRuntimeAuthorityForTests(client,
            { runtimeRole: fixture.roles.runtime });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        client.release();
      }
    };
    const signature = 'canonical_schedule_validate_human_approval_completion()';
    await fixture.ownerPool.query(`GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC`);
    try {
      await expect(startup()).rejects.toThrow(
        'Runtime database role privilege verification failed');
    } finally {
      await fixture.ownerPool.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
    }
    await expect(startup()).resolves.toBeUndefined();
    expect((await fixture.ownerPool.query(
      'SELECT has_function_privilege($1,$2,\'EXECUTE\') AS permitted',
      [fixture.roles.runtime, `public.${signature}`])).rows[0].permitted).toBe(false);
  }, 180000);
});
