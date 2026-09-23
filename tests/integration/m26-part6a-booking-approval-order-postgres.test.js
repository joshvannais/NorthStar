'use strict';

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 6A booking approval source order', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('real Mission 22 human approvals receive ordered private sidecars', async () => {
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
});
