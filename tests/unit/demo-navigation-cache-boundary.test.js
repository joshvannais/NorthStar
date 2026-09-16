'use strict';

const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { app } = require('../../src/server');

const ROOT = path.resolve(__dirname, '..', '..');
const RELEASE = 'demo-nav-10-20260915';
const RUNTIME_RELEASE = 'demo-runtime-14-20260915';
const DEMO_PAGES = [
  'public/demo-dashboard.html',
  'public/dashboard/polaris.html',
  'public/dashboard/leads.html',
  'public/dashboard/communications.html',
  'public/dashboard/calendar.html',
  'public/dashboard/operations.html',
  'public/dashboard/team.html',
  'public/dashboard/business-profile.html',
  'public/dashboard/settings.html',
  'public/dashboard/integrations.html',
];
const RUNTIME_PAGES = [
  ...DEMO_PAGES,
  'public/dashboard/command-center.html',
  'public/dashboard/completion-review.html',
  'public/dashboard/ai-settings.html',
  'public/dashboard/my-number.html',
];

test('every account-free page requests one released navigation contract and renderer', () => {
  for (const relativePath of DEMO_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    expect(html).toContain(`/js/command-center-contract.js?v=${RELEASE}`);
    expect(html).toContain(`/js/nav-component.js?v=${RELEASE}`);
  }
});

test('every page that mounts the demo runtime requests the current release', () => {
  for (const relativePath of RUNTIME_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    expect(html).toContain(`/js/demo-runtime.js?v=${RUNTIME_RELEASE}`);
  }
});

test.each([
  '/js/command-center-contract.js',
  '/js/nav-component.js',
  '/js/demo-runtime.js',
])('%s cannot be retained across releases', async assetPath => {
  const response = await request(app).get(`${assetPath}?v=${RELEASE}`).expect(200);
  expect(response.headers['cache-control']).toBe('no-store, no-cache, must-revalidate');
});
