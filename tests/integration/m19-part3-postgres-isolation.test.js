'use strict';

const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 19 Part 3 PostgreSQL suite isolation', () => {
  let graphDatabase;
  let apiDatabase;
  let graphPool;
  let apiPool;

  beforeAll(async () => {
    graphDatabase = await createSuiteDatabase('isolation-graph');
    apiDatabase = await createSuiteDatabase('isolation-api');
    graphPool = new Pool({ connectionString: graphDatabase.connectionString, max: 2 });
    apiPool = new Pool({ connectionString: apiDatabase.connectionString, max: 2 });
  });

  afterAll(async () => {
    try {
      await Promise.all([graphPool, apiPool].filter(Boolean).map(pool => pool.end()));
    } finally {
      if (apiDatabase) await apiDatabase.cleanup();
      if (graphDatabase) await graphDatabase.cleanup();
    }
  });

  test('suite databases isolate identical table names and one cleanup cannot affect the other', async () => {
    expect(graphDatabase.databaseName).not.toBe(apiDatabase.databaseName);
    expect(graphDatabase.identity).toMatchObject({
      run: process.env.M19_TEST_RUN_ID,
      suite: 'isolation-graph',
      worker: String(process.env.JEST_WORKER_ID || 'standalone'),
      processId: process.pid,
    });
    expect(apiDatabase.identity).toMatchObject({
      run: process.env.M19_TEST_RUN_ID,
      suite: 'isolation-api',
      worker: String(process.env.JEST_WORKER_ID || 'standalone'),
      processId: process.pid,
    });

    await graphPool.query('CREATE TABLE isolation_marker (value text NOT NULL)');
    await apiPool.query('CREATE TABLE isolation_marker (value text NOT NULL)');
    await graphPool.query("INSERT INTO isolation_marker (value) VALUES ('graph-only')");
    await apiPool.query("INSERT INTO isolation_marker (value) VALUES ('api-only')");
    await expect(graphPool.query('SELECT value FROM isolation_marker')).resolves.toMatchObject({ rows: [{ value: 'graph-only' }] });
    await expect(apiPool.query('SELECT value FROM isolation_marker')).resolves.toMatchObject({ rows: [{ value: 'api-only' }] });

    await graphPool.end();
    graphPool = null;
    await graphDatabase.cleanup();
    await expect(apiPool.query('SELECT value FROM isolation_marker')).resolves.toMatchObject({ rows: [{ value: 'api-only' }] });
  });
});
