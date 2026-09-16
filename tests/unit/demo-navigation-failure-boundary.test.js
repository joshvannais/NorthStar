'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../../public/js/command-center-contract');

const source = fs.readFileSync(path.join(__dirname, '../../public/js/nav-component.js'), 'utf8');

function navigationHarness(demo) {
  const attributes = {};
  const redirects = [];
  const window = {
    NorthStarCommandCenterContract: contract,
    NorthStarDemoRuntime: { active: demo },
    NorthStarAccountSession: { load: () => Promise.reject(new Error('workspace unavailable')) },
    location: { replace: destination => redirects.push(destination) },
  };
  const document = {
    documentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
    querySelectorAll: () => [],
  };
  vm.runInNewContext(source, { window, document, Promise });
  return window.NavComponent.init('command-center').then(() => ({ attributes, redirects }));
}

test('account-free demo workspace failures remain on the demo route', async () => {
  const result = await navigationHarness(true);
  expect(result.redirects).toEqual([]);
  expect(result.attributes['data-northstar-navigation']).toBe('unavailable');
});

test('paid workspace failures retain the authentication redirect', async () => {
  const result = await navigationHarness(false);
  expect(result.redirects).toEqual(['/login']);
  expect(result.attributes['data-northstar-navigation']).toBe('denied');
});
