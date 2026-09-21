'use strict';

const { VERSION, buildAlgorithmCatalog } = require('../../src/forecasting/algorithmCatalog');
const { VERSION: OUTPUT_VERSION } = require('../../src/forecasting/outputContract');
const organizationId = '55555555-5555-4555-8555-555555555555';
const catalog = definitions => ({ version: VERSION, organizationId, definitions });

function descriptor(key, algorithmVersion = 'v1') {
  return {
    key, algorithmVersion,
    target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
    kind: 'deterministic', implementationDigest: 'a'.repeat(64),
    parametersDigest: null, featureDefinitionDigests: ['b'.repeat(64)],
    horizonGrains: ['month', 'week'], outputContractVersion: OUTPUT_VERSION,
    trainingReceiptDigest: null, trainingPolicyVersion: null,
  };
}

describe('Mission 26 Part 3D unmounted algorithm identity catalog', () => {
  test('normalizes order and detaches the candidate identity without activating it', () => {
    const a = descriptor('baseline.mean');
    const b = descriptor('baseline.seasonal');
    const result = buildAlgorithmCatalog(catalog([b, a]));
    expect(result.definitions.map(item => item.key)).toEqual(['baseline.mean', 'baseline.seasonal']);
    expect(result.definitions[0].horizonGrains).toEqual(['month', 'week']);
    expect(result.digest).toBe(buildAlgorithmCatalog(catalog([a, b])).digest);
    expect(result.organizationId).toBe(organizationId);
    expect(Object.isFrozen(result.definitions[0].featureDefinitionDigests)).toBe(true);
    a.target.key = 'other';
    expect(result.definitions[0].target.key).toBe('demand.inbound_leads');
    expect(result).not.toHaveProperty('active');
  });

  test('statistical identity needs a typed training pin while deterministic forbids it', () => {
    const statistical = descriptor('baseline.regression');
    statistical.kind = 'statistical';
    statistical.trainingReceiptDigest = 'c'.repeat(64);
    statistical.trainingPolicyVersion = 'tenant_private_v1';
    expect(buildAlgorithmCatalog(catalog([statistical])).definitions[0].kind).toBe('statistical');
    const missing = { ...statistical, trainingReceiptDigest: null };
    expect(() => buildAlgorithmCatalog(catalog([missing])))
      .toThrow('Forecast algorithm catalog details are invalid.');
    const mislabeled = { ...descriptor('baseline.mean'), trainingReceiptDigest: 'c'.repeat(64) };
    expect(() => buildAlgorithmCatalog(catalog([mislabeled])))
      .toThrow('Forecast algorithm catalog details are invalid.');
  });

  test('rejects duplicate identities, extra fields and sparse arrays with hidden extras', () => {
    const one = descriptor('baseline.mean');
    const sparse = Array(1);
    sparse.extra = 'hidden';
    for (const definitions of [[one, one], sparse, [{ ...one, active: true }]]) {
      try {
        buildAlgorithmCatalog(catalog(definitions));
        throw new Error('accepted malformed catalog');
      } catch (error) { expect(error.code).toBe('M26_ALGORITHM_CATALOG_INVALID'); }
    }
    const badFeatures = descriptor('baseline.mean');
    badFeatures.featureDefinitionDigests = Array(1);
    badFeatures.featureDefinitionDigests.extra = 'hidden';
    expect(() => buildAlgorithmCatalog(catalog([badFeatures])))
      .toThrow('Forecast algorithm catalog details are invalid.');
    expect(() => buildAlgorithmCatalog({ ...catalog([]), organizationId: 'other' }))
      .toThrow('Forecast algorithm catalog details are invalid.');
  });

  test('empty catalog is valid but supplies no active model or training data', () => {
    const result = buildAlgorithmCatalog(catalog([]));
    expect(result.definitions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
