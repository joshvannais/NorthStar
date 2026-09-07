'use strict';

const { grantAndVerify } = require('../../src/completion/transcriptDatabaseAuthority');

function clientWith(updatable) {
  return { query: jest.fn(async sql => {
    if (sql.includes('to_regprocedure')) return { rows: [{ present: true }] };
    if (sql.startsWith('SELECT attname')) return { rows: [{ attname: 'source' }, { attname: 'transcript_text' }] };
    if (sql.includes('AS readable')) return { rows: [{
      readable: true, insertable: true, writable: false, updatable,
    }] };
    return { rows: [] };
  }) };
}

test('startup accepts zero transcript UPDATE columns and never restores a writable lock column', async () => {
  const client = clientWith([]);
  await expect(grantAndVerify(client, 'runtime_fixture')).resolves.toBeUndefined();
  const statements = client.query.mock.calls.map(([sql]) => sql).join('\n');
  expect(statements).toContain('REVOKE UPDATE, DELETE ON TABLE');
  expect(statements).toContain('REVOKE UPDATE ("source","transcript_text")');
  expect(statements).not.toMatch(/GRANT UPDATE/);
});

test('startup fails closed if any effective transcript content UPDATE grant survives reconciliation', async () => {
  await expect(grantAndVerify(clientWith(['transcript_text']), 'runtime_fixture'))
    .rejects.toThrow('Transcript');
});
