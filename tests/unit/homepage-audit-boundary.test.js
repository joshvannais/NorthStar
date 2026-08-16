'use strict';

const {
  isPublicEphemeralHomepageMutation,
  requestAuditEntry,
} = require('../../src/middleware/auditLog');
const { isEphemeralHomepageWebhook } = require('../../src/voice/webhook');

function req(method, url) {
  return {
    method,
    originalUrl: url,
    url,
    path: url.split('?')[0],
    baseUrl: '',
    route: null,
    headers: { 'user-agent': 'test-agent' },
    ip: '203.0.113.42',
    params: {},
    requestId: 'request-id',
  };
}

describe('Homepage ephemeral audit boundary', () => {
  test.each([
    ['POST', '/api/demo/homepage/web-call'],
    ['POST', '/api/demo/homepage/web-call/'],
    ['POST', '/API/DEMO/HOMEPAGE/POLARIS/call_ABC-123'],
    ['DELETE', '/api/demo/homepage/web-call/call_ABC-123?retry=true'],
  ])('%s %s bypasses durable raw-source audit', (method, url) => {
    expect(isPublicEphemeralHomepageMutation(req(method, url))).toBe(true);
  });

  test.each([
    ['GET', '/api/demo/homepage/status'],
    ['DELETE', '/api/demo/homepage/polaris/call_1'],
    ['POST', '/api/demo/homepage/web-call/call_1'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/demo/homepage/polaris/bad.value'],
  ])('%s %s preserves ordinary audit semantics', (method, url) => {
    expect(isPublicEphemeralHomepageMutation(req(method, url))).toBe(false);
  });

  test('ordinary audit entries still retain their established source fields', () => {
    expect(requestAuditEntry(req('POST', '/api/auth/login'), 401, 12)).toEqual(expect.objectContaining({
      ipAddress: '203.0.113.42',
      userAgent: 'test-agent',
      correlationId: 'request-id',
    }));
  });

  test('only the exact marked Retell web-call contract enters the zero-persistence webhook path', () => {
    const payload = {
      event: 'call_ended',
      call: {
        call_type: 'web_call',
        retell_llm_dynamic_variables: {
          northstar_demo_mode: 'homepage_browser_web_call',
          northstar_demo_webhook_contract: 'homepage-ephemeral-web-call-v1',
        },
      },
    };
    expect(isEphemeralHomepageWebhook(payload)).toBe(true);
    expect(isEphemeralHomepageWebhook({ ...payload, call: { ...payload.call, call_type: 'phone_call' } })).toBe(false);
    expect(isEphemeralHomepageWebhook({
      ...payload,
      call: { ...payload.call, retell_llm_dynamic_variables: { northstar_demo_mode: 'homepage_browser_web_call' } },
    })).toBe(false);
  });
});
