'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '../../public/js/prepared-estimate.js'),
  'utf8'
);

test('prepared estimate review has no required freeform reason field', () => {
  assert.equal(source.includes('Reason For This Estimate'), false);
  assert.equal(source.includes('cdPreparedAdoptionReason'), false);
  assert.match(source, /Confirm that the costs are counted once before reviewing the total\./);
});

test('prepared estimate keeps a truthful generated audit explanation', () => {
  assert.match(
    source,
    /Owner reviewed the prepared estimate, plan selections, cost coverage, and proposed price\./
  );
  assert.match(source, /reason:auditReason/);
  assert.match(source, /explanation:coverageStatus==='unknown'\?'':auditReason/);
});
