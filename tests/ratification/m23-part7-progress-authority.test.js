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
    expect(bytes.length).toBe(55557);
    expect(hash(bytes)).toBe('c87210731112f7da7df2f955eadbe7fa6e66c16d80c732441c2ee1688dbc189a');
    expect(git(['hash-object',MIGRATION]).toString().trim()).toBe('55b527c2dc8a31514e3398489ed1bcc0811e1b47');
  });
  test('preserves all 45 exact released migration blobs',()=>{
    const names=git(['ls-tree','-r','--name-only',BASE,'migrations']).toString().trim().split('\n').filter(n=>n.endsWith('.sql'));
    expect(names).toHaveLength(45);
    for(const name of names)expect(hash(fs.readFileSync(path.join(ROOT,name)))).toBe(hash(git(['cat-file','blob',BASE+':'+name])));
  });
  test('current evidence references agree with the raw migration identity and distinguish historical receipts',()=>{
    const bytes=git(['cat-file','blob','HEAD:'+MIGRATION]);
    const blob=git(['rev-parse','HEAD:'+MIGRATION]).toString().trim();
    const evidence='outputs/m23-part7-writer/';
    for(const name of ['REQUIREMENT_TO_EVIDENCE.md','PROFILE_ROTATION_MIGRATION.md','PROFILE_ROTATION_VERIFICATION.md']){
      const document=read(evidence+name);
      expect(document.replace(/,/g,'')).toContain(String(bytes.length));
      expect(document).toContain(blob);expect(document).toContain(hash(bytes));
      expect(document).not.toMatch(/55,?120|755e689eaf84fe580de47669f20f0141c89f34dc|92dfa4c54777e0e0bde4633edbddfd046f7b3d07b27a9dbb1cc2cd0ed6ff0b84/);
    }
    const contract=read('docs/operations/PROGRESS_ISSUE_FACTS.md'),ledger=read(evidence+'REQUIREMENT_TO_EVIDENCE.md');
    expect(contract).toContain('[accepted migration identity](../../outputs/m23-part7-writer/PROFILE_ROTATION_MIGRATION.md)');
    expect(ledger).toContain('[current migration/recovery](PROFILE_ROTATION_MIGRATION.md)');
    expect(read(evidence+'MIGRATION_IDENTITY.md')).toContain('Historical seal for rejected candidate');
    for(const name of ['docs/operations/PROGRESS_ISSUE_FACTS.md',evidence+'REQUIREMENT_TO_EVIDENCE.md',evidence+'PROFILE_ROTATION_MIGRATION.md']){
      for(const match of read(name).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
        expect(fs.existsSync(path.resolve(ROOT,path.dirname(name),match[1]))).toBe(true);
      }
    }
    for(const name of ['MIGRATION_IDENTITY.md','PROFILE_ROTATION_MIGRATION.md','PROFILE_ROTATION_VERIFICATION.md','FINAL_CLOSEOUT.md','TEST_RESULTS.md','WRITER_LEDGER.md']){
      expect(hash(fs.readFileSync(path.join(ROOT,evidence+name))))
        .toBe(hash(git(['cat-file','blob','5d6db61b70c92a2cafb87a6a6afe8389bffb72e5:'+evidence+name])));
    }
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
  test('historical profile mode is internal and only follows validated inherited actions',()=>{
    expect(migration).toContain('require_current_profile BOOLEAN DEFAULT TRUE');
    expect(migration).toContain('IF require_current_profile IS NULL THEN RETURN FALSE');
    expect(migration).toContain('AND (b.is_active OR NOT require_current_profile)');
    const call="canonical_progress_observation_authorized(org,execution_value,document_value,action_value NOT IN ('review','issue_state'))";
    expect(migration).toContain(call);
    expect(migration.indexOf('Predecessor stale')).toBeLessThan(migration.indexOf(call));
    expect(migration.indexOf("'replayed',TRUE")).toBeLessThan(migration.indexOf('Predecessor stale'));
    expect(read('src/progress/contract.js')).not.toMatch(/require_current_profile|requireCurrentProfile/);
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
    expect(read('docs/roadmap/MISSION_23_OPERATIONS.md')).toContain('**Part 8: implementation writer candidate; independent audit and release');
    expect(read('docs/roadmap/MISSION_23_OPERATIONS.md')).toContain('**Parts 9–12: not implemented.**');
  });
});
