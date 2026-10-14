'use strict';

const CONTRACT_VERSION = 'm27-invoice-public-session-v1';
const REASON = 'issued_invoice_unavailable';
const BEARER_LIMITATION = 'possession_does_not_prove_customer_or_recipient_identity';
const REQUIREMENTS = Object.freeze([
  Object.freeze({ requirement: 'exact_current_issued_document', state: 'unavailable' }),
  Object.freeze({ requirement: 'high_entropy_server_generated_token', state: 'not_created' }),
  Object.freeze({ requirement: 'hash_only_token_storage', state: 'not_created' }),
  Object.freeze({ requirement: 'bounded_invoice_public_session_expiration', state: 'unavailable' }),
  Object.freeze({ requirement: 'exact_issued_version_binding', state: 'unavailable' }),
  Object.freeze({ requirement: 'minimized_customer_session', state: 'not_created' }),
  Object.freeze({ requirement: 'revocation_authority', state: 'unavailable' }),
]);

function unavailable(mode = 'paid') {
  if (!['paid', 'demo'].includes(mode)) throw new Error('Invoice public-session mode invalid');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    value: null,
    requirements: REQUIREMENTS,
    bearerIdentityLimitation: BEARER_LIMITATION,
    rawTokenReturned: false,
    tokenHashStored: false,
    publicLookupMounted: false,
    publicRateLimitMounted: false,
    customerSessionCreated: false,
    exactIssuedVersionBound: false,
    expirationAssigned: false,
    revocationRecorded: false,
    downloadAuthorized: false,
    customerMutationAuthorized: false,
    thirdPartyContentIncluded: false,
    tokenInCookieUrlReferrerLogOrBrowserStorage: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function project(raw, expectedMode) {
  const mode = expectedMode || raw?.mode;
  const expected = unavailable(mode);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice public-session boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, BEARER_LIMITATION, REQUIREMENTS,
  unavailable, project };
