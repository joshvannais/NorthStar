'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { createJourney } = require('../helpers/m23-part12-journey');
const option = (key, fallback) => (process.argv.find(v => v.startsWith('--' + key + '=')) || '--' + key + '=' + fallback).split('=').slice(1).join('=');
process.chdir(path.resolve(__dirname, '../..'));
process.env.NODE_ENV = 'test';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY',
  'STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];

async function main() {
  const output = path.resolve(option('output', '')), selected = option('browser', 'chrome');
  assert.ok(process.argv.some(v => v.startsWith('--output=')) && !fs.existsSync(output), 'new evidence directory required');
  fs.mkdirSync(output, { recursive: true });
  const ledger = { browser: selected, cases: [], browserMutations: [], pageErrors: [], externalBlocked: [], providerAttempts: 0,
    source: { head: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
      status: execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim() },
    limits: ['Synthetic upstream and equipment research; no provider or private production data', 'Files/storage are unavailable; no file success inferred',
      'Actual WebKit is not physical Safari; no physical devices or manual assistive technology', 'No founder personal visual verdict',
      'Part9 My Work Profile residual is not implemented', 'Inherited 15 wider-corpus failures not rerun or relabelled passing'] };
  const https = require('node:https'), previous = { request: https.request, get: https.get, fetch: globalThis.fetch };
  const deny = () => { ledger.providerAttempts++; throw new Error('External provider transport prohibited'); };
  https.request = deny; https.get = deny; globalThis.fetch = deny;
  let j, server, browser, activePage;
  try {
    j = await createJourney(ledger);
    const { f, work, call, base } = j;
    ledger.database = (await f.ownerPool.query("SELECT current_setting('server_version') AS version,current_setting('TimeZone') AS timezone,current_setting('server_encoding') AS encoding,current_setting('data_checksums') AS checksums,(SELECT datcollate FROM pg_database WHERE datname=current_database()) AS locale")).rows[0];
    assert.match(ledger.database.version, /^18\./); assert.equal(ledger.database.timezone,'UTC');
    assert.equal(ledger.database.encoding,'UTF8'); assert.equal(ledger.database.checksums,'on'); assert.equal(ledger.database.locale,'C');
    ledger.cases.push('real PostgreSQL 18 UTC UTF8 C checksums and separate roles');
    const schedule = (await f.ownerPool.query('SELECT needs_review,dispatch_state FROM canonical_schedule_assignments WHERE id=$1',[work.assignment.id])).rows[0];
    assert.deepEqual(schedule,{needs_review:false,dispatch_state:'dispatched'});
    ledger.cases.push('one approved dispatch has complete availability location and skill evidence');
    server = f.app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
    const origin = 'http://127.0.0.1:' + server.address().port, runtime = resolveBrowserRuntime(selected);
    browser = await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath}); ledger.version = browser.version();
    const open = async (theme,width,height,actor='owner') => {
      const context = await browser.newContext({viewport:{width,height},hasTouch:width<=430,reducedMotion:'reduce'});
      await context.addInitScript(value=>localStorage.setItem('northstar-theme',value),theme);
      await context.addCookies(Object.entries(f.actors[actor].session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
      const page = await context.newPage(); activePage=page;
      page.on('pageerror',error=>ledger.pageErrors.push(error.message));
      await page.route('**/*',route=>{const req=route.request(); if(new URL(req.url()).origin!==origin){ledger.externalBlocked.push(req.url());return route.abort();}
        if(req.method()==='POST')ledger.browserMutations.push({url:new URL(req.url()).pathname,body:req.postDataJSON()});
        return route.continue();});
      return {context,page};
    };
    const first = await open('light',1440,1000), page=first.page;
    await page.goto(origin+'/dashboard/operations');
    const link=page.locator('[data-execution-id="'+work.execution.id+'"]').getByRole('link',{name:/^Review completion for /});
    await link.focus();await page.keyboard.press('Enter');await page.waitForURL('**/dashboard/completion-review?executionId='+work.execution.id);
    const act=async action=>{
      await page.locator('[data-action="'+action+'"]').first().click();
      await page.locator('#completionReason').fill('Reviewed exact synthetic evidence for this job');
      if(await page.locator('#completionNextAction').isVisible())await page.locator('#completionNextAction').fill('Recheck the recorded seal after follow-up');
      await page.locator('#completionPrepare').click();await page.locator('#completionConfirm[open]').waitFor();
      assert.equal(await page.evaluate(()=>document.activeElement.id),'completionCancelButton');
      await page.locator('#completionConfirmButton').click();
    };
    await act('approve_completion');await page.waitForFunction(()=>document.querySelector('#completionLifecycle').dataset.state==='completed');
    ledger.cases.push('owner keyboard navigation and explicit reviewed completion approval');
    const completed=(await call('get',base+'/completion')).data;
    ledger.completedSnapshot=completed;
    assert.equal(completed.execution.lifecycleState,'completed');
    const polarisBefore=(await call('get',base+'/intelligence')).data;
    assert.equal(polarisBefore.execution.id,work.execution.id);assert.equal(polarisBefore.execution.digest,completed.execution.digest);
    for(const domain of ['labor','materials','equipment','fieldEvidence','progress']) {
      const source=polarisBefore.evidence.find(e=>e.domain===domain);
      assert.ok(source && source.pins.length>0,'nonempty exact source domain '+domain);
    }
    const handoff=page.locator('#downstreamHandoffs');await handoff.locator('summary').first().click();
    await handoff.getByText('Current references are ready for review.',{exact:true}).waitFor();
    await handoff.locator('#handoffConsent').check();await handoff.getByRole('button',{name:'Save internal handoff',exact:true}).click();
    await handoff.getByText('Internal handoff recorded. Delivery and downstream use remain unavailable.',{exact:true}).waitFor();
    const prepared=(await call('get',base+'/handoffs')).data;
    ledger.preparedSnapshot=prepared;
    assert.equal(prepared.sourceSnapshot.execution.id,work.execution.id);assert.equal(prepared.sourceSnapshot.execution.digest,completed.execution.digest);
    assert.equal(prepared.receipts.length,1);assert.equal(prepared.receipts[0].consumptionAuthorized,false);
    ledger.sourceReconciliation = {};
    for(const [domain,table,digestColumn] of [
      ['labor','canonical_labor_intervals','canonical_digest'],['materials','canonical_material_movements','canonical_digest'],
      ['progress','canonical_progress_records','canonical_digest'],['fieldEvidence','canonical_field_evidence_records','canonical_digest'],
      ['completion','canonical_completion_records','canonical_digest'],['equipment','canonical_equipment_events','digest']]) {
      const rows=(await f.ownerPool.query('SELECT id,revision::int AS revision,rtrim('+digestColumn+') AS digest FROM '+table+' WHERE organization_id=$1 AND execution_id=$2 ORDER BY id',[f.org,work.execution.id])).rows;
      assert.deepEqual(prepared.sourceSnapshot[domain].pins,rows,'exact database pins '+domain);
      assert.equal(prepared.sourceSnapshot[domain].count,rows.length);
      ledger.sourceReconciliation[domain]=rows;
      const permissions=(await f.runtimePool.query('SELECT has_table_privilege(current_user,$1,\'SELECT,INSERT,UPDATE,DELETE,TRUNCATE\') AS access',[table])).rows[0];
      assert.equal(permissions.access,false,'no runtime direct authority '+domain);
    }
    ledger.cases.push('all six handoff source domains exactly equal SQL identities revisions digests; no runtime table privilege');
    ledger.cases.push('browser consent handoff pins the completed job and all operational domains');
    // Every viewport revisits this same job and its one persisted receipt.
    for(const theme of ['light','dark'])for(const width of [1440,390,320]){
      const view=await open(theme,width,width===1440?1000:844);const p=view.page;
      await p.goto(origin+'/dashboard/completion-review?executionId='+work.execution.id);
      await p.locator('#completionLifecycle[data-state="completed"]').waitFor();
      await p.locator('#downstreamHandoffs > summary').click();
      await p.locator('#downstreamHandoffs').getByText('Current references are ready for review.',{exact:true}).waitFor();
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),theme);
      await p.keyboard.press('Tab');
      await p.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
      await p.screenshot({path:path.join(output,theme+'-'+width+'-completed.png'),fullPage:true});
      await p.reload();await p.locator('#completionLifecycle[data-state="completed"]').waitFor();
      ledger.cases.push(theme+' '+width+' same-job deep link reload theme reflow');
      await view.context.close();
    }
    activePage=page;
    await act('reopen_execution');await page.waitForFunction(()=>document.querySelector('#completionLifecycle').dataset.state==='reopened');
    const reopened=(await call('get',base+'/completion')).data;
    assert.equal(reopened.execution.id,completed.execution.id);assert.ok(reopened.execution.revision>completed.execution.revision);
    for(const record of completed.records)assert.deepEqual(reopened.records.find(r=>r.id===record.id),record);
    const changed=(await call('get',base+'/handoffs')).data;
    assert.equal(changed.receipts.find(r=>r.id===prepared.receipts[0].id).status,'source_changed');
    assert.notEqual(changed.sourceDigest,prepared.sourceDigest);
    const historical=(await f.ownerPool.query('SELECT source_digest FROM canonical_handoff_receipts WHERE id=$1',[prepared.receipts[0].id])).rows[0];
    assert.equal(historical.source_digest,prepared.sourceDigest);
    ledger.cases.push('reopening preserves completion history and invalidates earlier consent source pins');
    await page.reload();await page.locator('#completionLifecycle[data-state="reopened"]').waitFor();
    await act('resume_reopened');await page.waitForFunction(()=>document.querySelector('#completionLifecycle').dataset.state==='in_progress');
    ledger.cases.push('explicit browser resumption preserves the same execution');
    await first.context.close();activePage=null;
    const worker=await open('dark',390,844,'member');activePage=worker.page;
    await worker.page.goto(origin+'/dashboard/work?appointmentId='+work.appointment+'&executionId='+work.execution.id);
    await worker.page.waitForFunction(()=>['ready','partial-file'].includes(document.body.dataset.workState));
    await worker.page.getByRole('button',{name:'Add note',exact:true}).click();
    await worker.page.locator('#workEvidenceNote-note').fill('Assigned worker performed the requested follow-up observation.');
    await worker.page.locator('#workEvidenceNote').getByRole('button',{name:'Record field note',exact:true}).click();
    await worker.page.getByRole('dialog',{name:'Confirm Record field note',exact:true}).getByRole('button',{name:'Confirm Record field note',exact:true}).click();
    await worker.page.getByText('Assigned worker performed the requested follow-up observation.',{exact:true}).waitFor();
    assert.equal(await worker.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await worker.page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    await worker.page.screenshot({path:path.join(output,'dark-390-worker-follow-up.png'),fullPage:true});
    await worker.context.close();activePage=null;
    ledger.cases.push('assigned mobile worker records actual follow-up note after explicit resumption');
    const final=(await call('get',base+'/completion')).data;
    ledger.finalSnapshot=final;
    for(const role of ['dispatcher','viewer','otherOwner'])await call('get',base+'/handoffs',null,role,404);
    ledger.cases.push('other tenant and unentitled roles cannot read owner handoff');
    const migrations=(await f.ownerPool.query('SELECT * FROM _migrations ORDER BY filename')).rows;
    assert.equal(migrations.length,54);assert.equal(await f.db.initDatabase(),true);
    assert.deepEqual((await f.ownerPool.query('SELECT * FROM _migrations ORDER BY filename')).rows,migrations);
    ledger.migrations=migrations;
    const executionRows=(await f.ownerPool.query('SELECT id,appointment_id,lifecycle_state,revision FROM canonical_field_executions')).rows;
    assert.equal(executionRows.length,1);assert.equal(executionRows[0].id,work.execution.id);
    assert.equal(executionRows[0].lifecycle_state,'in_progress');
    ledger.finalDatabaseExecution=executionRows[0];
    ledger.cases.push('54 migrations zero-op and exactly one database execution throughout');
    assert.deepEqual(ledger.pageErrors,[]);assert.equal(ledger.providerAttempts,0);assert.deepEqual(ledger.externalBlocked,[]);
    ledger.status='passed';
  } catch(error) {
    ledger.status='failed';ledger.failure={message:error.message,stack:error.stack};
    if(activePage)await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  } finally {
    if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(j)await j.f.cleanup();
    https.request=previous.request;https.get=previous.get;globalThis.fetch=previous.fetch;
    fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
