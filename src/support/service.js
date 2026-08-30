'use strict';

const crypto = require('crypto');
const { sanitizeScreenshot } = require('./attachment');
const { SupportCaseError, normalizeSubmission } = require('./contract');
const { SupportCaseRepository } = require('./repository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, code, message) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new SupportCaseError(404, code, message);
  return value.toLowerCase();
}

class SupportCaseService {
  constructor(repository) {
    this.repository = repository || new SupportCaseRepository();
  }

  async create(input, context) {
    const attachment = input.file ? sanitizeScreenshot(input.file) : null;
    const parsed = normalizeSubmission({
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      attachment,
    });
    const caseId = crypto.randomUUID();
    return this.repository.create({
      ...parsed,
      caseId,
      caseNumber: `NS-BUG-${caseId.replace(/-/g, '').toUpperCase()}`,
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
  }

  list(context) {
    return this.repository.list(context.organizationId, context.actorUserId);
  }

  read(caseId, context) {
    return this.repository.read(
      context.organizationId, context.actorUserId,
      uuid(caseId, 'support_case_not_found', 'Support case not found.')
    );
  }

  attachment(caseId, attachmentId, context) {
    return this.repository.attachment(
      context.organizationId,
      context.actorUserId,
      uuid(caseId, 'support_case_not_found', 'Support case not found.'),
      uuid(attachmentId, 'support_attachment_not_found', 'Support screenshot not found.')
    );
  }
}

module.exports = { SupportCaseService };
