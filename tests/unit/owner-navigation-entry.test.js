'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const contract = require('../../public/js/command-center-contract');
const source = fs.readFileSync(path.join(__dirname,'../../public/js/nav-component.js'),'utf8');
function project(navigation, mode = 'demo', active = 'command-center', text = source) {
  const window = {NorthStarCommandCenterContract:contract};
  vm.runInNewContext(text.replace('  window.NavComponent = {',
    '  window.projectForTest = function(account, active) { ACTIVE_PAGE = active; return projectedItems(account); };\n  window.NavComponent = {'), {window});
  return window.projectForTest({mode,navigation},active);
}
const nav = mode => contract.routesForMode(mode).map(r => ({id:r.id,href:mode === 'demo' ? r.demoPath : r.paidPath}));
test('all canonical paid and demo navigation entries have matching presentation and order', () => {
  for (const mode of ['paid','demo']) expect(Array.from(project(nav(mode),mode), x => x.id)).toEqual(nav(mode).map(x => x.id));
});
test('missing Operations presentation reproduces the released rejected navigation', () => {
  const prior = source.split('\n').filter(line => !line.includes("{ id: 'operations',")).join('\n');
  expect(project(nav('demo'),'demo','command-center',prior)).toBeNull();
});
test('paid subsets stay restricted and Today remains minimized', () => {
  const subset = nav('paid').filter(r => ['today','calendar'].includes(r.id));
  expect(Array.from(project(subset,'paid','calendar'),x => x.id)).toEqual(['today','calendar']);
  expect(Array.from(project(nav('paid'),'paid','today'),x => x.id)).toEqual(['today']);
});
test('unknown, duplicate and cross-mode destinations remain rejected', () => {
  expect(project([{id:'unknown',href:'/demo'}])).toBeNull();
  expect(project([nav('demo')[0],nav('demo')[0]])).toBeNull();
  expect(project([{id:'operations',href:'/dashboard/operations'}])).toBeNull();
  expect(project([{id:'operations',href:'/demo/operations'}],'paid')).toBeNull();
});
