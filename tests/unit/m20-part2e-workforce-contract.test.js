'use strict';

const {
  ACCESS_ROLES,
  MUTABLE_ACCESS_ROLES,
  WorkforceService,
  rawText,
} = require('../../src/workforce/service');
const { prepareBusinessProfileForWrite } = require('../../src/services/businessProfileAdapter');
const { TransactionalEmail } = require('../../src/email/transactional');

function service(repository = {}) {
  return new WorkforceService(repository, {
    accountRepository: { consumeRateLimit: jest.fn(async () => ({ allowed: true })) },
    transactionalEmail: { invitation: jest.fn(async () => ({ delivered: true })) },
  });
}

describe('Mission 20 Part 2E workforce contract', () => {
  test('invitation security roles are separate from operational roles and preserve accepted raw text', () => {
    const rawName = '  <img src=x onerror=never()> Café é 🧰  ';
    const parsed = service().parseInvitation({
      name: rawName,
      email: ' PERSON@Example.Test ',
      phone: ' +1 (555) 010-2020 ',
      accessRole: 'member',
      operationalRole: 'technician',
      homeLocationId: 'office-north',
      skillIds: ['10000000-0000-4000-8000-000000000001'],
    });
    expect(parsed).toEqual({
      name: rawName,
      email: 'person@example.test',
      phone: ' +1 (555) 010-2020 ',
      accessRole: 'member',
      operationalRole: 'technician',
      homeLocationId: 'office-north',
      skillIds: ['10000000-0000-4000-8000-000000000001'],
    });
    expect(Array.from(ACCESS_ROLES).sort()).toEqual(['admin', 'member', 'viewer']);
    expect(Array.from(MUTABLE_ACCESS_ROLES).sort()).toEqual(['admin', 'dispatcher', 'member', 'tech', 'viewer']);
  });

  test.each(['owner', 'dispatcher', 'tech'])('new invitations reject the security role %s', role => {
    expect(() => service().parseInvitation({
      name: 'Worker', email: 'worker@example.test', phone: '', accessRole: role,
      operationalRole: 'employee', homeLocationId: null, skillIds: [],
    })).toThrow(expect.objectContaining({ code: 'invalid_access_role', status: 400 }));
  });

  test('existing legacy membership roles remain mutable without becoming invitation roles', async () => {
    const repository = { updateMemberAccess: jest.fn(async input => input) };
    const result = await service(repository).updateAccess(
      '10000000-0000-4000-8000-000000000002',
      { accessRole: 'dispatcher', membershipStatus: 'active' },
      { organizationId: 'org', actorUserId: 'owner' }
    );
    expect(result.accessRole).toBe('dispatcher');
    expect(repository.updateMemberAccess).toHaveBeenCalledTimes(1);
  });

  test('names enforce both exact UTF-8 bytes and 120 Unicode characters without trimming', () => {
    expect(rawText('  exact  ', 100, 'invalid', 'Name', true, 120)).toBe('  exact  ');
    expect(() => rawText('a'.repeat(121), 1000, 'invalid', 'Name', true, 120))
      .toThrow(expect.objectContaining({ code: 'invalid', status: 400 }));
    expect(() => rawText('🧰'.repeat(121), 480, 'invalid', 'Name', true, 120))
      .toThrow(expect.objectContaining({ code: 'invalid', status: 400 }));
  });

  test('unknown fields, duplicate ids, controls, and cross-contract values fail closed', () => {
    const workforce = service();
    const valid = {
      name: 'Worker', email: 'worker@example.test', phone: '', accessRole: 'viewer',
      operationalRole: 'estimator', homeLocationId: null, skillIds: [],
    };
    expect(() => workforce.parseInvitation({ ...valid, organizationId: 'forged' }))
      .toThrow(expect.objectContaining({ code: 'invalid_workforce_invitation' }));
    expect(() => workforce.parseInvitation({ ...valid, name: 'bad\u0000name' }))
      .toThrow(expect.objectContaining({ code: 'invalid_workforce_invitation' }));
    expect(() => workforce.parseInvitation({
      ...valid,
      skillIds: [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
      ],
    })).toThrow(expect.objectContaining({ code: 'invalid_workforce_invitation' }));
  });

  test('crew validation permits structural membership only and rejects duplicates or two leads', () => {
    const workforce = service();
    const lead = '10000000-0000-4000-8000-000000000001';
    const member = '10000000-0000-4000-8000-000000000002';
    expect(workforce.parseCrew({
      key: 'crew-north', name: '  North <Crew>  ', homeLocationId: 'office-north',
      members: [{ profileId: lead, role: 'lead' }, { profileId: member, role: 'member' }],
    }, true)).toEqual({
      key: 'crew-north', name: '  North <Crew>  ', homeLocationId: 'office-north',
      members: [{ profileId: lead, role: 'lead' }, { profileId: member, role: 'member' }],
    });
    expect(() => workforce.parseCrew({
      key: 'crew', name: 'Crew', homeLocationId: null,
      members: [{ profileId: lead, role: 'lead' }, { profileId: member, role: 'lead' }],
    }, true)).toThrow(expect.objectContaining({ code: 'invalid_workforce_crew' }));
    expect(() => workforce.parseCrew({
      key: 'crew', name: 'Crew', homeLocationId: null,
      members: [{ profileId: lead, role: 'member' }, { profileId: lead, role: 'member' }],
    }, true)).toThrow(expect.objectContaining({ code: 'invalid_workforce_crew' }));
  });

  test('versioned Business Profile workforce policy data preserves raw accepted bytes', () => {
    const rawName = '  Safety <Policy> ☃  ';
    const rawDescription = '\n  Keep exact é bytes; <script>data-only()</script>  \n';
    const prepared = prepareBusinessProfileForWrite({
      company: { name: 'Policy Company' },
      workforce: { policies: [{ id: 'safety-v1', name: rawName, description: rawDescription, enabled: true }] },
    });
    expect(prepared.errors).toEqual([]);
    expect(prepared.profile.workforce.policies[0]).toEqual({
      id: 'safety-v1', name: rawName, description: rawDescription, enabled: true,
    });
  });

  test('workforce invitation delivery uses the canonical link, escaped HTML, and isolated idempotency purpose', async () => {
    const calls = [];
    const email = new TransactionalEmail({
      adapter: { async send(message, options) { calls.push({ message, options }); return { accepted: true }; } },
      publicOrigin: 'https://app.example.test',
      from: 'notifications@northstar-os.ai',
      production: true,
    });
    await email.invitation('worker@example.test', 'A'.repeat(43), {
      deliveryId: '11111111-2222-4333-8444-555555555555', requestId: 'workforce-request',
    }, {
      name: 'Person <literal>', organizationName: 'Company & Co',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].message.text).toContain(
      'https://app.example.test/accept-invitation?token=' + 'A'.repeat(43)
    );
    expect(calls[0].message.html).toContain('Person &lt;literal&gt;');
    expect(calls[0].message.html).toContain('Company &amp; Co');
    expect(calls[0].message.html).not.toContain('Person <literal>');
    expect(calls[0].options.idempotencyKey).toMatch(/^northstar-b1-workforce-invitation-[0-9a-f]{64}$/);
    expect(calls[0].options.requestId).toBe('workforce-request');
  });

  test.each([
    [{ policies: 'not-an-array' }, 'workforce.policies must be an array'],
    [{ policies: [{ id: 'bad id', name: 'Policy', description: '', enabled: true }] }, '.id must be a stable identifier'],
    [{ policies: [{ id: 'same', name: 'A', description: '', enabled: true }, { id: 'SAME', name: 'B', description: '', enabled: true }] }, 'duplicate id'],
    [{ policies: [{ id: 'valid', name: 'Policy', description: '', enabled: true, schedule: 'forbidden' }] }, 'not a supported workforce policy field'],
  ])('invalid workforce policy authority is rejected: %s', (workforce, expected) => {
    const prepared = prepareBusinessProfileForWrite({ company: { name: 'Policy Company' }, workforce });
    expect(prepared.errors.join('\n')).toContain(expected);
  });
});
