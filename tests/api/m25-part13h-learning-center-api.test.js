'use strict';
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const contract = require('../../public/js/learning-center-contract');

describe('Mission 25 Part 13H Learning Center projection', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 180000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 60000);

  test('returns a bounded tenant-private completed-job service inventory', async () => {
    for (const actorName of ['owner','admin']) {
      const response = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors[actorName].session.headers);
      expect(response.status).toBe(200); expect(response.body.data).toMatchObject({ version:'m25-learning-center-v6', outcomeServiceKeys:[], outcomeServiceTotal:0, outcomeServicesTruncated:false });
      expect(() => contract.center(response.body.data)).not.toThrow();
    }
    const other = await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200); expect(other.body.data.outcomeServiceKeys).toEqual([]);
    for (const actorName of ['member','viewer']) expect((await request(fixture.app).get('/api/v1/learning/center').set(fixture.actors[actorName].session.headers)).status).toBe(403);
  });

  test('withholds the renamed helper and keeps runtime on the guarded entry function', async () => {
    const startup = async () => {
      const client = await fixture.ownerPool.connect();
      try {
        await client.query('BEGIN');
        try {
          await fixture.db.grantAndVerifyRuntimeAuthorityForTests(client, { runtimeRole:fixture.roles.runtime });
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      } finally {
        client.release();
      }
    };
    const privileges = await fixture.runtimePool.query("SELECT has_function_privilege(current_user,'public.canonical_learning_center_read(uuid,uuid,text,uuid)','EXECUTE') entry,has_function_privilege(current_user,'public.canonical_learning_center_part12_read(uuid,uuid,text,uuid)','EXECUTE') helper");
    expect(privileges.rows[0]).toEqual({ entry:true, helper:false });
    await fixture.ownerPool.query('GRANT EXECUTE ON FUNCTION public.canonical_learning_center_part12_read(uuid,uuid,text,uuid) TO PUBLIC');
    try {
      await expect(startup()).rejects.toThrow('Runtime database role privilege verification failed');
    } finally {
      await fixture.ownerPool.query('REVOKE ALL ON FUNCTION public.canonical_learning_center_part12_read(uuid,uuid,text,uuid) FROM PUBLIC');
    }
    await fixture.ownerPool.query(`REVOKE ALL ON FUNCTION public.canonical_learning_center_read(uuid,uuid,text,uuid) FROM "${fixture.roles.runtime.replace(/"/g,'""')}"`);
    await expect(startup()).resolves.toBeUndefined();
    const restored = await fixture.runtimePool.query("SELECT has_function_privilege(current_user,'public.canonical_learning_center_read(uuid,uuid,text,uuid)','EXECUTE') entry,has_function_privilege(current_user,'public.canonical_learning_center_part12_read(uuid,uuid,text,uuid)','EXECUTE') helper");
    expect(restored.rows[0]).toEqual({ entry:true, helper:false });
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_job_outcome_planning_value_versions')).rejects.toMatchObject({ code:'42501' });
  });
});
