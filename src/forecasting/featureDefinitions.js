'use strict';

// Source-controlled feature identities. Registering a definition does not
// authorize a source read or implement its named derivation.
const { DEFINITION_VERSION, normalizeFeatureDefinition,
  normalizeFeatureValue } = require('./featureContract');

const DEFINITIONS = Object.freeze([
  normalizeFeatureDefinition({
    contractVersion: DEFINITION_VERSION,
    key: 'pipeline.approved_estimate_stock', definitionVersion: 'v1',
    sourceKinds: ['estimate_decision'], sourcePurposeKey: 'forecast_pipeline',
    sourceTargetKey: 'pipeline.approved_estimates',
    derivationKey: 'active_decision_count', temporalBasis: 'as_of_stock',
    unit: { key: 'count', currency: null, scale: 0 }, allowsNegative: false,
  }),
]);

function registeredFeatureDefinition(key, version) {
  return DEFINITIONS.find(definition => definition.key === key &&
    definition.definitionVersion === version) || null;
}

function normalizeRegisteredFeatureValue(input) {
  const definition = input && registeredFeatureDefinition(input.definitionKey,
    input.definitionVersion);
  if (!definition) {
    const error = new Error('Forecast feature definition is not registered.');
    error.code = 'M26_FEATURE_DEFINITION_UNREGISTERED';
    error.status = 400;
    throw error;
  }
  const value = normalizeFeatureValue(input, definition);
  // This stock counts active decision rows. A positive count cannot come from
  // an empty source set, while an authorized empty snapshot can prove zero.
  if (definition.derivationKey === 'active_decision_count' &&
      value.state === 'known' && value.amount !== '0' &&
      value.latestSourceRecordedAt === null) {
    const error = new Error('Forecast feature source record time is required.');
    error.code = 'M26_FEATURE_SOURCE_TIME_REQUIRED';
    error.status = 400;
    throw error;
  }
  return value;
}

module.exports = { DEFINITIONS, registeredFeatureDefinition,
  normalizeRegisteredFeatureValue };
