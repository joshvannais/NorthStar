'use strict';

const express = require('express');
const db = require('../db');
const { requireAccountMutation, requireTenantAccess } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const {
  approveKnowledgeVersion,
  createKnowledgeRevision,
  createKnowledgeRollback,
  createKnowledgeTombstone,
  publishKnowledgeVersion,
  requestKnowledgeChanges,
  submitKnowledgeVersionForReview,
} = require('../knowledge/repository');
const {
  getKnowledgeManagementItem,
  listKnowledgeManagement,
} = require('../knowledge/managementRepository');
const { KnowledgeSynchronizationRepository } = require('../knowledge/synchronizationRepository');

function requestId(req) {
  return req.requestId || req.correlationId || 'unavailable';
}

function context(req) {
  return {
    organizationId: req.tenantContext.organizationId,
    actorUserId: req.tenantContext.userId,
  };
}

function exactBody(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => allowed.includes(key)) && required.every(key => keys.includes(key));
}

function invalidBody(req, res) {
  return res.status(400).json({
    success: false,
    error: {
      code: 'knowledge_management_invalid_request',
      message: 'The request body does not match the exact knowledge-management contract.',
    },
    requestId: requestId(req),
  });
}

function failure(req, res, error, event) {
  const status = Number.isInteger(error && error.status) ? error.status
    : Number.isInteger(error && error.statusCode) ? error.statusCode : null;
  if (status && typeof error.code === 'string') {
    return res.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details || {},
      },
      requestId: requestId(req),
    });
  }
  const diagnostic = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(value)
    ? value : 'unexpected';
  console.error('[KnowledgeManagement] Request failed:', {
    event,
    requestId: requestId(req),
    code: diagnostic(error && error.code),
    constraint: diagnostic(error && error.constraint),
  });
  return res.status(503).json({
    success: false,
    error: {
      code: 'knowledge_management_authority_unavailable',
      message: 'Canonical knowledge authority is temporarily unavailable.',
    },
    requestId: requestId(req),
  });
}

function createKnowledgeManagementRouter(options = {}) {
  const router = express.Router();
  const poolProvider = typeof options.poolProvider === 'function'
    ? options.poolProvider : () => db.getPool();
  const reads = {
    list: typeof options.list === 'function' ? options.list : listKnowledgeManagement,
    item: typeof options.item === 'function' ? options.item : getKnowledgeManagementItem,
  };
  const writes = {
    review: typeof options.review === 'function' ? options.review : submitKnowledgeVersionForReview,
    changes: typeof options.changes === 'function' ? options.changes : requestKnowledgeChanges,
    approve: typeof options.approve === 'function' ? options.approve : approveKnowledgeVersion,
    publish: typeof options.publish === 'function' ? options.publish : publishKnowledgeVersion,
    revise: typeof options.revise === 'function' ? options.revise : createKnowledgeRevision,
    tombstone: typeof options.tombstone === 'function' ? options.tombstone : createKnowledgeTombstone,
    rollback: typeof options.rollback === 'function' ? options.rollback : createKnowledgeRollback,
  };
  const tenantAccess = options.tenantAccess || requireTenantAccess;
  const accountMutation = options.accountMutation || requireAccountMutation;
  const settingsRead = options.settingsRead || requirePermission('settings', 'read');
  const settingsWrite = options.settingsWrite || requirePermission('settings', 'update');
  const synchronizationFactory = typeof options.synchronizationFactory === 'function'
    ? options.synchronizationFactory
    : pool => new KnowledgeSynchronizationRepository(pool);

  router.get('/', tenantAccess, settingsRead, async (req, res) => {
    try {
      const data = await reads.list(poolProvider(), {
        ...context(req),
        filters: {
          category: req.query.category,
          workflowStatus: req.query.workflowStatus,
          sensitivity: req.query.sensitivity,
          source: req.query.source,
          applicability: req.query.applicability,
        },
      });
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'knowledge_management_list_failed');
    }
  });

  router.get('/items/:entryId', tenantAccess, settingsRead, async (req, res) => {
    try {
      const data = await reads.item(poolProvider(), {
        ...context(req),
        entryId: req.params.entryId,
        versionNumber: req.query.versionNumber,
      });
      return res.json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'knowledge_management_item_failed');
    }
  });

  const workflowKeys = [
    'versionId', 'versionNumber', 'canonicalDigest', 'expectedReviewEventId', 'reason',
  ];
  function workflowAction(name, operation, status = 200, optionalKeys = []) {
    router.post(`/items/:entryId/${name}`, accountMutation, settingsWrite, async (req, res) => {
      const allowed = workflowKeys.concat(optionalKeys);
      if (!exactBody(req.body, allowed, workflowKeys)) return invalidBody(req, res);
      try {
        const data = await operation(poolProvider(), {
          ...req.body,
          ...context(req),
          entryId: req.params.entryId,
        });
        return res.status(status).json({ success: true, data, requestId: requestId(req) });
      } catch (error) {
        return failure(req, res, error, `knowledge_management_${name}_failed`);
      }
    });
  }

  workflowAction('review', writes.review, 201);
  workflowAction('changes', writes.changes, 201);
  workflowAction('approve', writes.approve, 201, ['attorneyReview']);

  const publicationKeys = workflowKeys.concat(['expectedPublicationId', 'expectedPublicationNumber']);
  router.post('/items/:entryId/publish', accountMutation, settingsWrite, async (req, res) => {
    if (!exactBody(req.body, publicationKeys)) return invalidBody(req, res);
    try {
      const data = await writes.publish(poolProvider(), {
        ...req.body,
        ...context(req),
        entryId: req.params.entryId,
      });
      return res.status(201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'knowledge_management_publish_failed');
    }
  });

  const revisionKeys = [
    'expectedVersionId', 'expectedVersionNumber', 'expectedCanonicalDigest', 'reason',
    'canonicalKey', 'entryType', 'label', 'sensitivity', 'reviewRequirement',
    'applicability', 'content', 'provenance', 'origin',
  ];
  router.post('/items/:entryId/revise', accountMutation, settingsWrite, async (req, res) => {
    if (!exactBody(req.body, revisionKeys)) return invalidBody(req, res);
    try {
      const current = await reads.item(poolProvider(), {
        ...context(req),
        entryId: req.params.entryId,
        versionNumber: req.body.expectedVersionNumber,
      });
      if (current.version.id !== req.body.expectedVersionId ||
          current.version.canonicalDigest !== String(req.body.expectedCanonicalDigest || '').trim()) {
        const conflict = new Error('The knowledge version changed; reload before revising.');
        conflict.code = 'knowledge_version_conflict';
        conflict.status = 409;
        throw conflict;
      }
      if (!current.permissions.canReviseDirectly) {
        const sourceRequired = new Error(
          'Generated or authoritative knowledge must be corrected in its Business Profile source.'
        );
        sourceRequired.code = 'knowledge_source_correction_required';
        sourceRequired.status = 409;
        sourceRequired.details = { correction: current.sourceCorrection };
        throw sourceRequired;
      }
      const data = await writes.revise(poolProvider(), {
        ...req.body,
        ...context(req),
        entryId: req.params.entryId,
      });
      return res.status(201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'knowledge_management_revise_failed');
    }
  });

  const lifecycleKeys = [
    'expectedVersionId', 'expectedVersionNumber', 'expectedCanonicalDigest', 'reason',
  ];
  router.post('/items/:entryId/tombstone', accountMutation, settingsWrite, async (req, res) => {
    if (!exactBody(req.body, lifecycleKeys)) return invalidBody(req, res);
    try {
      const data = await writes.tombstone(poolProvider(), {
        ...req.body,
        ...context(req),
        entryId: req.params.entryId,
      });
      return res.status(201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'knowledge_management_tombstone_failed');
    }
  });

  const rollbackKeys = lifecycleKeys.concat([
    'rollbackVersionId', 'rollbackVersionNumber', 'rollbackCanonicalDigest',
  ]);
  router.post('/items/:entryId/rollback', accountMutation, settingsWrite, async (req, res) => {
    if (!exactBody(req.body, rollbackKeys)) return invalidBody(req, res);
    try {
      const data = await writes.rollback(poolProvider(), {
        ...req.body,
        ...context(req),
        entryId: req.params.entryId,
      });
      return res.status(201).json({ success: true, data, requestId: requestId(req) });
    } catch (error) {
      return failure(req, res, error, 'knowledge_management_rollback_failed');
    }
  });

  const synchronizationKeys = ['expectedTargetRevision', 'expectedConfigurationDigest'];
  function synchronizationAction(name) {
    router.post(`/synchronization/:targetId/${name}`, accountMutation, settingsWrite, async (req, res) => {
      if (!exactBody(req.body, synchronizationKeys)) return invalidBody(req, res);
      try {
        const repository = synchronizationFactory(poolProvider());
        const data = await repository.reconcileTarget({
          ...req.body,
          ...context(req),
          targetId: req.params.targetId,
        });
        return res.status(201).json({ success: true, data, requestId: requestId(req) });
      } catch (error) {
        return failure(req, res, error, `knowledge_management_sync_${name}_failed`);
      }
    });
  }
  synchronizationAction('reconcile');
  synchronizationAction('retry');

  return router;
}

module.exports = {
  createKnowledgeManagementRouter,
  exactBody,
};
