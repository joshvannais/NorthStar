'use strict';

const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(
  'public/js/command-center-page.js'), 'utf8');

test('one private no-store currentness read gates every Part 10 forecast surface', () => {
  expect(source.match(/\/api\/v1\/forecast\/runs\/currentness/g)).toHaveLength(1);
  expect(source).toMatch(/cache: 'no-store'/);
  for (const controller of ['forecastRanges','forecastTimeline','monthlyForecastKpis',
    'forecastDrilldowns','forecastDecisionSupport']) {
    expect(source).toContain(`activateForecastSurface(${controller}, current)`);
    expect(source).toContain(`activateForecastSurface(${controller}, refreshed)`);
  }
  expect(source).toMatch(/decision && decision\.state === 'unchanged_candidate'/);
  expect(source).toMatch(/else \{\s*controller\.workspaceUnavailable\(\)/);
});

test('fictional demo bypasses paid currentness and preserves isolated product behavior', () => {
  expect(source).toMatch(/if \(mode === 'demo'\) return Promise\.resolve\(\{ state: 'fictional' \}\)/);
  expect(source).toMatch(/if \(mode === 'demo'\) \{ controller\.workspaceReady\(authority\); return; \}/);
});
