'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function git(args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: process.cwd(), encoding, maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

function normalizeRepoPath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  assert.ok(normalized && !normalized.startsWith('/') && !normalized.startsWith('../') &&
    !normalized.includes('/../'), 'repository-relative path required');
  return normalized;
}

function listEvidence(ref, root, ledgerPath) {
  const raw = git(['ls-tree', '-r', '-z', '--name-only', ref, '--', root], null);
  return raw.toString('utf8').split('\0').filter(Boolean).map(normalizeRepoPath)
    .filter(value => value !== ledgerPath).sort();
}

function blob(ref, repoPath) {
  return git(['cat-file', 'blob', `${ref}:${repoPath}`], null);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseLedger(value) {
  const rows = value.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    assert.ok(match, `invalid ledger row: ${line}`);
    return { sha256: match[1], repoPath: normalizeRepoPath(match[2]) };
  });
  assert.strictEqual(new Set(rows.map(row => row.repoPath)).size, rows.length, 'duplicate ledger path');
  return rows;
}

function generate(ref, root, ledgerPath) {
  const files = listEvidence(ref, root, ledgerPath);
  const rows = files.map(repoPath => `${digest(blob(ref, repoPath))}  ${repoPath}`);
  const output = `${rows.join('\n')}\n`;
  fs.mkdirSync(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  fs.writeFileSync(path.resolve(ledgerPath), output, { encoding: 'utf8' });
  return { mode: 'generate', ref, root, ledgerPath, rows: rows.length, sha256: digest(Buffer.from(output, 'utf8')) };
}

function verify(ref, root, ledgerPath) {
  const ledgerBytes = blob(ref, ledgerPath);
  const rows = parseLedger(ledgerBytes);
  const expectedPaths = listEvidence(ref, root, ledgerPath);
  assert.deepStrictEqual(rows.map(row => row.repoPath).sort(), expectedPaths, 'ledger path coverage mismatch');
  for (const row of rows) {
    assert.ok(row.repoPath.startsWith(`${root}/`), `ledger row escapes evidence root: ${row.repoPath}`);
    assert.strictEqual(digest(blob(ref, row.repoPath)), row.sha256, `Git blob mismatch: ${row.repoPath}`);
  }
  return { mode: 'verify', ref, root, ledgerPath, rows: rows.length, ledgerBlobSha256: digest(ledgerBytes) };
}

function main() {
  const [mode, refInput, rootInput, ledgerInput] = process.argv.slice(2);
  assert.ok(mode === 'generate' || mode === 'verify', 'usage: node m22-part6-git-blob-ledger.js <generate|verify> <ref> <root> <ledger>');
  const ref = String(refInput || '');
  assert.ok(ref, 'Git ref required');
  const root = normalizeRepoPath(rootInput);
  const ledgerPath = normalizeRepoPath(ledgerInput);
  assert.ok(ledgerPath.startsWith(`${root}/`), 'ledger must be inside evidence root');
  const result = mode === 'generate' ? generate(ref, root, ledgerPath) : verify(ref, root, ledgerPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = { generate, verify };
