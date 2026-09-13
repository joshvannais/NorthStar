'use strict';
// Presentation-only mapping for the new conversation endpoint. Existing v1
// codes, retry ownership and stored request fingerprints are unchanged.
const COPY={
 POLARIS_IDEMPOTENCY_KEY_REUSED:'This question or its record changed. Refresh the current details before asking again.',
 POLARIS_IDEMPOTENCY_CAPACITY:'Conversation is temporarily busy. Your saved records remain available; try again later.',
 POLARIS_IDEMPOTENCY_CLOCK_INVALID:'Conversation could not be confirmed. Check the saved record before trying again.',
 POLARIS_IDEMPOTENCY_SCOPE_INVALID:'Conversation access could not be confirmed. Refresh and try again.'
};
function present(error){return COPY[error?.code]?Object.assign(new Error(COPY[error.code]),error,{message:COPY[error.code]}):error;}
module.exports={present};
