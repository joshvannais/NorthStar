'use strict';
const crypto=require('node:crypto');const sha256=v=>crypto.createHash('sha256').update(v).digest('hex');const DEFINITIONS={identity:['organization.identity','fact','standard','internal'],services:['organization.services','generated_knowledge','standard','internal']};
function draft(actors, capability, content, suffix) {
  const definition = DEFINITIONS[capability];
  return {
    organizationId: actors.organizationId,
    actorUserId: actors.owner,
    canonicalKey: definition[0],
    entryType: definition[1],
    label: `Part 6 ${capability} ${suffix}`,
    sensitivity: definition[3],
    reviewRequirement: definition[2],
    origin: 'human',
    applicability: {},
    content,
    reason: `Create Part 6 ${capability} ${suffix}.`,
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: `part6:${suffix}:${capability}`,
      sourceVersion: '1',
      sourceDigest: sha256(`part6:${suffix}:${capability}:1`),
      jsonPointer: '/content',
    }],
  };
}

function workflowTarget(created, actorUserId, reason, overrides = {}) {
  return {
    organizationId: created.organizationId,
    actorUserId,
    entryId: created.id,
    versionId: created.version.id,
    versionNumber: created.version.number,
    canonicalDigest: created.version.canonicalDigest,
    expectedReviewEventId: null,
    reason,
    ...overrides,
  };
}

async function approveAndPublish(knowledge, pool, created, actors, prior = null) {
  const submitted = await knowledge.submitKnowledgeVersionForReview(
    pool,
    workflowTarget(created, actors.owner, `Submit ${created.canonicalKey} version ${created.version.number}.`)
  );
  const approved = await knowledge.approveKnowledgeVersion(
    pool,
    workflowTarget(created, actors.admin, `Approve ${created.canonicalKey} version ${created.version.number}.`, {
      expectedReviewEventId: submitted.event.id,
    })
  );
  return knowledge.publishKnowledgeVersion(
    pool,
    workflowTarget(created, actors.owner, `Publish ${created.canonicalKey} version ${created.version.number}.`, {
      expectedReviewEventId: approved.event.id,
      expectedPublicationId: prior ? prior.id : null,
      expectedPublicationNumber: prior ? prior.number : 0,
    })
  );
}

function lifecycleTarget(created, actors, reason, overrides = {}) {
  return {
    organizationId: actors.organizationId,
    actorUserId: actors.owner,
    entryId: created.id,
    expectedVersionId: created.version.id,
    expectedVersionNumber: created.version.number,
    expectedCanonicalDigest: created.version.canonicalDigest,
    reason,
    ...overrides,
  };
}

function revisionInput(created, actors, content, suffix) {
  return lifecycleTarget(created, actors, `Revise ${suffix}.`, {
    canonicalKey: created.canonicalKey,
    entryType: created.entryType,
    label: created.version.label,
    sensitivity: created.version.sensitivity,
    reviewRequirement: created.version.reviewRequirement,
    origin: 'human',
    applicability: created.version.applicability,
    content,
    provenance: [{
      sourceType: 'human_input',
      sourceRecordId: `part6-revision:${suffix}`,
      sourceVersion: '1',
      sourceDigest: sha256(`part6-revision:${suffix}`),
      jsonPointer: '/content',
    }],
  });
}

function targetInput(actors, overrides = {}) {
  return {
    organizationId: actors.organizationId,
    actorUserId: actors.owner,
    providerKey: 'intercepted.voice-provider',
    consumer: 'voice_runtime',
    audience: 'customer',
    capabilities: ['identity', 'services'],
    maximumEntries: 8,
    maximumBytes: 32768,
    staleAfterSeconds: 300,
    ...overrides,
  };
}

async function completeKnowledge(knowledge, pool, actors, suffix, hostile = '') {
  const identity = await knowledge.createInitialKnowledgeDraft(
    pool,
    draft(actors, 'identity', {
      facts: {
        businessDescription: `Verified ${suffix}`,
        company: {
          email: `private-${suffix}@example.test`,
          name: `Company ${suffix} ${hostile}`.trim(),
          taxId: `private-tax-${suffix}`,
        },
      },
      state: 'ready',
    }, suffix)
  );
  const identityPublication = await approveAndPublish(knowledge, pool, identity, actors);
  const services = await knowledge.createInitialKnowledgeDraft(
    pool,
    draft(actors, 'services', {
      facts: {
        services: [{
          active: true,
          canonicalPricing: { amount: 999 },
          description: `Service ${suffix}`,
          id: `service-${suffix}`,
          internalCost: 400,
          name: `Mounted Service ${suffix}`,
        }],
      },
      state: 'ready',
    }, suffix)
  );
  const servicesPublication = await approveAndPublish(knowledge, pool, services, actors);
  return { identity, identityPublication, services, servicesPublication };
}



module.exports={completeKnowledge,approveAndPublish,lifecycleTarget,draft};
