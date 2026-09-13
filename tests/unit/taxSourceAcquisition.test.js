'use strict';
const { createTaxSourceAcquisition, publicContext } = require('../../src/estimating/taxSourceAcquisition');
const { createTaxSourceTransport, publicAddress } = require('../../src/estimating/taxSourceTransport');
const { TaxResearchWorker } = require('../../src/estimating/taxResearchWorker');
const context = { country: 'US', region: 'XX', locality: '', jurisdiction: '', serviceKey: 'fence', classification: '' };
const origins = new Set(['https://official.example']);
const source = { url: 'https://official.example/tax', content: 'Synthetic source text for a local test.', effectiveOn: null, endsOn: null, coverage: 'Declared test coverage', exclusions: 'No real tax coverage' };
test('only public context is sent; candidate evidence never validates coverage or supplies a rate', async () => {
 const transport = { acquire: jest.fn(async () => [source]) };
 const acquire = createTaxSourceAcquisition({ transport, allowedOrigins: origins, clock: () => new Date('2026-09-13T12:00:00Z') });
 const result = await acquire({ ...context, street: 'Private', registration: 'Private', rate: '10' });
 expect(transport.acquire.mock.calls[0][0]).toEqual(context);
 expect(result.candidates[0]).toMatchObject({ state: 'candidate', effectiveOn: null, endsOn: null, fetchedOn: '2026-09-13', reviewRequired: true });
 expect(result.candidates[0].contentDigest).toMatch(/^[a-f0-9]{64}$/);
 expect(result.candidates[0]).not.toHaveProperty('rate');
});
test.each([{ rate: '5' }, { validation: 'validated' }, { effectiveOn: '2026-02-30' }, { url: 'https://unreviewed.example/tax' }])('rejects promotion, invalid dates or unreviewed sources %j', async extra => {
 const acquire = createTaxSourceAcquisition({ transport: { acquire: async () => [{ ...source, ...extra }] }, allowedOrigins: origins });
 await expect(acquire(context)).rejects.toMatchObject({ code: 'TAX_SOURCE_INVALID' });
});
test('combined evidence has a durable size bound', async () => {
 const acquire = createTaxSourceAcquisition({ transport: { acquire: async () => [1,2].map(() => ({ ...source, content: 'x'.repeat(32000) })) }, allowedOrigins: origins });
 await expect(acquire(context)).rejects.toThrow(/combined/);
});
test.each(['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','fc00::1','2001:db8::1','::ffff:127.0.0.1'])('private/reserved network denied %s', address => expect(publicAddress(address)).toBe(false));
test('resolved private address rejected before request; DNS wait is bounded', async () => {
 const request = jest.fn();
 const make = lookup => createTaxSourceTransport({ documents: () => [source], allowedOrigins: origins, request, lookup, timeoutMs: 100 });
 await expect(make(async () => [{ address: '127.0.0.1', family: 4 }]).acquire(context)).rejects.toThrow(/public network/);
 await expect(make(() => new Promise(() => {})).acquire(context)).rejects.toThrow(/interrupted/);
 expect(request).not.toHaveBeenCalled();
});
test('missing transport does not claim work or consume retries', async () => {
 const worker = new TaxResearchWorker({ getPool: () => null });
 worker.enqueue=jest.fn(async()=>0);
 expect(await worker.tick()).toEqual({ processed: 0, adapterUnavailable: true });
});
test('worker commits claim before acquisition and finishes with same lease without a held client', async () => {
 let transactions = 0; const job = { id: 'job', leaseToken: 'lease', context };
 const worker = new TaxResearchWorker({ getPool: () => null, batchSize: 1, acquire: async received => { expect(transactions).toBe(0); expect(received).toEqual(context); return { state: 'unsupported' }; } });
 worker.enqueue=async()=>0;
 const queries = [];
 worker.transaction = async callback => { transactions++; try { return await callback({ query: async (sql,args) => { queries.push({sql,args}); return { rows: [{ result: job }] }; } }); } finally { transactions--; } };
 expect(await worker.tick()).toEqual({ processed: 1, paused: false });
 expect(queries.find(q=>q.sql.includes('canonical_tax_research_finish')).args).toEqual(['job','lease',{state:'unsupported'}]);
});
