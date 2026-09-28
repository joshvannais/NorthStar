'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { reviewedMigrationTimeoutValues } = require('../../src/db');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A guarded booking-approval receipt', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture({ operationalSchedule: true }); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  const params = actor => [actor.organizationId, actor.actorUserId,
    actor.actorAccessRole, actor.authSessionId];

  async function capture(actor = fixture.actors.owner, key = crypto.randomUUID()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await client.query(
        'SELECT public.canonical_forecast_booking_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [...params(actor), actor.csrfToken, key]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function read(receiptId, actor = fixture.actors.owner) {
    const result = await fixture.runtimePool.query(
      'SELECT public.canonical_forecast_booking_ordered_read($1,$2,$3,$4,$5) value',
      [...params(actor), receiptId]);
    return result.rows[0].value;
  }

  test('first fence excludes old approvals; later receipt pins ordered history without pricing', async () => {
    const migration = '155_canonical_forecast_booking_ordered_receipts.sql';
    expect(reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '0', statement_timeout: '0' }))
      .toEqual({ lockTimeout: '5000ms', statementTimeout: '20000ms' });
    expect(reviewedMigrationTimeoutValues(migration,
      { lock_timeout: '200', statement_timeout: '1000' }))
      .toEqual({ lockTimeout: '200ms', statementTimeout: '1000ms' });
    const old = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    const key = crypto.randomUUID();
    const first = await capture(fixture.actors.owner, key);
    expect(first).toMatchObject({ replayed: false, snapshot: {
      eventCount: 0, events: [], bookingStatusVerified: false,
      priceLinkVerified: false, forecastIssued: false } });
    const firstOrder = (await fixture.ownerPool.query(
      'SELECT coverage_start_order,high_water_order FROM canonical_forecast_booking_ordered_receipts WHERE id=$1',
      [first.snapshot.id])).rows[0];
    expect(firstOrder.coverage_start_order).toBe(firstOrder.high_water_order);
    expect((await read(first.snapshot.id)).state).toBe('current');

    const current = await fixture.createExecution({ approvedScheduling: true,
      stopAfterScheduling: true });
    // The appointment's opportunity can be relinked after the human approval.
    // Historical attribution must follow the immutable approved assignment.
    await fixture.ownerPool.query(
      'UPDATE canonical_appointments SET opportunity_id=$1 WHERE organization_id=$2 AND id=$3',
      [old.opportunity, fixture.org, current.appointment]);
    expect((await fixture.ownerPool.query(
      'SELECT opportunity_id FROM canonical_appointments WHERE organization_id=$1 AND id=$2',
      [fixture.org, current.appointment])).rows[0].opportunity_id).toBe(old.opportunity);
    expect((await read(first.snapshot.id)).state).toBe('stale');
    const second = await capture();
    expect(second.snapshot.events).toHaveLength(2);
    expect(second.snapshot.events.map(event => event.appointmentId))
      .toEqual([current.appointment, current.appointment]);
    expect(second.snapshot.events.map(event => event.actionCode)).toEqual(['assign', 'dispatch']);
    expect(second.snapshot.events.map(event => event.appliedRevision)).toEqual([2, 3]);
    expect(second.snapshot.events.every(event => event.opportunityId === current.opportunity))
      .toBe(true);
    expect(JSON.stringify(second)).not.toContain(old.appointment);
    expect(JSON.stringify(second)).not.toMatch(/"(?:sourceOrder|coverageStartOrder|highWaterOrder|digestNonce)"/);
    expect((await read(second.snapshot.id))).toMatchObject({ state: 'current',
      sourceOrderCurrent: true, bookingStatusVerified: false,
      priceLinkVerified: false, eligibleForForecast: false,
      wholeBusinessCoverageVerified: false, forecastIssued: false });
    const replay = await capture(fixture.actors.owner, key);
    expect(replay).toEqual({ snapshot: first.snapshot, replayed: true });
    expect((await read(replay.snapshot.id)).state).toBe('stale');
  }, 120000);

  test('tenant, role, helper and immutable evidence boundaries remain enforced', async () => {
    const captured = await capture();
    await expect(capture(fixture.actors.member)).rejects.toMatchObject({ code: '42501' });
    await expect(read(captured.snapshot.id, fixture.actors.member))
      .rejects.toMatchObject({ code: '42501' });
    expect(await read(captured.snapshot.id, fixture.actors.otherOwner)).toBeNull();
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_booking_ordered_receipts'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_forecast_booking_ordered_events($1,$2,$3)',
      [fixture.org, 0, 1])).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_forecast_booking_ordered_receipts WHERE id=$1',
      [captured.snapshot.id])).rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('startup rejects inherited booking-receipt access and restores guarded entries', async () => {
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
    const privileges = async () => (await fixture.ownerPool.query(
      `SELECT
        has_table_privilege($1,'canonical_forecast_booking_ordered_receipts',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access,
        has_function_privilege($1,
          'canonical_forecast_booking_ordered_events(uuid,bigint,bigint)',
          'EXECUTE') AS helper,
        has_function_privilege($1,
          'canonical_forecast_booking_ordered_capture(uuid,uuid,text,uuid,text,text)',
          'EXECUTE') AS capture_entry,
        has_function_privilege($1,
          'canonical_forecast_booking_ordered_read(uuid,uuid,text,uuid,uuid)',
          'EXECUTE') AS read_entry`, [fixture.roles.runtime])).rows[0];

    await fixture.ownerPool.query(
      'GRANT SELECT ON TABLE canonical_forecast_booking_ordered_receipts TO PUBLIC');
    try {
      await expect(startup()).rejects.toThrow(
        'Runtime database role privilege verification failed');
    } finally {
      await fixture.ownerPool.query(
        'REVOKE ALL ON TABLE canonical_forecast_booking_ordered_receipts FROM PUBLIC');
    }

    await fixture.ownerPool.query(
      'GRANT EXECUTE ON FUNCTION canonical_forecast_booking_ordered_events(uuid,bigint,bigint) TO PUBLIC');
    try {
      await expect(startup()).rejects.toThrow(
        'Runtime database role privilege verification failed');
    } finally {
      await fixture.ownerPool.query(
        'REVOKE ALL ON FUNCTION canonical_forecast_booking_ordered_events(uuid,bigint,bigint) FROM PUBLIC');
    }

    const runtimeRole = `"${fixture.roles.runtime.replace(/"/g, '""')}"`;
    await fixture.ownerPool.query(
      `REVOKE ALL ON FUNCTION canonical_forecast_booking_ordered_read(uuid,uuid,text,uuid,uuid) FROM ${runtimeRole}`);
    expect((await privileges()).read_entry).toBe(false);
    await expect(startup()).resolves.toBeUndefined();
    expect(await privileges()).toEqual({ table_access: false, helper: false,
      capture_entry: true, read_entry: true });
  }, 180000);

  test('capture and read fail busy while the Mission 22 source fence is held', async () => {
    const receipt = await capture();
    const writer = await fixture.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('m26:booking-approval-order:'||$1::text,0))",
        [fixture.org]);
      await expect(capture()).rejects.toMatchObject({ code: '55P03' });
      await expect(read(receipt.snapshot.id)).rejects.toMatchObject({ code: '55P03' });
      await writer.query('COMMIT');
      expect((await read(receipt.snapshot.id)).state).toBe('current');
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
  }, 120000);
});
