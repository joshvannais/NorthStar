'use strict';

const assert = require('assert'),
  fs = require('fs'),
  path = require('path');
const {
  resolveBrowserRuntime
} = require('../helpers/playwright-runtime');
process.env.NODE_ENV = 'test';
for (const k of ['OPENAI_API_KEY', 'POLARIS_OPENAI_ENABLED', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k];
async function main() {
  const selected = (process.argv.find(x => x.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const output = path.resolve(process.argv.find(x => x.startsWith('--output=')).slice(9));
  assert(!fs.existsSync(output));
  fs.mkdirSync(output);
  const fixture = await require('../helpers/m23-equipment-browser-fixture').createFixture('p12structured-' + selected, {
    profileVersion: 'org-profile-v1'
  });
  let browser, server;
  const ledger = {
    head: require('child_process').execSync('git rev-parse HEAD').toString().trim(),
    tree: require('child_process').execSync('git rev-parse HEAD^{tree}').toString().trim(),
    workingTreeDirty: Boolean(require('child_process').execSync('git status --porcelain').toString().trim()),
    browser: selected,
    cases: [],
    pageErrors: [],
    requests: [],
    providerCalls: 0
  };
  try {
    server = fixture.app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const runtime = resolveBrowserRuntime(selected);
    browser = await runtime.browserType.launch({
      headless: true,
      executablePath: runtime.executablePath
    });
    ledger.version = browser.version();
    async function context(session, width, theme) {
      const c = await browser.newContext({
        viewport: {
          width,
          height: 900
        }
      });
      await c.addInitScript(t => localStorage.setItem('northstar-theme', t), theme);
      await c.addCookies([{
        name: 'northstar_access',
        value: session.accessToken,
        url: origin,
        httpOnly: true,
        sameSite: 'Lax'
      }, {
        name: 'northstar_csrf',
        value: session.csrfToken,
        url: origin,
        sameSite: 'Lax'
      }]);
      await c.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.fulfill({
        status: 204,
        body: ''
      }));
      return c;
    }
    async function open(p) {
      p.on('pageerror', e => ledger.pageErrors.push(e.message));
      p.on('response', async response => {
        if (response.request().method() === 'PUT') {
          const data = await response.json().catch(() => ({
            responseBodyUnavailableAfterContextClose: true
          }));
          ledger.requests.push({
            path: new URL(response.url()).pathname,
            status: response.status(),
            request: response.request().postDataJSON(),
            response: data
          });
        }
      });
      await p.goto(origin + '/dashboard/business-profile');
      await p.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
    }
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      const c = await context(fixture.session, width, theme);
      const p = await c.newPage();
      await open(p);
      const before = await p.evaluate(async () => {
        const r = await fetch('/api/v1/business-profile');
        return (await r.json()).data;
      });
      await p.locator('[data-section=financial]').click();
      const map = p.locator('[data-profile-editor=material]');
      await map.getByLabel('Internal cost', {
        exact: true
      }).fill(String(width));
      const equipment = p.locator('[data-profile-editor=equipment]');
      if ((await equipment.getByRole('button', {
        name: 'Add cost',
        exact: true
      }).count()) && (await equipment.getByLabel('Internal cost', {
        exact: true
      }).count()) === 0) {
        await equipment.getByRole('button', {
          name: 'Add cost',
          exact: true
        }).click();
        await equipment.getByLabel('Equipment pricing reference', {
          exact: true
        }).fill('Mini excavator hire');
      }
      await equipment.getByLabel('Internal cost', {
        exact: true
      }).first().fill('35.5');
      const save = p.locator('#saveFinancialConfigurationBtn');
      await save.click();
      await p.waitForFunction(() => !financialConfigurationDirty && !financialConfigurationSaving);
      const after = await p.evaluate(async () => (await (await fetch('/api/v1/business-profile')).json()).data);
      assert.strictEqual(after.canonicalCosts.materialCostByService['fence:cedar'], width);
      assert.strictEqual(after.canonicalCosts.equipmentCostByReference['Mini excavator hire'], 35.5);
      assert.deepStrictEqual(after.services, before.services);
      assert.deepStrictEqual(after.company, before.company);
      ledger.cases.push({
        width,
        theme,
        mountedFinancialSave: true,
        serviceMaterialKey: true,
        siblingServicesCompanyPreserved: true
      });
      await p.locator('[data-section=services]').click();
      const pricing = p.locator('[data-profile-editor=pricing]').first();
      await pricing.locator('.profile-structured-charge').nth(2).locator('summary').first().click();
      await pricing.getByLabel('Charge amount', {
        exact: true
      }).fill(String(width + 1));
      await p.locator('#saveBtn').click();
      await p.waitForFunction(() => document.getElementById('toast').textContent.includes('saved successfully'));
      const full = await p.evaluate(async () => (await (await fetch('/api/v1/business-profile')).json()).data);
      assert.strictEqual(full.services[0].canonicalPricing.lineItems[2].amount, width + 1);
      assert.deepStrictEqual(full.services[0].canonicalPricing.lineItems.map(x => x.code), before.services[0].canonicalPricing.lineItems.map(x => x.code));
      assert.strictEqual(full.canonicalCosts.materialCostByService['fence:cedar'], width);
      ledger.cases.push({
        width,
        fullProfileSave: true,
        chargeCodesAndFinancialSiblingPreserved: true
      });
      await p.locator('[data-section=serviceArea]').click();
      const polygon = p.locator('[data-profile-editor=polygon]');
      if (await polygon.getByRole('button', {
        name: 'Configure values',
        exact: true
      }).count()) await polygon.getByRole('button', {
        name: 'Configure values',
        exact: true
      }).click();
      for (let i = 0; i < 3; i++) {
        await polygon.getByRole('button', {
          name: 'Add point',
          exact: true
        }).click();
        await polygon.getByLabel('Latitude', {
          exact: true
        }).last().fill(String(41 + i / 10));
        await polygon.getByLabel('Longitude', {
          exact: true
        }).last().fill(String(-72 - i / 10));
      }
      await polygon.getByLabel('Latitude', {
        exact: true
      }).nth(0).fill('41');
      await polygon.getByLabel('Longitude', {
        exact: true
      }).nth(0).fill('-72');
      await p.locator('#saveBtn').click();
      await p.waitForFunction(() => document.getElementById('saveBtn').textContent === 'Save Profile');
      const saved = await p.evaluate(async () => (await (await fetch('/api/v1/business-profile')).json()).data);
      assert(Array.isArray(saved.serviceArea.polygon));
      assert.deepStrictEqual(saved.serviceArea.polygon[0], [41, -72]);
      ledger.cases.push({
        width,
        polygonMountedSave: true
      });
      for (const tab of ['serviceArea', 'financial', 'services']) {
        await p.locator('[data-section=' + tab + ']').click();
        if (tab === 'services') await pricing.locator('.profile-structured-charge').first().locator('summary').first().click();
        const panel = p.locator('#section-' + tab);
        const text = await panel.innerText();
        assert(!/JSON|PostgreSQL|perUnit|canonicalPricing|quantityField|lineItems|unitRates|immutable|Stable service ID/.test(text), text);
        await panel.screenshot({
          path: path.join(output, theme + '-' + width + '-' + tab + '.png')
        });
      }
      assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await c.close();
    }
    // A real competing financial save creates a version conflict; neither draft may silently overwrite the other.
    const a = await context(fixture.session, 1440, 'light'),
      b = await context(fixture.session, 390, 'dark');
    const pa = await a.newPage(),
      pb = await b.newPage();
    await open(pa);
    await open(pb);
    for (const p of [pa, pb]) await p.locator('[data-section=financial]').click();
    await pa.locator('[data-profile-editor=material]').getByLabel('Internal cost', {
      exact: true
    }).fill('111');
    await pb.locator('[data-profile-editor=material]').getByLabel('Internal cost', {
      exact: true
    }).fill('222');
    await pa.locator('#saveFinancialConfigurationBtn').click();
    await pa.waitForFunction(() => !financialConfigurationDirty && !financialConfigurationSaving);
    await pb.locator('#saveFinancialConfigurationBtn').click();
    await pb.waitForFunction(() => financialConfigurationConflicted);
    assert(await pb.locator('[data-profile-editor=material]').getByLabel('Internal cost', {
      exact: true
    }).isDisabled());
    assert.strictEqual(await pb.locator('[data-profile-editor=material]').getByLabel('Internal cost', {
      exact: true
    }).inputValue(), '222');
    ledger.cases.push({
      realVersionConflict: true,
      draftPreserved: true,
      conflictDisablesStructuredControls: true
    });
    await pb.screenshot({
      path: path.join(output, 'financial-conflict.png'),
      fullPage: true
    });
    await a.close();
    await b.close();
    const ga = await context(fixture.session, 1440, 'light');
    const gb = await context(fixture.session, 390, 'dark');
    const gap = await ga.newPage(), gbp = await gb.newPage();
    await open(gap); await open(gbp);
    for (const p of [gap, gbp]) { await p.locator('[data-section=services]').click(); await p.locator('.profile-structured-charge').nth(2).locator('summary').first().click(); }
    await gap.locator('[data-profile-editor=pricing]').getByLabel('Charge amount', {exact:true}).fill('333');
    await gbp.locator('[data-profile-editor=pricing]').getByLabel('Charge amount', {exact:true}).fill('444');
    await gap.locator('#saveBtn').click();
    await gap.waitForFunction(() => document.getElementById('toast').textContent.includes('saved successfully'));
    await gbp.locator('#saveBtn').click(); await gbp.waitForFunction(() => generalProfileConflicted);
    assert(await gbp.locator('[data-profile-editor=pricing]').getByLabel('Charge amount', {exact:true}).isDisabled());
    assert.strictEqual(await gbp.locator('[data-profile-editor=pricing]').getByLabel('Charge amount', {exact:true}).inputValue(), '444');
    ledger.cases.push({realGeneralVersionConflict:true, pricingDraftPreserved:true, conflictedPricingReadOnly:true});
    await gbp.screenshot({path:path.join(output,'profile-conflict.png'),fullPage:true});
    await ga.close(); await gb.close();
    const member = await context(fixture.memberSession, 390, 'dark'),
      pm = await member.newPage();
    await open(pm);
    for (const tab of ['serviceArea', 'financial', 'services']) {
      await pm.locator('[data-section=' + tab + ']').click();
      assert.strictEqual(await pm.locator('#section-' + tab + ' .profile-structured :is(input,select,button):enabled').count(), 0);
    }
    const denied = await pm.evaluate(async token => {
      const r = await fetch('/api/v1/business-profile/financialConfiguration', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token
        },
        body: JSON.stringify({
          expectedVersion: null,
          value: {
            canonicalCosts: {
              overheadPercent: 0
            }
          }
        })
      });
      return r.status;
    }, fixture.memberSession.csrfToken);
    assert.strictEqual(denied, 403);
    ledger.cases.push({
      memberAllFourEditorsReadOnly: true,
      mountedPermissionDenial: true
    });
    await member.close();
    assert.deepStrictEqual(ledger.pageErrors, []);
    ledger.pass = true;
  } catch (e) {
    ledger.error = e.stack;
    throw e;
  } finally {
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(r => server.close(r));
    await fixture.close();
  }
}
main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
