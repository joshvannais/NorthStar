'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Part 7 adds no migration. Run the accepted role-separated Mission 22
// startup/restart harness against this exact source tree. This preserves the
// protected migration-035 identity, first/second startup behavior, runtime
// role restrictions, and two credential-free health probes while producing a
// durable exact-run artifact for the mission-wide acceptance ledger.
const root = path.resolve(__dirname, '..', '..');
const harness = path.resolve(__dirname, '..', 'm22-part5-writer', 'startup-restart.js');
const result = spawnSync(process.execPath, [harness], {
  cwd: root,
  env: process.env,
  encoding: 'utf8',
  windowsHide: true,
});

if (result.error) throw result.error;
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const evidenceFile = process.env.M22_PART7_STARTUP_EVIDENCE_FILE;
if (evidenceFile) {
  const resolved = path.resolve(root, evidenceFile);
  const evidenceRoot = path.resolve(__dirname, 'raw') + path.sep;
  if (!resolved.startsWith(evidenceRoot)) {
    throw new Error('M22_PART7_STARTUP_EVIDENCE_FILE must be inside the Part 7 raw evidence directory');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, result.stdout || '', 'utf8');
}

process.exitCode = Number.isInteger(result.status) ? result.status : 1;
