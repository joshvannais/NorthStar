'use strict';
const { hash, error, uuid } = require('./contract');
const { RESPONSE_SCHEMA } = require('../polaris/assistantContract');
const { evaluateProviderEntitlement } = require('../polaris/providerPolicy');
function createEquipmentExtractor(runtime, usageLedger) {
  return async ({ actor, message, requestId, plan }) => {
    // Manual clarification works when the existing provider is unconfigured;
    // absence never turns model memory or a guessed specification into evidence.
    if (!evaluateProviderEntitlement({ plan, role: actor.role }).canUseProvider || !runtime) return {};
    const status = await runtime.status();
    if (status.state !== 'configured') return {};
    uuid(requestId);
    const authority = { organizationId: actor.organizationId, userId: actor.userId, role: actor.role };
    const envelope = { purpose: 'equipment_identifiers', authority, message, requestId };
    runtime.preflight(envelope);
    const reservation = await usageLedger.reserve({ organizationId: actor.organizationId, userId: actor.userId,
      requestId, fingerprint: hash(envelope), model: 'gpt-5.6-luna', schemaVersion: RESPONSE_SCHEMA });
    try {
      const result = await runtime.respond(envelope);
      await usageLedger.reconcile(reservation, result.usage);
      return result.identifiers;
    } catch (cause) {
      if (cause.polarisUsage) await usageLedger.reconcile(reservation, cause.polarisUsage);
      throw error(503, 'EQUIPMENT_EXTRACTION_UNAVAILABLE', 'Identifier assistance is unavailable. No asset was saved.');
    }
  };
}
module.exports = { createEquipmentExtractor };
