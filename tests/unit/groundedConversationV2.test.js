'use strict';
const { validatePayload, projectResponse, executeGrounded, digest } = require('../../src/polaris/groundedConversation');
const envelope = () => ({ requestId: 'request', untrustedInput: { selected: { kind: 'work', id: 'one' } },
  groundedContext: { basisDigest: 'basis', evidence: [{ id: 'scope', value: 'Replace the existing fence' }],
    proposals: [{ id: 'review_labor', editor: 'labor', fields: {} }], allowedCards: ['capella'],
    trustedFacts: [{ label: 'Labor Cost', value: '160.00', unit: 'USD' }] } });
const answer = () => ({ questions: [{ text: 'Will the existing fence need to be removed?', evidenceIds: ['scope'] }],
  explanations: [{ text: 'Removal is not recorded in this scope.', evidenceIds: ['scope'] }], proposalIds: [], requestedCard: 'none' });

test('generated questions and source explanations are retained, authoritative figures remain server-owned', () => {
  const e = envelope(), result = projectResponse(answer(), e);
  expect(result.questions[0].text).toMatch(/existing fence/);
  expect(result.trustedFacts).toEqual(e.groundedContext.trustedFacts);
  expect(result.canonicalMutationAllowed).toBe(false);
});
test.each(['price', 'approved', 'booking', 'taxValidation'])('rejects extra model authority field %s', field => {
  expect(() => validatePayload({ ...answer(), [field]: true }, envelope())).toThrow();
});
test('rejects unknown/private references, unavailable cards and invented editor proposals', () => {
  const a = answer(); a.explanations[0].evidenceIds = ['private_other_tenant'];
  expect(() => validatePayload(a, envelope())).toThrow();
  expect(() => validatePayload({ ...answer(), requestedCard: 'estimate_review' }, envelope())).toThrow();
  expect(() => validatePayload({ ...answer(), proposalIds: ['save_price'] }, envelope())).toThrow();
});
test('a missing-fact question can be uncited but an assertion cannot', () => {
  const a = answer(); a.questions[0].evidenceIds = [];
  expect(validatePayload(a, envelope()).questions).toHaveLength(1);
  a.explanations[0].evidenceIds = []; expect(() => validatePayload(a, envelope())).toThrow();
});
test('rechecks the entire current basis after provider wait and suppresses stale output/cache', async () => {
  const loadCurrent = jest.fn().mockResolvedValueOnce({ revision: 1 }).mockResolvedValueOnce({ revision: 2 });
  const writeCached = jest.fn();
  await expect(executeGrounded({ loadCurrent, generate: async () => answer(), writeCached, request: {} })).rejects.toMatchObject({ statusCode: 409 });
  expect(writeCached).not.toHaveBeenCalled();
});
test('revoked authority rejects cached exact replay without invoking provider', async () => {
  const loadCurrent = jest.fn().mockResolvedValueOnce({ revision: 1 }).mockRejectedValueOnce(Object.assign(new Error('Access unavailable'), { statusCode: 403 }));
  const generate = jest.fn();
  await expect(executeGrounded({ loadCurrent, generate, readCached: async () => answer(), request: {} })).rejects.toMatchObject({ statusCode: 403 });
  expect(generate).not.toHaveBeenCalled();
});
test('current exact replay revalidates twice and retains exact response', async () => {
  const loadCurrent = jest.fn().mockResolvedValue({ revision: 1 }), saved = answer();
  expect(await executeGrounded({ loadCurrent, readCached: async () => saved, generate: jest.fn(), request: {} })).toBe(saved);
  expect(loadCurrent).toHaveBeenCalledTimes(2);
  expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
});
