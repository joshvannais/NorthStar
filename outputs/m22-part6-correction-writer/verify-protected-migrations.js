'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeRepoPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  assert.ok(normalized && !normalized.startsWith('/') && !normalized.startsWith('../') &&
    !normalized.includes('/../'), 'repository-relative path required');
  return normalized;
}

function main() {
  const ref = String(process.argv[2] || 'HEAD');
  const ledgerPath = 'outputs/m22-part6-writer/migration-hashes.sha256';
  const ledgerBytes = git(['cat-file', 'blob', `${ref}:${ledgerPath}`], null);
  const rows = ledgerBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^([0-9a-f]{64})  (migrations\/[0-9]{3}_[^/]+\.sql)$/);
    assert.ok(match, `invalid protected-migration ledger row: ${line}`);
    return { sha256: match[1], repoPath: normalizeRepoPath(match[2]) };
  });
  assert.strictEqual(new Set(rows.map(row => row.repoPath)).size, rows.length,
    'duplicate protected-migration ledger path');

  const expectedPaths = git(['ls-tree', '-r', '-z', '--name-only', ref, '--', 'migrations'], null)
    .toString('utf8').split('\0').filter(Boolean).map(normalizeRepoPath)
    .filter(repoPath => /^migrations\/[0-9]{3}_[^/]+\.sql$/.test(repoPath)).sort();
  assert.deepStrictEqual(rows.map(row => row.repoPath).sort(), expectedPaths,
    'protected-migration ledger path coverage mismatch');

  for (const row of rows) {
    const blobBytes = git(['cat-file', 'blob', `${ref}:${row.repoPath}`], null);
    assert.strictEqual(digest(blobBytes), row.sha256, `Git blob mismatch: ${row.repoPath}`);
  }

  const migration035 = rows.find(row => row.repoPath.startsWith('migrations/035_'));
  assert.ok(migration035, 'migration 035 missing from protected-migration ledger');
  process.stdout.write(`${JSON.stringify({
    ref,
    rows: rows.length,
    ledgerBlobSha256: digest(ledgerBytes),
    migration035: migration035.repoPath,
    migration035Sha256: migration035.sha256,
  })}\n`);
}

main();
