'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const inherited = require('../m23-part5-writer/availability-exclusions.json');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = '^(?!(?:' + inherited.map(item => escape(item.name)).join('|') + ')$)';
const admin = new URL(process.env.M19_PG_ADMIN_URL);
const negative = name => { const url = new URL(admin); url.pathname = '/' + name; return url.toString(); };

const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/jest/bin/jest.js'), '--runInBand', '--silent', '--json',
  '--outputFile=' + path.join(__dirname, 'available-results.json'),
  '--testNamePattern=' + pattern,
  '--testPathIgnorePatterns=tests/integration/m23-part5-equipment-migration.test.js',
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ACCOUNT_MIGRATION_NEGATIVE_FRESH_URL: negative('pr71_negative_fresh'),
    ACCOUNT_MIGRATION_NEGATIVE_UPGRADE_URL: negative('pr71_negative_upgrade'),
  },
});

process.exit(result.status === null ? 1 : result.status);
