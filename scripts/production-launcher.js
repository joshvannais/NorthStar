'use strict';

// This file is an executable composition root, never a capability module.
if (require.main !== module) {
  throw new Error('The NorthStar production launcher is not importable.');
}

const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EXPECTED_NODE = 'v22.23.3';
const PROOF_BYTES = 32;
const FAILURE = 'The NorthStar production launcher is unavailable.';

if (process.version !== EXPECTED_NODE || process.execArgv.length !== 0 ||
    process.argv.length !== 2 || process.argv[1] !== __filename) {
  throw new Error(`${FAILURE} Expected ${EXPECTED_NODE} with no inherited Node flags.`);
}

for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
  'npm_config_node_options', 'NODE_V8_COVERAGE']) {
  if (typeof process.env[key] === 'string' && process.env[key].length > 0) {
    throw new Error(`${FAILURE} Unsupported Node startup environment.`);
  }
}

const allowedEnvironment = Object.freeze([
  'AUTH_ACCESS_MINUTES', 'AUTH_ACCESS_SECRET', 'AUTH_REFRESH_DAYS',
  'CALENDAR_TYPE', 'CANONICAL_CACHE_DISABLED', 'CUSTOMER_ESTIMATE_ISSUANCE_PAUSED',
  'CUSTOMER_ESTIMATE_LINK_SECRET', 'DATABASE_URL', 'DB_POOL_MAX', 'DEMO_API_KEY',
  'GOOGLE_CALENDAR_CREDENTIALS', 'GOOGLE_SHEETS_CLIENT_EMAIL',
  'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
  'HOMEPAGE_RETELL_AGENT_ID', 'HOMEPAGE_RETELL_AGENT_VERSION',
  'HOMEPAGE_RETELL_LEGAL_APPROVED', 'HOMEPAGE_RETELL_PROVIDER_APPROVED',
  'HOMEPAGE_RETELL_WEB_CALL_ENABLED', 'HOMEPAGE_RETELL_WEBHOOK_ISOLATION_APPROVED',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET', 'JWT_SECRET', 'KNOWLEDGE_PROVIDER_BINDINGS',
  'LANG', 'LC_ALL', 'MIGRATION_DATABASE_URL', 'NORTHSTAR_DATA_DIR',
  'NORTHSTAR_DEMO_ORGANIZATION_ID', 'NORTHSTAR_SUPPORT_EMAIL', 'OPENAI_API_KEY',
  'POLARIS_CALL_CANARY_BINDING', 'POLARIS_CALL_GUIDANCE_ENABLED',
  'POLARIS_DEMO_GENERATION_ENABLED', 'POLARIS_GROUNDED_V2_ENABLED',
  'POLARIS_INPUT_COUNT_ACCOUNTING_VERSION', 'POLARIS_INPUT_COUNT_MAX_COST_NANO_USD',
  'POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST',
  'POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON', 'POLARIS_OPENAI_ENABLED', 'PORT',
  'PUBLIC_ORIGIN', 'RESEND_API_KEY', 'RETELL_AGENT_ID', 'RETELL_API_KEY',
  'RETELL_PHONE_NUMBER', 'SMTP_HOST', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_USER',
  'SYSTEMROOT', 'TEMP', 'TMP', 'TRANSACTIONAL_EMAIL_FROM', 'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'TZ', 'WINDIR',
]);

const childEnvironment = Object.create(null);
for (const key of allowedEnvironment) {
  if (typeof process.env[key] === 'string') childEnvironment[key] = process.env[key];
}
childEnvironment.NODE_ENV = 'production';

const proof = crypto.randomBytes(PROOF_BYTES);
const proofDigest = crypto.createHash('sha256').update(proof).digest('hex');
childEnvironment.NORTHSTAR_CANONICAL_LAUNCH = 'os-pipe-v1';
childEnvironment.NORTHSTAR_CANONICAL_LAUNCH_DIGEST = proofDigest;
childEnvironment.NORTHSTAR_CANONICAL_LAUNCH_PARENT = String(process.pid);

const childEntry = path.resolve(__dirname, '../src/productionChild.js');
const child = spawn(process.execPath, [childEntry], {
  cwd: path.resolve(__dirname, '..'),
  env: childEnvironment,
  stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
  windowsHide: true,
});

let settled = false;
function terminate(signal) {
  if (!settled && child.pid) child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => terminate(signal));
}

child.once('error', error => {
  settled = true;
  console.error(`${FAILURE} ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  settled = true;
  if (signal) {
    console.error(`${FAILURE} Child exited from ${signal}.`);
    process.exitCode = 1;
  } else process.exitCode = Number.isInteger(code) ? code : 1;
});
const childBoundProof = Buffer.alloc(PROOF_BYTES + 8);
proof.copy(childBoundProof, 0);
childBoundProof.writeBigUInt64BE(BigInt(child.pid), PROOF_BYTES);
child.stdio[3].end(childBoundProof);

// No reusable launcher capability is exported.
Object.freeze(module.exports);
