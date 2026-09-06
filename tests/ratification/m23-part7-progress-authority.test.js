'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {execFileSync}=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
const BASE='6bf5b66a4be7c6e0915bb24db1cca36c3a6284e9';
const MIGRATION='migrations/048_canonical_progress_issue_change_facts.sql';
const read=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',args,{cwd:ROOT});
const migration=read(MIGRATION);

describe('Mission 23 Part 7 frozen operational facts contract',()=>{
  test('seals exactly one additive migration by exact bytes and Git blob',()=>{
    expect(fs.readdirSync(path.join(ROOT,'migrations')).filter(n=>/^048_.*\.sql$/.test(n)))
      .toEqual(['048_canonical_progress_issue_change_facts.sql']);
    const bytes=fs.readFileSync(path.join(ROOT,MIGRATION));
    expect(bytes.length).toBe(55120);
    expect(hash(bytes)).toBe('92dfa4c54777e0e0bde4633edbddfd046f7b3d07b27a9dbb1cc2cd0ed6ff0b84');
    expect(git(['hash-object',MIGRATION]).toString().trim()).toBe('755e689eaf84fe580de47669f20f0141c89f34dc');
  });
  test('preserves all 45 exact released migration blobs',()=>{
    const names=git(['ls-tree','-r','--name-only',BASE,'migrations']).toString().trim().split('\n').filter(n=>n.endsWith('.sql'));
    expect(names).toHaveLength(45);
    for(const name of names)expect(hash(fs.readFileSync(path.join(ROOT,name)))).toBe(hash(git(['cat-file','blob',BASE+':'+name])));
  });
  test('retains composite relationships, current gates, complete append-only evidence and owned time',()=>{
    for(const fragment of ['FOREIGN KEY(organization_id,execution_id)','FOREIGN KEY(organization_id,assignment_id)',
      'FOREIGN KEY(organization_id,recorded_by_user_id,auth_session_id)','FOREIGN KEY(organization_id,evidence_id)',
      'canonical_progress_complete','canonical_progress_evidence_links','canonical_progress_own_decision_time',
      'canonical_progress_idempotency','canonical_progress_audit_events','canonical_field_execution_actor_authority',
      'canonical_field_execution_replay_authorized','canonical_material_supporting_authority_read_lock',
      'canonical_labor_transcript_source_normalized','workforce_crew_members',"IN ('lead','retell','voice')",
      "current_setting('transaction_isolation')<>'serializable'","current_setting('transaction_isolation')<>'repeatable read'"])
      expect(migration).toContain(fragment);
    expect(migration.indexOf('Source pins stale')).toBeLessThan(migration.indexOf('IF FOUND THEN\n  IF rtrim(receipt.request_digest)'));
  });
  test('withholds all progress tables and helpers, granting just two fixed entrypoints',()=>{
    const authority=read('src/progress/databaseAuthority.js');
    expect(authority).toContain("new Set(['canonical_progress_mutate','canonical_progress_read'])");
    expect(authority).toContain('REVOKE ALL ON TABLE');
    expect(authority).toContain('REVOKE ALL ON FUNCTION');
    const functions=migration.split(/CREATE FUNCTION /).slice(1);
    for(const definition of functions)expect(definition.split('AS $$')[0]).toMatch(/SET search_path=pg_catalog,public,pg_temp/);
    expect(read('src/progress/repository.js')).toContain('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(read('src/progress/repository.js')).toContain('BEGIN ISOLATION LEVEL REPEATABLE READ');
  });
  test('exposes only operational facts and leaves protected UI, providers, dependencies and configuration unchanged',()=>{
    const routes=read('src/routes/fieldExecutions.js');
    expect(routes).toContain("'/:executionId/progress-actions'");
    expect(routes).toContain("'/:executionId/progress'");
    expect(migration).toContain("'commercialConsequences',FALSE,'authorizationToContinue',FALSE,'percentComplete',NULL,'executionLifecycleChanged',FALSE,'professionalConclusion',FALSE");
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:canonical_schedule_assignments|canonical_field_executions|quotes|invoices|purchases)\b/i);
    const changed=git(['diff','--name-only',BASE,'--']).toString();
    expect(changed).not.toMatch(/(?:^|\n)(?:public\/|tests\/browser\/|\.github\/|package(?:-lock)?\.json|railway|Dockerfile|\.env)/);
    for(const name of ['contract.js','repository.js','databaseAuthority.js'])expect(read('src/progress/'+name)).not.toMatch(/(?:fetch\(|https?\.request|openai|retell|stripe|sendMail|sendSMS|fileStorage)/i);
    expect(read('docs/roadmap/MISSION_23_OPERATIONS.md')).toContain('**Part 7: implementation writer candidate; independent audit and release');
    expect(read('docs/roadmap/MISSION_23_OPERATIONS.md')).toContain('**Parts 8–12: not implemented.**');
  });
});
