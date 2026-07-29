'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testPath = expect.getState().testPath || ('unknown-' + process.pid);
const identity = crypto.createHash('sha256').update(testPath).digest('hex').slice(0, 16);
const parent = path.join(os.tmpdir(), 'northstar-jest-data');
const root = path.join(parent, 'w' + (process.env.JEST_WORKER_ID || '0') + '-' + process.pid + '-' + identity);
const repositoryData = path.resolve(__dirname, '../../data');

if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(parent, { recursive: true });
fs.cpSync(repositoryData, root, { recursive: true, force: true });
process.env.NORTHSTAR_DATA_DIR = root;

afterAll(() => {
  const resolved = path.resolve(process.env.NORTHSTAR_DATA_DIR || '');
  const expected = path.resolve(root);
  const verifiedParent = path.resolve(parent) + path.sep;
  if (resolved !== expected || !resolved.startsWith(verifiedParent)) {
    throw new Error('Refusing unverified test data cleanup');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
});
