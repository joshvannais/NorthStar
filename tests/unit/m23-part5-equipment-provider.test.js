'use strict';
const crypto = require('crypto');
const { createOpenAIRuntime, createProductionOpenAIRuntime } = require('../../src/polaris/openaiRuntime');
const { createEquipmentExtractor } = require('../../src/equipment/provider');
const actor = { organizationId: crypto.randomUUID(), userId: crypto.randomUUID(), role: 'owner' };
const message = 'Add a Ford F-350 that I sometimes use for hauling or plowing';
const identifiers = { manufacturer: 'Ford', model: 'F-350', modelYear: null, series: null, engine: null, configuration: null };
const envelope = () => ({ purpose: 'equipment_identifiers', authority: actor, message, requestId: crypto.randomUUID() });
function response(value = identifiers) { return { id: 'resp_intercepted_fixture', status: 'completed', output_text: JSON.stringify(value),
  usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } }; }
function runtime(value) { const create = jest.fn(async () => response(value)); return { create, runtime: createOpenAIRuntime({ configured: true, enabled: true, client: { responses: { create } } }) }; }
describe('Mission 23 Part 5 deterministic intercepted Responses boundary', () => {
  test('uses the existing gated strict Responses contract without tools, storage, research, or invented configuration', async () => {
    const fake = runtime(); const result = await fake.runtime.respond(envelope());
    expect(result.identifiers).toEqual({ manufacturer: 'Ford', model: 'F-350' });
    const request = fake.create.mock.calls[0][0];
    expect(request).toMatchObject({ model: 'gpt-5.6-luna', store: false, truncation: 'disabled', text: { format: { strict: true, name: 'northstar_equipment_literal_identifiers_v1' } } });
    expect(request.tools).toBeUndefined(); expect(request.input).not.toContain('OPENAI_API_KEY');
    expect(request.instructions).toContain('Do not research');
  });
  test.each([
    ['invented year', { ...identifiers, modelYear: '2024' }],
    ['similar model', { ...identifiers, model: 'F-250' }],
    ['invented capability', { ...identifiers, towing: '15000 lbs' }],
    ['hostile Unicode', { ...identifiers, model: 'F-350\u202e' }],
    ['tenant VIN field', { ...identifiers, vin: 'PRIVATE' }],
  ])('rejects %s without accepting model-memory authority', async (_label, value) => {
    await expect(runtime(value).runtime.respond(envelope())).rejects.toMatchObject({ code: 'POLARIS_PROVIDER_RESPONSE_INVALID' });
  });
  test('disabled production adapter never constructs any provider client', async () => {
    const factory = jest.fn(); const disabled = createProductionOpenAIRuntime({}, { clientFactory: factory });
    expect((await disabled.status()).state).toBe('unconfigured');
    await expect(disabled.respond(envelope())).rejects.toMatchObject({ code: 'POLARIS_CREDENTIAL_DISABLED' });
    expect(factory).not.toHaveBeenCalled();
  });
  test.each(['Starter', undefined, 'Complete '])('manual clarification remains available for non-entitled %p', async plan => {
    const fake = runtime(); const ledger = { reserve: jest.fn() };
    expect(await createEquipmentExtractor(fake.runtime, ledger)({ actor, message, plan, requestId: crypto.randomUUID() })).toEqual({});
    expect(fake.create).not.toHaveBeenCalled(); expect(ledger.reserve).not.toHaveBeenCalled();
  });
  test('reserves and reconciles only the existing tenant usage authority around the intercepted call', async () => {
    const fake = runtime(); const ledger = { reserve: jest.fn(async () => ({ id: 'fixture' })), reconcile: jest.fn(async () => {}) };
    expect(await createEquipmentExtractor(fake.runtime, ledger)({ actor, message, plan: 'Complete', requestId: crypto.randomUUID() })).toEqual({ manufacturer: 'Ford', model: 'F-350' });
    expect(ledger.reserve).toHaveBeenCalledTimes(1); expect(ledger.reconcile).toHaveBeenCalledTimes(1);
  });
  test('rejects an oversized assembled equipment envelope before an intercepted call', () => {
    const fake = runtime(); expect(() => fake.runtime.preflight({ ...envelope(), authority: { padding: 'x'.repeat(40000) } })).toThrow();
    expect(fake.create).not.toHaveBeenCalled();
  });
});
