'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.resolve(__dirname, '../../public/unlisted/investor-forecast.html');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const context = vm.createContext({ console, setTimeout, clearTimeout });
vm.runInContext(scripts[0], context, { filename: sourcePath });
const Model = context.NorthStarInvestorModelV33;
const realm = value => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
const run = input => Model.runDriverForecast(realm(input || {}));
module.exports = { Model, realm, run, source, scripts, context };
if (require.main === module) {
  const result = run();
  console.log(JSON.stringify({ summary: result.summary, first: result.rows[0], last: result.rows.at(-1) }, null, 2));
}
