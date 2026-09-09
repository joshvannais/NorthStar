'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const real=process.env.M19_PG_ADMIN_URL?describe:describe.skip;
real('Mission 23 Part 11 additive migration compatibility',()=>{
  test('base upgrade, interrupted transaction recovery, exact source preservation and subsequent zero-op',async()=>{
    let fixture,filter; const migration='056_operational_downstream_handoffs.sql';
    const directory=path.resolve(__dirname,'../../migrations'); const failed=fs.mkdtempSync(path.join(os.tmpdir(),'northstar-m23p11-interrupted-'));
    try {
      const baseline=path.join(failed,'base');fs.mkdirSync(baseline);
      for(const name of fs.readdirSync(directory))if(name.endsWith('.sql'))fs.copyFileSync(path.join(directory,name),path.join(failed,name));
      for(const name of fs.readdirSync(directory))if(name.endsWith('.sql')&&name!==migration)fs.copyFileSync(path.join(directory,name),path.join(baseline,name));
      fs.writeFileSync(path.join(failed,'057_disposable_interruption.sql'),"DO $$ BEGIN RAISE EXCEPTION 'synthetic migration interruption'; END $$;");
      const read=fs.readdirSync.bind(fs); filter=jest.spyOn(fs,'readdirSync').mockImplementation((dir,...args)=>{
        const result=read(dir,...args);return path.resolve(String(dir))===directory?result.filter(name=>name!==migration):result;
      });
      fixture=await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
      filter.mockRestore();filter=null;
      const work=await fixture.createExecution();
      const before=(await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows;
      const original=(await fixture.ownerPool.query('SELECT * FROM canonical_field_executions WHERE id=$1',[work.execution.id])).rows;
      expect((await fixture.ownerPool.query("SELECT to_regclass('canonical_handoff_receipts') AS table_name")).rows[0].table_name).toBeNull();
      await expect(fixture.db.runMigrations({pool:fixture.ownerPool,runtimePool:fixture.db.getPool(),migrationsDirectory:failed})).rejects.toThrow('synthetic migration interruption');
      expect((await fixture.ownerPool.query("SELECT to_regclass('canonical_handoff_receipts') AS table_name")).rows[0].table_name).toBeNull();
      expect((await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows).toEqual(before);
      expect(await fixture.db.initDatabase()).toBe(true);
      const after=(await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows;
      expect(after).toHaveLength(before.length+1);expect(after.slice(0,before.length)).toEqual(before);
      expect((await fixture.ownerPool.query('SELECT * FROM canonical_field_executions WHERE id=$1',[work.execution.id])).rows).toEqual(original);
      expect(await fixture.db.initDatabase()).toBe(true);
      expect((await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows).toEqual(after);
      await expect(fixture.db.runMigrations({pool:fixture.ownerPool,runtimePool:fixture.db.getPool(),migrationsDirectory:baseline})).rejects.toThrow('Applied migration source is missing: '+migration);
      expect((await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1')).rows).toEqual(after);
    } finally { if(filter)filter.mockRestore();if(fixture)await fixture.cleanup();fs.rmSync(failed,{recursive:true,force:true}); }
  },180000);
});
