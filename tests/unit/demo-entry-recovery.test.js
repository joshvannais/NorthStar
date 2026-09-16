'use strict';

const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const repositoryModule = require('../../src/commandCenter/demoRepository');
const workspaceModule = require('../../src/commandCenter/workspace');

test('homepage Explore Demo controls remain bound to the account-free route', () => {
  const homepage = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const controls = Array.from(homepage.matchAll(
    /<a\b(?=[^>]*data-telemetry-action="homepage_explore_demo")[^>]*>/g
  ), match => match[0]);
  expect(controls.length).toBeGreaterThanOrEqual(2);
  expect(controls.every(control => /href="\/demo"/.test(control))).toBe(true);
  expect(controls.every(control => !/href="\/login/.test(control))).toBe(true);
});

function freshRecord(token) {
  return {
    token,
    tenantId: token.tenantId,
    sessionId: token.sessionId,
    state: workspaceModule.createInitialDemoState(token.tenantId, token.issuedAt, {
      seed: repositoryModule.workspaceSeedForToken(token.tokenHash),
    }),
    revision: 1,
    simulationCount: 0,
    mutationCount: 0,
    persisted: false,
    expiresAt: token.expiresAt,
    lastSimulatedAt: null,
  };
}

test.each(['DEMO_SESSION_EXPIRED', 'DEMO_STATE_CHANGED', 'DEMO_STATE_INVALID'])(
  'public demo entry replaces an unreadable fictional session: %s',
  async code => {
    const staleToken = repositoryModule.issueToken(new Date());
    const read = jest.spyOn(repositoryModule.DemoCommandCenterRepository.prototype, 'read')
      .mockImplementation(async token => {
        if (token.token === staleToken.token) {
          throw new repositoryModule.DemoCommandCenterError(
            code === 'DEMO_SESSION_EXPIRED' ? 410 : code === 'DEMO_STATE_CHANGED' ? 409 : 503,
            code,
            'Synthetic unreadable demo session.'
          );
        }
        return freshRecord(token);
      });
    jest.resetModules();
    // Keep the spied repository constructor in the route module's dependency graph.
    jest.doMock('../../src/commandCenter/demoRepository', () => repositoryModule);
    const { app } = require('../../src/server');

    const response = await request(app).get('/api/demo/command-center')
      .set('Host', 'northstar.test')
      .set('Cookie', 'northstar_demo_workspace=' + encodeURIComponent(staleToken.token))
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.mode).toBe('demo');
    expect(response.body.data.tenant.id).not.toBe(staleToken.tenantId);
    expect(response.headers['set-cookie'][0]).toContain('northstar_demo_workspace=');
    expect(response.headers['set-cookie'][0]).not.toContain(encodeURIComponent(staleToken.token));
    read.mockRestore();
    jest.dontMock('../../src/commandCenter/demoRepository');
  }
);
