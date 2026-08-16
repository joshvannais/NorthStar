'use strict';

const config = require('../../src/config');
const {
  RETELL_MAX_RESPONSE_BYTES,
  RETELL_REQUEST_TIMEOUT_MS,
  createWebCall,
  deleteCall,
  getAgent,
} = require('../../src/retell/client');

describe('Homepage Retell client boundary', () => {
  let originalFetch;
  let originalApiKey;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = config.retell.apiKey;
    config.retell.apiKey = 'test-only-retell-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    config.retell.apiKey = originalApiKey;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('pins create-web-call to the exact inspected agent version', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ call_id: 'call_1' }),
    }));

    await createWebCall('agent_homepage', { northstar_demo_mode: 'homepage' }, 7);

    const request = global.fetch.mock.calls[0][1];
    expect(JSON.parse(request.body)).toEqual({
      agent_id: 'agent_homepage',
      agent_version: 7,
      retell_llm_dynamic_variables: { northstar_demo_mode: 'homepage' },
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  test('classifies a missing delete target as an already-absent call', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'missing' }),
    }));

    await expect(deleteCall('call_already_deleted')).rejects.toMatchObject({
      stage: 'retell_call',
      code: 'RETELL_CALL_NOT_FOUND',
      httpStatus: 404,
    });
  });

  test('aborts a provider request at the bounded timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));

    const pending = getAgent('agent_homepage');
    const assertion = expect(pending).rejects.toMatchObject({
      stage: 'retell_network',
      code: 'RETELL_REQUEST_TIMEOUT',
      httpStatus: 504,
    });
    await jest.advanceTimersByTimeAsync(RETELL_REQUEST_TIMEOUT_MS);
    await assertion;
  });

  test('rejects an oversized provider response before reading its body', async () => {
    const responseText = jest.fn(async () => '{"unexpected":true}');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: name => name === 'content-length' ? String(RETELL_MAX_RESPONSE_BYTES + 1) : null },
      text: responseText,
    }));

    await expect(getAgent('agent_homepage')).rejects.toMatchObject({
      stage: 'retell_response',
      code: 'RETELL_RESPONSE_TOO_LARGE',
      httpStatus: 502,
    });
    expect(responseText).not.toHaveBeenCalled();
  });
});
