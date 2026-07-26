'use strict';

const realPostgres = process.env.M19_PG_URL ? describe : describe.skip;

realPostgres('Mission 19 Part 3 audit compatibility on disposable PostgreSQL', () => {
  let db;
  let audit;
  let previousDatabaseUrl;

  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.M19_PG_URL;
    jest.resetModules();
    db = require('../../src/db');
    audit = require('../../src/audit/client');
    await expect(db.initDatabase()).resolves.toBe(true);
  }, 30000);

  afterAll(async () => {
    if (db && db.isAvailable()) {
      await db.query("DELETE FROM audit_logs WHERE action LIKE 'm19.commit1.%'");
      await db.getPool().end();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  test('verifies and writes the existing migrated schema without actor_id assumptions', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(audit.ensureTable()).resolves.toBe(true);

    const columns = await db.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'audit_logs'
        ORDER BY column_name`
    );
    const names = columns.rows.map(row => row.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'organization_id', 'user_id', 'action', 'entity_type', 'entity_id',
      'details', 'ip_address', 'created_at',
    ]));
    expect(names).not.toContain('actor_id');

    await audit.record({
      organizationId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      actorLabel: 'authenticated',
      actorRole: 'owner',
      action: 'm19.commit1.authenticated',
      entityType: 'test',
      correlationId: 'request-pg-authenticated',
      userAgent: 'M19 PostgreSQL Test',
      beforeState: { phase: 'before' },
      afterState: { phase: 'after' },
      ipAddress: '127.0.0.1',
    });
    await audit.record({
      actorLabel: 'anonymous',
      actorRole: 'anonymous',
      action: 'm19.commit1.anonymous',
      entityType: 'test',
      correlationId: 'request-pg-anonymous',
    });
    await audit.record({
      actorLabel: 'system',
      actorRole: 'system',
      action: 'm19.commit1.system',
      entityType: 'test',
      correlationId: 'request-pg-system',
    });

    const rows = await db.query(
      `SELECT organization_id, user_id, action, details
         FROM audit_logs
        WHERE action LIKE 'm19.commit1.%'
        ORDER BY action`
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.find(row => row.action.endsWith('authenticated'))).toMatchObject({
      organization_id: '00000000-0000-0000-0000-000000000001',
      user_id: '00000000-0000-0000-0000-000000000002',
      details: expect.objectContaining({
        actorLabel: 'authenticated',
        role: 'owner',
        requestId: 'request-pg-authenticated',
      }),
    });
    expect(rows.rows.find(row => row.action.endsWith('anonymous')).details.actorLabel).toBe('anonymous');
    expect(rows.rows.find(row => row.action.endsWith('system')).details.actorLabel).toBe('system');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('actor_id');
    warning.mockRestore();
  }, 30000);
});
