'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const consumers = [
  ['login', '../../public/login.html', "data.error || 'Login failed'"],
  ['signup', '../../public/signup.html', "result.error || 'Signup failed'"],
  ['contact', '../../public/contact.html', "data.error || 'Something went wrong."],
  ['dashboard', '../../public/dashboard.html', 'errBody.error ||'],
  ['command-center', '../../public/dashboard/command-center.html', 'errBody.error ||'],
  ['communications', '../../public/dashboard/communications.html', "e.error || 'Request failed'"],
  ['leads', '../../public/dashboard/leads.html', "e.error || 'Request failed'"],
  ['polaris-api', '../../public/js/polaris-api.js', "e.error || 'Request failed"],
];

describe('legacy frontend error envelope compatibility', function () {
  test.each(consumers)('%s consumes the backward-compatible error string', function (_label, relativePath, marker) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    expect(source).toContain(marker);
    expect(source).not.toMatch(/(?:data|result|errBody|response|e)\.error\.message/);
  });

  test.each([400, 401, 403, 404, 409, 422, 429, 500, 503])(
    'shared API client preserves a meaningful flat error for status %i',
    async function (status) {
      const source = fs.readFileSync(path.join(__dirname, '../../public/js/api.js'), 'utf8');
      const requestId = '123e4567-e89b-42d3-a456-426614174000';
      const context = {
        window: { location: { port: '' } },
        localStorage: { getItem: function () { return null; } },
        document: { getElementById: function () { return null; } },
        fetch: function () {
          return Promise.resolve({
            ok: false,
            status: status,
            json: function () {
              return Promise.resolve({
                error: 'Safe compatibility message ' + status + '.',
                code: 'fixture_' + status,
                requestId: requestId,
              });
            },
          });
        },
        Promise: Promise,
        Error: Error,
        Date: Date,
        JSON: JSON,
        setTimeout: setTimeout,
      };
      vm.runInNewContext(source, context);
      await expect(context.window.API.request('GET', '/fixture')).rejects.toMatchObject({
        message: 'Safe compatibility message ' + status + '.',
        status: status,
        code: 'fixture_' + status,
        requestId: requestId,
      });
    }
  );

  test('legacy nested errors remain readable during mixed-version rollout', async function () {
    const source = fs.readFileSync(path.join(__dirname, '../../public/js/api.js'), 'utf8');
    const context = {
      window: { location: { port: '' } },
      localStorage: { getItem: function () { return null; } },
      document: { getElementById: function () { return null; } },
      fetch: function () {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: function () {
            return Promise.resolve({
              error: {
                message: 'Legacy conflict message.',
                code: 'conflict',
                requestId: '123e4567-e89b-42d3-a456-426614174002',
              },
            });
          },
        });
      },
      Promise: Promise,
      Error: Error,
      Date: Date,
      JSON: JSON,
      setTimeout: setTimeout,
    };
    vm.runInNewContext(source, context);
    await expect(context.window.API.request('GET', '/fixture')).rejects.toMatchObject({
      message: 'Legacy conflict message.',
      code: 'conflict',
      requestId: '123e4567-e89b-42d3-a456-426614174002',
    });
  });
});
