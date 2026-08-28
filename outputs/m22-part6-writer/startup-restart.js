'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

// Part 6 adds no migration. Reuse the already accepted role-separated Mission
// 22 startup/restart harness against the current Part 6 source tree so the
// protected migration-035 checksum, first/second startup behavior, runtime-role
// restrictions, and two credential-free health checks remain comparable.
const harness = path.resolve(__dirname, '..', 'm22-part5-writer', 'startup-restart.js');
const result = spawnSync(process.execPath, [harness], {
  cwd: path.resolve(__dirname, '..', '..'),
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
