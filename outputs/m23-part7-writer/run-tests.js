'use strict';
// Reproducible Windows-hosted tests over the one WSL checkout; no inherited provider credentials.
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..');
const tag=process.argv[2];if(!/^[a-z0-9-]+$/.test(tag||''))throw new Error('An unused evidence tag is required');
const output=path.join(__dirname,tag+'-results.json');
if(require('fs').existsSync(output))throw new Error('Refusing to overwrite evidence');
const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',TEMP:'C:\\Users\\joshv\\AppData\\Local\\Temp',TMP:'C:\\Users\\joshv\\AppData\\Local\\Temp',
 PATH:'C:\\Program Files\\Git\\cmd;C:\\Program Files\\nodejs;C:\\Windows\\System32',NODE_ENV:'test',
 GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:'//wsl.localhost/Ubuntu/home/joshv/codex-writers/m23-part7-6bf5b66',
 GIT_CONFIG_KEY_1:'core.autocrlf',GIT_CONFIG_VALUE_1:'false',
 M19_PG_ADMIN_URL:'postgresql://postgres@127.0.0.1:55483/postgres',M19_EXPECTED_PG_PORT:'55483',
 M19_EXPECTED_PG_DATA_DIR:'C:/Users/joshv/AppData/Local/Temp/northstar-m23-part7-pg18-20260906',M19_TEST_RUN_ID:'m23p7-'+tag};
let args=process.argv.slice(3);
let workers='--runInBand';
if(['--available','--available-4'].includes(args[0])){
 if(args[0]==='--available-4')workers='--maxWorkers=4';
 const excluded=require('../m23-part5-writer/availability-exclusions.json');
 const escape=v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 args=['--testNamePattern=^(?!(?:'+excluded.map(x=>escape(x.name)).join('|')+')$)'];
 env.ACCOUNT_MIGRATION_NEGATIVE_FRESH_URL='postgresql://postgres@127.0.0.1:55483/pr71_negative_fresh';
 env.ACCOUNT_MIGRATION_NEGATIVE_UPGRADE_URL='postgresql://postgres@127.0.0.1:55483/pr71_negative_upgrade';
}
const result=spawnSync(process.execPath,[path.join(root,'node_modules/jest/bin/jest.js'),workers,'--silent','--verbose=false','--json','--outputFile='+output,...args],{cwd:root,stdio:'inherit',env});
process.exit(result.status===null?1:result.status);
