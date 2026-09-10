'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  resolveBrowserRuntime
} = require('../helpers/playwright-runtime');
const {
  canonicalFenceProfile
} = require('../helpers/m19-part3-business-profile');
const {
  prepareBusinessProfileForWrite
} = require('../../src/services/businessProfileAdapter');
async function main() {
  const selected = (process.argv.find(x => x.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const output = path.resolve(process.argv.find(x => x.startsWith('--output=')).slice(9));
  assert(!fs.existsSync(output));
  fs.mkdirSync(output);
  const root = path.resolve(__dirname, '../../public');
  const server = http.createServer((req, res) => {
    const p = path.join(root, req.url);
    if (['/js/profile-structured-fields.js', '/css/profile-structured-fields.css'].includes(req.url)) {
      res.end(fs.readFileSync(p));
    } else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const runtime = resolveBrowserRuntime(selected);
  const browser = await runtime.browserType.launch({
    headless: true,
    executablePath: runtime.executablePath
  });
  const ledger = {
    head: require('child_process').execSync('git rev-parse HEAD').toString().trim(),
    tree: require('child_process').execFileSync('git', ['rev-parse', 'HEAD^{tree}']).toString().trim(),
    workingTreeDirty: Boolean(require('child_process').execSync('git status --porcelain').toString().trim()),
    browser: selected,
    version: browser.version(),
    cases: [],
    pageErrors: [],
    providerCalls: 0
  };
  try {
    for (const [width, theme] of [[1440, 'light'], [390, 'dark']]) {
      const context = await browser.newContext({
        viewport: {
          width,
          height: 900
        },
        colorScheme: theme
      });
      const page = await context.newPage();
      page.on('pageerror', e => ledger.pageErrors.push(e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.setContent('<style>:root{--neutral-200:#aab3c2;--radius:12px;--radius-sm:8px;--brand-500:#c49b2c}body{font:16px system-ui;max-width:1050px;margin:20px auto;padding:12px;background:' + (theme === 'dark' ? '#152033;color:#edf0f5' : '#f7f8fa;color:#142136') + '}input,select,button{font:inherit;padding:8px}input,select{background:inherit;color:inherit;border:1px solid #8e9db2}</style><link rel="stylesheet" href="/css/profile-structured-fields.css"><h1>Business settings</h1><div><input id="polygon"></div><div><input id="material"></div><div><input id="equipment"></div><div><input id="pricing"></div>');
      await page.addScriptTag({
        url: '/js/profile-structured-fields.js'
      });
      const pricing = canonicalFenceProfile().services[0].canonicalPricing;
      const fixtures = {
        polygon: [[41, -72], {
          latitude: 42,
          longitude: -72
        }, [42, -73]],
        material: {
          'fence:cedar': 0,
          'service:custom:pine': 12
        },
        equipment: {
          'mini-excavator': 0,
          'private reference': 15
        },
        pricing
      };
      await page.evaluate(data => {
        for (const [k, v] of Object.entries(data)) NorthStarProfileFields.mount(document.getElementById(k), k, v, {
          services: [{
            id: 'FENCE',
            name: 'Fence installation'
          }, {
            id: 'service:custom',
            name: 'Custom service'
          }]
        });
      }, fixtures);
      const read = () => page.evaluate(() => Object.fromEntries(['polygon', 'material', 'equipment', 'pricing'].map(k => [k, document.getElementById(k)._profileFields.read()])));
      assert.deepStrictEqual(await read(), fixtures);
      ledger.cases.push({
        width,
        theme,
        allFourExactRoundtrip: true,
        polygonObjectShapePreserved: true,
        zeroPreserved: true
      });
      const polygon = page.locator('[data-profile-editor=polygon]');
      await polygon.getByLabel('Latitude', {
        exact: true
      }).first().fill('40.5');
      await polygon.getByRole('button', {
        name: 'Move point down',
        exact: true
      }).first().click();
      assert.deepStrictEqual((await read()).polygon, [{
        latitude: 42,
        longitude: -72
      }, [40.5, -72], [42, -73]]);
      ledger.cases.push({
        width,
        polygonEditedAndReordered: true
      });
      const material = page.locator('[data-profile-editor=material]');
      await material.getByLabel('Internal cost', {
        exact: true
      }).first().fill('99.25');
      const afterMaterial = (await read()).material;
      assert.strictEqual(afterMaterial['fence:cedar'], 99.25);
      assert.strictEqual(afterMaterial['service:custom:pine'], 12);
      ledger.cases.push({
        width,
        materialServiceMaterialExactMap: true
      });
      const equipment = page.locator('[data-profile-editor=equipment]');
      await equipment.getByLabel('Internal cost', {
        exact: true
      }).first().fill('10');
      assert.strictEqual((await read()).equipment['mini-excavator'], 10);
      ledger.cases.push({
        width,
        equipmentReferenceNotAssetIdentity: true
      });
      const editor = page.locator('[data-profile-editor=pricing]');
      const charges = editor.locator('.profile-structured-charge');
      for (let i = 0; i < (await charges.count()); i++) await charges.nth(i).locator('summary').first().click();
      await editor.getByLabel('Charge amount', {
        exact: true
      }).fill('25');
      await editor.getByLabel('Price per unit', {
        exact: true
      }).first().fill('2.5');
      await charges.nth(1).getByLabel('Price', {
        exact: true
      }).first().fill('3.25');
      await charges.nth(3).getByLabel('Price', {
        exact: true
      }).first().fill('7.5');
      const edited = (await read()).pricing;
      assert.strictEqual(edited.lineItems[2].amount, 25);
      assert.strictEqual(edited.lineItems[0].unitRate, 2.5);
      assert.deepStrictEqual(edited.lineItems.map(x => x.code), pricing.lineItems.map(x => x.code));
      assert.strictEqual(edited.lineItems[1].unitRates.cedar, 3.25);
      assert.strictEqual(edited.lineItems[3].unitRates.walk, 7.5);
      assert.deepStrictEqual(edited.lineItems[2].when, pricing.lineItems[2].when);
      const profile = canonicalFenceProfile();
      profile.services[0].canonicalPricing = edited;
      assert.deepStrictEqual(prepareBusinessProfileForWrite(profile).errors, []);
      ledger.cases.push({
        width,
        allFourTypesExistingServerValidation: true,
        stableCodesAndConditions: true
      });
      await editor.getByRole('button', {
        name: 'Add charge',
        exact: true
      }).click();
      let newCharge = editor.locator('.profile-structured-charge').last();
      await newCharge.locator('summary').first().click();
      await newCharge.getByLabel('Charge amount', {
        exact: true
      }).fill('0');
      const newCode = (await read()).pricing.lineItems.at(-1).code;
      await newCharge.getByLabel('How to charge', {
        exact: true
      }).selectOption('perUnit');
      await newCharge.getByLabel('Quantity to measure', {
        exact: true
      }).selectOption('linearFeet');
      await newCharge.getByLabel('Price per unit', {
        exact: true
      }).fill('2');
      assert.strictEqual((await read()).pricing.lineItems.at(-1).type, 'perUnit');
      await newCharge.getByLabel('How to charge', {
        exact: true
      }).selectOption('perUnitByValue');
      await newCharge.getByLabel('Detail that chooses the price', {
        exact: true
      }).selectOption('material');
      await newCharge.getByRole('button', {
        name: 'Set prices by choice',
        exact: true
      }).click();
      await newCharge.getByRole('button', {
        name: 'Add price',
        exact: true
      }).click();
      await newCharge.getByLabel('Choice name', {
        exact: true
      }).fill('cedar');
      await newCharge.getByLabel('Price', {
        exact: true
      }).fill('5');
      assert.strictEqual((await read()).pricing.lineItems.at(-1).type, 'perUnitByValue');
      await newCharge.getByLabel('How to charge', {
        exact: true
      }).selectOption('perItemByValue');
      await newCharge.getByLabel('List of items to price', {
        exact: true
      }).selectOption('gates');
      assert.strictEqual((await read()).pricing.lineItems.at(-1).code, newCode);
      assert.strictEqual((await read()).pricing.lineItems.at(-1).type, 'perItemByValue');
      ledger.cases.push({
        width,
        newChargeAllFourTypes: true,
        internalReferenceStable: true
      });
      const numeric = newCharge.getByLabel('Price', {
        exact: true
      });
      await numeric.fill('');
      assert.match(await page.evaluate(() => {
        try {
          document.getElementById('pricing')._profileFields.read();
          return '';
        } catch (e) {
          return e.message;
        }
      }), /valid price/);
      await newCharge.getByRole('button', {
        name: 'Remove charge',
        exact: true
      }).click();
      assert.strictEqual(await newCharge.count(), 1);
      await numeric.fill('0');
      assert.strictEqual((await read()).pricing.lineItems.at(-1).unitRates.cedar, 0);
      ledger.cases.push({
        width,
        invalidDraftBlocksStructuralLossAndSave: true
      });
      await page.screenshot({
        path: path.join(output, theme + '-' + width + '-configured.png'),
        fullPage: true
      });
      await material.getByRole('button', {
        name: 'Remove configuration',
        exact: true
      }).click();
      assert.strictEqual((await read()).material, undefined);
      await material.getByRole('button', {
        name: 'Configure values',
        exact: true
      }).click();
      assert.deepStrictEqual((await read()).material, {});
      ledger.cases.push({
        width,
        absentVersusEmpty: true
      });
      await material.getByRole('button', {name:'Add cost',exact:true}).click();
      await material.getByLabel('Material', {exact:true}).fill('Cedar');
      await material.getByLabel('Internal cost', {exact:true}).fill('0');
      assert.deepStrictEqual((await read()).material, {'fence:cedar':0});
      ledger.cases.push({width,newMaterialKeyMatchesCalculationCaseRules:true});

      await polygon.getByRole('button', {
        name: 'Clear boundary',
        exact: true
      }).click();
      assert.deepStrictEqual((await read()).polygon, []);
      await polygon.getByRole('button', {
        name: 'Add point',
        exact: true
      }).focus();
      await page.keyboard.press('Enter');
      assert.match(await page.evaluate(() => {
        try {
          document.getElementById('polygon')._profileFields.read();
          return '';
        } catch (e) {
          return e.message;
        }
      }), /at least three/);
      ledger.cases.push({
        width,
        keyboardAddAndBoundaryValidation: true
      });
      await page.evaluate(() => document.getElementById('pricing')._profileFields.load({
        futureSetting: {
          keep: 123
        }
      }));
      assert.match(await page.evaluate(() => {
        try {
          document.getElementById('pricing')._profileFields.read();
          return '';
        } catch (e) {
          return e.message;
        }
      }), /unresolved/);
      assert.strictEqual(await page.locator('#pricing').inputValue(), '{"futureSetting":{"keep":123}}');
      assert(!/futureSetting|123/.test(await editor.innerText()));
      await editor.getByRole('button', {
        name: 'Replace these settings',
        exact: true
      }).click();
      assert.strictEqual(await page.locator('#pricing').inputValue(), '{"futureSetting":{"keep":123}}');
      await editor.getByRole('button', {
        name: 'Confirm replacement with empty settings',
        exact: true
      }).click();
      assert.deepStrictEqual(await page.evaluate(() => document.getElementById('pricing')._profileFields.read()), {});
      ledger.cases.push({
        width,
        unknownPreservedUntilExplicitConfirmation: true
      });
      await page.evaluate(() => document.getElementById('equipment').disabled = true);
      await page.waitForFunction(() => document.querySelector('[data-profile-editor=equipment]').disabled);
      assert(await equipment.getByLabel('Internal cost', {
        exact: true
      }).first().isDisabled());
      ledger.cases.push({
        width,
        readOnlyControls: true
      });
      const text = await page.locator('body').innerText();
      assert(!/JSON|perUnit|canonicalPricing|quantityField|unitRates|PostgreSQL/.test(text));
      const geometry = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth
      }));
      assert(geometry.scroll <= geometry.width + 1);
      ledger.cases.push({
        width,
        plainLanguage: true,
        noHorizontalOverflow: true
      });
      await page.screenshot({
        path: path.join(output, theme + '-' + width + '-states.png'),
        fullPage: true
      });
      await context.close();
    }
    assert.deepStrictEqual(ledger.pageErrors, []);
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack;
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
    await browser.close();
    await new Promise(r => server.close(r));
  }
}
main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
