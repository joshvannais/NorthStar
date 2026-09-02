'use strict';

const fs = require('fs');
const path = require('path');

const {
  MESSAGE_REQUEST_SCHEMA,
  buildContextResponse,
  validateMessageRequest,
} = require('../../src/polaris/assistantContract');
const {
  boundedInterceptedResponse,
  executeIntercepted,
} = require('../../src/polaris/assistantRuntime');
const { createOpenAIRuntime } = require('../../src/polaris/openaiRuntime');
const professionalTextPolicy = require('../../public/js/polaris-professional-text');
const cardRenderer = require('../../public/js/polaris-native-card');

const ORG = 'd1000000-0000-4000-8000-000000000001';
const USER = 'd2000000-0000-4000-8000-000000000001';
const CUSTOMER = 'd3000000-0000-4000-8000-000000000001';
const LEAD = 'd4000000-0000-4000-8000-000000000001';
const GRAPH = 'd5000000-0000-4000-8000-000000000001';
const SNAPSHOT = 'd6000000-0000-4000-8000-000000000001';
const FACT = 'd7000000-0000-4000-8000-000000000001';
const KEY = 'd8000000-0000-4000-8000-000000000001';

const AUDITOR_EXACT_VARIANTS = Object.freeze([
  'Recommended action: SELECT customer_id;',
  'Recommended action: SELECT now();',
  'Recommended action: TRUNCATE customers;',
  'Please run python3 -c "x = 1" before the visit.',
  'Please run node --version before the visit.',
  'Please run node -e "1 + 1" before the visit.',
  'Please run npm ci before the visit.',
  'Please run git branch -a before the visit.',
  'Please execute whoami before continuing.',
  'Use ssh example.invalid before the visit.',
  'Please run ls --color=auto /tmp/private before the visit.',
  'The diagnostic requires printf private before dispatch.',
  'Please run cp /tmp/private /tmp/copy before the visit.',
  'Please enter calculateTotal(1); in the console.',
]);

const SYSTEMATIC_COMMAND_GRAMMAR = Object.freeze([
  // SQL scalar, query, complete data, schema, transaction, and privilege forms.
  ['SQL identifier scalar', 'Recommended action: SELECT customer_id;'],
  ['SQL function scalar', 'Recommended action: SELECT coalesce(total, 0);'],
  ['SQL aggregate scalar', 'Recommended action: SELECT count(*) AS total;'],
  ['SQL labeled plain scalar', 'Recommended action: SELECT total;'],
  ['SQL wildcard scalar', 'Recommended action: SELECT *;'],
  ['SQL query', 'Before continuing, SELECT customer_id, total FROM invoices WHERE total > 0;'],
  ['SQL insert', "Recommended action: INSERT INTO customers(name) VALUES ('private');"],
  ['SQL insert from query', 'Recommended action: INSERT INTO archive SELECT * FROM customers;'],
  ['SQL merge', 'Recommended action: MERGE INTO customers USING updates ON customers.id = updates.id;'],
  ['SQL update', 'Recommended action: UPDATE customers SET active = false WHERE customer_id = 7;'],
  ['SQL delete', 'Recommended action: DELETE FROM customers WHERE customer_id = 7;'],
  ['SQL truncate', 'Recommended action: TRUNCATE TABLE customers;'],
  ['SQL truncate without TABLE', 'Recommended action: TRUNCATE customers;'],
  ['SQL create', 'Recommended action: CREATE TABLE private_jobs(id integer);'],
  ['SQL alter', 'Recommended action: ALTER TABLE customers ADD COLUMN private text;'],
  ['SQL drop', 'Recommended action: DROP VIEW private_jobs;'],
  ['SQL materialized view', 'Recommended action: CREATE MATERIALIZED VIEW private_jobs AS SELECT 1;'],
  ['SQL comment', "Recommended action: COMMENT ON TABLE customers IS 'private';"],
  ['SQL explain', 'Recommended action: EXPLAIN ANALYZE SELECT * FROM customers;'],
  ['SQL grant', 'Recommended action: GRANT SELECT ON customers TO hidden_user;'],
  ['SQL revoke', 'Recommended action: REVOKE UPDATE ON customers FROM hidden_user;'],
  ['SQL transaction', 'Recommended action: BEGIN; DELETE FROM customers; COMMIT;'],
  ['SQL stored call', 'Recommended action: CALL refresh_private_cache();'],
  ['SQL stored execute', 'Recommended action: EXEC sp_private;'],
  ['SQL vacuum', 'Recommended action: VACUUM customers;'],
  ['SQL analyze', 'Recommended action: ANALYZE customers;'],
  ['SQL copy', "Recommended action: COPY customers TO '/tmp/private';"],
  ['SQL CTE', 'Recommended action: WITH private_rows AS (SELECT 1) SELECT * FROM private_rows;'],

  // Interpreter inline/eval/module/version and script forms.
  ['Python inline', 'Please run python3 -c "print(1)" before continuing.'],
  ['Python module', 'Please run python -m http.server before continuing.'],
  ['Python script', 'Please run python private_script.py before continuing.'],
  ['Node inline', 'Please run node --eval "process.exit()" before continuing.'],
  ['Node short inline', 'Please run node -e "1 + 1" before continuing.'],
  ['Node print', 'Please run node --print "1 + 1" before continuing.'],
  ['Node version', 'Please run node --version before continuing.'],
  ['Node executable suffix', 'Please run node.exe --version before continuing.'],
  ['Ruby inline', 'Please run ruby -e "puts 1" before continuing.'],
  ['Perl inline', 'Please run perl -e "print 1" before continuing.'],
  ['PHP inline', 'Please run php -r "echo 1;" before continuing.'],
  ['Deno eval', 'Please run deno eval "console.log(1)" before continuing.'],

  // Package lifecycle and install authorities.
  ['npm clean install', 'Run npm ci before continuing.'],
  ['npm command suffix', 'Run npm.cmd ci before continuing.'],
  ['npm install', 'Run npm install private-package before continuing.'],
  ['npm uninstall', 'Run npm uninstall private-package before continuing.'],
  ['npm lifecycle', 'Run npm start before continuing.'],
  ['npx exec', 'Run npx private-tool --flag before continuing.'],
  ['pnpm add', 'Run pnpm add private-package before continuing.'],
  ['yarn remove', 'Run yarn remove private-package before continuing.'],
  ['bun install', 'Run bun install before continuing.'],
  ['pip install', 'Run pip3 install private-package before continuing.'],
  ['gem install', 'Run gem install private-package before continuing.'],
  ['cargo install', 'Run cargo install private-package before continuing.'],

  // Git read, write, administrative, and plumbing variants.
  ['Git branch read', 'Run git branch -a for review.'],
  ['Git executable suffix', 'Run git.exe branch -a for review.'],
  ['Git remote read', 'Run git remote -v for review.'],
  ['Git config read', 'Run git config --list for review.'],
  ['Git worktree admin', 'Run git worktree add /tmp/private hidden-branch.'],
  ['Git tag admin', 'Run git tag private-tag before continuing.'],
  ['Git rebase write', 'Run git rebase main before continuing.'],
  ['Git merge write', 'Run git merge hidden-branch before continuing.'],
  ['Git update-ref plumbing', 'Run git update-ref refs/heads/private HEAD.'],
  ['Git cat-file plumbing', 'Run git cat-file -p HEAD before continuing.'],
  ['Git fsck admin', 'Run git fsck --full before continuing.'],

  // POSIX shell builtins/utilities with paths, flags, pipes, and redirection.
  ['identity zero arg', 'Please run whoami.'],
  ['absolute POSIX command path', 'Please run /usr/bin/whoami before continuing.'],
  ['identity flags', 'Please run id -u before continuing.'],
  ['listing long flag', 'Please run ls --color=auto /tmp/private before continuing.'],
  ['printf args', 'The diagnostic requires printf private before dispatch.'],
  ['copy paths', 'Please run cp /tmp/private /tmp/copy before continuing.'],
  ['move paths', 'Please run mv /tmp/private /tmp/copy before continuing.'],
  ['permission', 'Please run chmod 600 /tmp/private before continuing.'],
  ['ownership', 'Please run chown owner:staff /tmp/private before continuing.'],
  ['process list', 'Please run ps aux before continuing.'],
  ['process signal', 'Please run kill -9 123 before continuing.'],
  ['environment', 'Please run printenv PRIVATE_VALUE before continuing.'],
  ['filesystem create', 'Please run mkdir -p /tmp/private before continuing.'],
  ['archive', 'Please run tar -czf private.tgz /tmp/private before continuing.'],
  ['POSIX data copy', 'Please run dd if=/tmp/private of=/tmp/copy before continuing.'],
  ['build utility', 'Please run make install before continuing.'],
  ['CMake utility', 'Please run cmake --build /tmp/private before continuing.'],
  ['unlisted utility with flag', 'Please run jq -r .private before continuing.'],
  ['unlisted utility with path', 'Please run sha256sum /tmp/private before continuing.'],
  ['unlisted utility with assignment', 'Please run private-tool mode=hidden before continuing.'],
  ['unlisted utility in a labeled fragment', 'Recommended action: private-tool --inspect /tmp/private.'],
  ['unlisted utility in a parenthetical fragment', 'The diagnostic (private-tool /inspect) must complete first.'],
  ['unlisted utility with explicit command label', 'Use the command private-tool safely.'],
  ['common zero-argument utility', 'Please run uptime before continuing.'],
  ['common package utility', 'Please run apt-get update before continuing.'],
  ['common checksum utility', 'Please run sha256sum before continuing.'],
  ['relative shell script', 'Please run ./private.sh before continuing.'],
  ['parent Python script', 'Please run ../private.py before continuing.'],
  ['pipe', 'Please run cat /tmp/private | grep hidden before continuing.'],
  ['redirection', 'Please run echo private > /tmp/private before continuing.'],
  ['command substitution', 'Please run echo $(whoami) before continuing.'],
  ['shell navigation', 'Please run cd before continuing.'],
  ['command lookup', 'Please run which node before continuing.'],
  ['shell history', 'Please run history before continuing.'],
  ['shell process lookup', 'Please run pgrep node before continuing.'],
  ['shell text sort', 'Please run sort records.txt before continuing.'],
  ['shell text cut', 'Please run cut customers.csv before continuing.'],
  ['shell memory status', 'Please run free before continuing.'],
  ['shell identity list', 'Please run who before continuing.'],
  ['shell login history', 'Please run last before continuing.'],
  ['shell access control read', 'Please run getfacl private.txt before continuing.'],
  ['shell account creation', 'Please run useradd hidden before continuing.'],
  ['shell block device list', 'Please run lsblk before continuing.'],

  // Windows builtins and administrative utilities.
  ['Windows directory', 'Please run dir C:\\private before continuing.'],
  ['Windows copy', 'Please run copy C:\\private C:\\copy before continuing.'],
  ['Windows process', 'Please run tasklist /v before continuing.'],
  ['Windows process kill', 'Please run taskkill /pid 123 /f before continuing.'],
  ['Windows network', 'Please run ipconfig /all before continuing.'],
  ['Windows registry', 'Please run reg query HKCU\\Software before continuing.'],
  ['Windows service', 'Please run sc query northstar before continuing.'],
  ['Windows scheduler', 'Please run schtasks /query before continuing.'],
  ['Windows certificate', 'Please run certutil -hashfile C:\\private SHA256 before continuing.'],
  ['Windows absolute executable', 'Recommended action: C:\\Windows\\System32\\whoami.exe.'],
  ['Windows start', 'Please run start private.exe before continuing.'],
  ['Windows net', 'Please run net user before continuing.'],
  ['Windows event log', 'Please run wevtutil qe System before continuing.'],
  ['Windows installer', 'Please run msiexec /i private.msi before continuing.'],
  ['Windows DLL loader', 'Please run rundll32 private.dll,Entry before continuing.'],
  ['PowerShell call operator', 'Please run & .\\private.ps1 before continuing.'],
  ['Windows version builtin', 'Please run ver before continuing.'],
  ['Windows text search', 'Please run findstr private customers.txt before continuing.'],
  ['Windows network shell', 'Please run netsh interface show interface before continuing.'],
  ['Windows user session list', 'Please run quser before continuing.'],

  // Remote/network commands, including host-only forms.
  ['SSH host only', 'Use ssh example.invalid before the visit.'],
  ['SSH user host', 'Use ssh owner@example.invalid before the visit.'],
  ['SCP remote', 'Use scp /tmp/private owner@example.invalid:/tmp/private before the visit.'],
  ['SFTP host', 'Use sftp example.invalid before the visit.'],
  ['Rsync remote', 'Use rsync /tmp/private example.invalid:/tmp/private before the visit.'],
  ['Curl host', 'Use curl example.invalid/private before the visit.'],
  ['Wget host', 'Use wget example.invalid/private before the visit.'],
  ['Ping host', 'Use ping -c 1 example.invalid before the visit.'],
  ['DNS lookup', 'Use nslookup example.invalid before the visit.'],
  ['Socket list', 'Use netstat -an before the visit.'],

  // Additional language, database, package, infrastructure, and cloud command families.
  ['R script interpreter', 'Please run Rscript analysis.R before continuing.'],
  ['Lua interpreter', 'Please run lua private.lua before continuing.'],
  ['Julia interpreter', 'Please run julia private.jl before continuing.'],
  ['Java compiler', 'Please run javac Main.java before continuing.'],
  ['C compiler', 'Please run gcc main.c before continuing.'],
  ['Rust compiler', 'Please run rustc main.rs before continuing.'],
  ['PostgreSQL client', 'Please run psql private_db before continuing.'],
  ['MySQL client', 'Please run mysql private_db before continuing.'],
  ['SQLite client', 'Please run sqlite3 private.db before continuing.'],
  ['Redis client', 'Please run redis-cli FLUSHALL before continuing.'],
  ['Mongo shell', 'Please run mongosh private_db before continuing.'],
  ['Maven lifecycle', 'Please run mvn test before continuing.'],
  ['Gradle lifecycle', 'Please run gradle build before continuing.'],
  ['Poetry lifecycle', 'Please run poetry install before continuing.'],
  ['uv lifecycle', 'Please run uv sync before continuing.'],
  ['Conda lifecycle', 'Please run conda list before continuing.'],
  ['Terraform infrastructure', 'Please run terraform apply before continuing.'],
  ['OpenTofu infrastructure', 'Please run tofu plan before continuing.'],
  ['Ansible playbook', 'Please run ansible-playbook private.yml before continuing.'],
  ['Packer image build', 'Please run packer build private.pkr.hcl before continuing.'],
  ['Vagrant machine control', 'Please run vagrant up before continuing.'],
  ['AWS cloud CLI', 'Please run aws s3 cp private remote before continuing.'],
  ['Azure cloud CLI', 'Please run az account show before continuing.'],
  ['Google Cloud CLI', 'Please run gcloud auth list before continuing.'],

  // General executable source forms embedded in professional-looking prose.
  ['bare call statement', 'Please enter calculateTotal(1); in the console.'],
  ['cued bare call without semicolon', 'Please enter calculateTotal(1) in the console.'],
  ['use-cued bare call without semicolon', 'Please use calculateTotal(1) for this response.'],
  ['embedded camel-case call without semicolon', 'The proposed step is calculateTotal(1) before continuing.'],
  ['embedded dotted call without semicolon', 'The proposed step is private.cache.clear() before continuing.'],
  ['embedded snake-case call without semicolon', 'The proposed step is calculate_total(1) before continuing.'],
  ['dotted call statement', 'Recommended action: private.cache.clear();'],
  ['constructor assignment', 'Recommended action: result = new HiddenClient();'],
  ['JavaScript declaration', 'Recommended action: const privateValue = 1;'],
  ['Python declaration', 'Recommended action: def private_value(): return 1'],
]);

const PROFESSIONAL_PREFIXES = Object.freeze([
  'Recommended action: ',
  'Please run ',
  'Before continuing, execute ',
  'The diagnostic requires ',
  'For the appointment, use ',
]);

const PROFESSIONAL_SUFFIXES = Object.freeze([
  '',
  ' before continuing.',
  ' and then notify the customer.',
]);

const METAMORPHIC_COMMANDS = Object.freeze([
  'SELECT customer_id;',
  'TRUNCATE customers;',
  'python3 -c "print(1)"',
  'node -e "1 + 1"',
  'npm ci',
  'git branch -a',
  'whoami',
  'ssh example.invalid',
  'ls --color=auto /tmp/private',
  'printf private',
  'cp /tmp/private /tmp/copy',
  'calculateTotal(1);',
]);

const ORDINARY_BUSINESS_PROSE = Object.freeze([
  'Run a diagnostic inspection before dispatch.',
  'Select a time for the service visit.',
  'The branch office is open until 5:00 PM.',
  'The node in the workflow is approved.',
  'Review the package options with the customer.',
  'The customer asked us to copy the estimate details into the approved worksheet.',
  'Move the appointment to September 15, 2026 at 3:30 PM.',
  'The HVAC, CRM, SMS, and API services are described in the customer record.',
  'The customer\'s approved total is $1,250.00, with 18% markup and Net 30 terms.',
  'Use the west branch office for the installation team.',
  'Use the curl pattern requested for the decorative railing.',
  'Use the Command Center to review the customer record.',
  'Use more insulation around the repaired duct.',
  'Use the file name supplied by the customer.',
  'Run a split test on the approved marketing message.',
  'Type more details into the customer note.',
  'Use the patch material listed in the estimate.',
  'Use the route map approved for the service team.',
  'Run a detailed diagnostic inspection before dispatch.',
  'The private tool allowance is listed in the estimate.',
  'The tool is affordable and approved for the team.',
  'The program is available to the owner.',
  'The script is part of the customer call summary.',
  'Call Mike (owner) before arrival.',
]);

const FINAL_AUDIT_UNSAFE = Object.freeze([
  ['SQL arithmetic scalar', 'Recommended action: SELECT 1+1;'],
  ['SQL comment delimiter', 'Recommended action: SELECT/**/1;'],
  ['SQL truncate comment delimiter', 'Recommended action: TRUNCATE/**/customers;'],
  ['SQL drop comment delimiter', 'Recommended action: DROP/**/TABLE customers;'],
  ['SQL show', 'Recommended action: SHOW TABLES;'],
  ['SQL describe', 'Recommended action: DESCRIBE customers;'],
  ['SQL pragma', 'Recommended action: PRAGMA integrity_check;'],
  ['SQL use database', 'Recommended action: USE private_db;'],
  ['SQL attach', "Recommended action: ATTACH DATABASE 'private.db' AS hidden;"],
  ['GitHub CLI', 'Please run gh pr view 157 before continuing.'],
  ['GitHub CLI exe', 'Please run gh.exe auth status before continuing.'],
  ['Windows package manager', 'Please run winget install private-tool before continuing.'],
  ['Chocolatey package manager', 'Please run choco install private-tool before continuing.'],
  ['Scoop package manager', 'Please run scoop install private-tool before continuing.'],
  ['Python launcher', 'Please run py -c "print(1)" before continuing.'],
  ['pipx package manager', 'Please run pipx install private-tool before continuing.'],
  ['NuGet package manager', 'Please run nuget restore before continuing.'],
  ['MSBuild', 'Please run msbuild private.sln before continuing.'],
  ['certificate utility plain subcommand', 'Please run certbot renew before continuing.'],
  ['shell eval builtin', 'Please run eval true before continuing.'],
  ['shell exec builtin', 'Please run exec whoami before continuing.'],
  ['doas privilege utility', 'Please run doas whoami before continuing.'],
  ['PowerShell call operator', 'Please run & whoami before continuing.'],
  ['bare command substitution', 'Recommended action: $(whoami)'],
  ['Windows environment path', 'Recommended action: %TEMP%\\private.cmd /silent'],
  ['PowerShell environment path', 'Recommended action: $env:TEMP\\private.ps1 -Quiet'],
  ['macOS launch utility', 'Please run launchctl list before continuing.'],
  ['macOS defaults utility', 'Please run defaults read com.example.private before continuing.'],
  ['macOS system profiler', 'Please run system_profiler SPHardwareDataType before continuing.'],
  ['source builtin without slash', 'Suggested shell step: source private.env'],
  ['shell line continuation', 'Please run w\\\nhoami before continuing.'],
  ['cmd caret escaping', 'Please run who^ami before continuing.'],
  ['PowerShell backtick escaping', 'Please run wh`oami before continuing.'],
  ['shell quote concatenation', "Please run 'who'ami before continuing."],
  ['U+115F invisible split', 'Please run py\u115fthon3 -c "print(1)" before continuing.'],
  ['U+1160 invisible split', 'Please run py\u1160thon3 -c "print(1)" before continuing.'],
  ['U+3164 NFKC invisible split', 'Please run py\u3164thon3 -c "print(1)" before continuing.'],
  ['combining-mark split', 'Please run py\u0337thon3 -c "print(1)" before continuing.'],
]);

const FINAL_AUDIT_PROFESSIONAL = Object.freeze([
  ['ordinary diagnostic', 'Run a diagnostic inspection before dispatch.'],
  ['customer scope', 'Replace the damaged condenser fan and test normal operation.'],
  ['product terminology', 'The HVAC, CRM, SMS, and API notes are ready for review.'],
  ['money terms', "The customer's approved total is $1,250.00, with 18% markup and Net 30 terms."],
  ['date time', 'Move the appointment to September 15, 2026 at 3:30 PM.'],
  ['punctuation contractions', "The customer's unit isn't cooling; call before arrival."],
  ['ordinary selection', 'Select Tuesday from availability.'],
  ['parts selection', 'Select HVAC from inventory.'],
  ['ordinary authorization prose', 'Grant access on Monday to Alex.'],
  ['ordinary revocation prose', 'Revoke access on Friday from Jordan.'],
  ['technical requirement', 'The diagnostic requires Java compatibility with the control panel.'],
  ['customer material finish', 'The customer requires Ruby finish on the cabinet.'],
  ['equipment description', 'Required node replacement is scheduled for Friday.'],
  ['ordinary package selection', 'Choose the standard maintenance package for Tuesday.'],
  ['authorized integration prose', 'The API records the CRM selection after an authorized SMS response.'],
  ['ordinary equipment node', 'The HVAC diagnostic describes a node in the equipment map.'],
  ['access scheduling', 'The customer requested access between 8:00 AM and 10:30 AM on September 15, 2026.'],
  ['Java equipment compatibility', 'The Java-compatible control board costs $1,250.00 plus 18%, due Net 30.'],
  ['Ruby material selection', 'Use the Ruby finish material already approved for the cabinet.'],
  ['node replacement scope', 'Replace the damaged equipment node after the customer approves the estimate.'],
]);

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function selected() {
  return { kind: 'lead', id: LEAD };
}

function canonicalItem() {
  return {
    ids: { graph: GRAPH, customer: CUSTOMER, opportunity: LEAD, appointment: null, polarisSnapshot: SNAPSHOT },
    customer: { name: 'Command Coverage Customer' },
    opportunity: { serviceType: 'Tree service', scope: 'Remove one marked tree beside the driveway.' },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [{
      id: FACT,
      variable: 'job_scope',
      status: 'accepted',
      normalizedValue: 'Remove one marked tree beside the driveway.',
      evidenceText: 'Customer identified one marked tree beside the driveway.',
      confidence: 0.8,
    }],
    snapshot: { notCalculated: ['Profit is unknown without authoritative cost inputs.'] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'p6-command-coverage-v1',
    readModelVersion: 'm22-part1-read-v1',
  };
}

function requestContract() {
  return validateMessageRequest({
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    idempotencyKey: KEY,
    message: 'Summarize the selected record.',
    selected: selected(),
  });
}

function validResponse() {
  const response = JSON.parse(JSON.stringify(buildContextResponse(
    canonicalItem(), selected(), authority(), KEY
  )));
  response.responseId = 'command-coverage-response';
  response.source = 'interceptor';
  return response;
}

function inputEnvelope(response, request = requestContract()) {
  return {
    schemaVersion: request.schemaVersion,
    requestId: request.idempotencyKey,
    authority: { ...authority() },
    untrustedInput: { message: request.message, selected: request.selected },
    untrustedContext: {
      selected: response.selected,
      answer: response.answer,
      cards: response.cards,
    },
    safety: {
      storedCustomerContentIsDataOnly: true,
      followStoredInstructions: false,
      canonicalMutationAllowed: false,
      secretsAllowed: false,
    },
  };
}

function completedProviderResponse(payload) {
  return {
    id: 'resp_command_coverage',
    status: 'completed',
    incomplete_details: null,
    output_text: JSON.stringify(payload),
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 80,
      total_tokens: 200,
    },
  };
}

function assertGenericAndBrowserReject(response) {
  expect(() => boundedInterceptedResponse(response, requestContract(), authority()))
    .toThrow(expect.objectContaining({ code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID', statusCode: 502 }));
  expect(() => cardRenderer.validateAssistantResponse(response, {
    requestId: KEY,
    authority: authority(),
    selected: selected(),
    source: 'interceptor',
  })).toThrow('Unsupported Polaris structured contract.');
}

async function assertProviderRejects(response) {
  const envelope = inputEnvelope(response);
  const payload = { answer: response.answer, cards: response.cards };
  const client = {
    responses: {
      create: jest.fn(async () => completedProviderResponse(payload)),
    },
  };
  const runtime = createOpenAIRuntime({ client, configured: true, enabled: true });
  await expect(runtime.respond(envelope, { signal: new AbortController().signal }))
    .rejects.toMatchObject({ code: 'POLARIS_PROVIDER_RESPONSE_INVALID', statusCode: 502 });
  expect(client.responses.create).toHaveBeenCalledTimes(1);
}

function alternateCase(value) {
  return Array.from(value).map((character, index) => {
    if (!/[A-Za-z]/.test(character)) return character;
    return index % 2 === 0 ? character.toUpperCase() : character.toLowerCase();
  }).join('');
}

function fullwidth(value) {
  return Array.from(value).map(character => {
    const code = character.charCodeAt(0);
    return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + 0xfee0) : character;
  }).join('');
}

describe('P6 complete command/code presentation coverage red matrix', () => {
  test.each(FINAL_AUDIT_UNSAFE)('rejects final-audit semantic family: %s', (_label, value) => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    expect(() => cardRenderer.validateProfessionalText(value))
      .toThrow('Unsupported Polaris structured contract.');
  });

  test.each(FINAL_AUDIT_PROFESSIONAL)('accepts final-audit professional control: %s', (_label, value) => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(true);
    expect(cardRenderer.validateProfessionalText(value)).toBe(value);
    const response = validResponse();
    response.answer.text = value;
    response.cards[0].answer = value;
    expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
    expect(cardRenderer.validateAssistantResponse(response)).toBe(response);
  });

  test.each([
    ['response answer text', response => { response.answer.text = 'Please run gh pr view 157 before continuing.'; }],
    ['card title', response => { response.cards[0].title = 'Please run gh pr view 157 before continuing.'; }],
    ['card subtitle', response => { response.cards[0].subtitle = 'Please run gh pr view 157 before continuing.'; }],
    ['card answer', response => { response.cards[0].answer = 'Please run gh pr view 157 before continuing.'; }],
    ['evidence label', response => { response.cards[0].evidence[0].label = 'Please run gh pr view 157 before continuing.'; }],
    ['evidence value', response => { response.cards[0].evidence[0].value = 'Please run gh pr view 157 before continuing.'; }],
    ['unknown label', response => { response.cards[0].unknowns[0].label = 'Please run gh pr view 157 before continuing.'; }],
    ['confidence basis', response => { response.cards[0].confidence.basis = 'Please run gh pr view 157 before continuing.'; }],
  ])('final-audit bypass fails the complete server/browser/provider response at %s', async (_label, place) => {
    const response = validResponse();
    place(response);
    assertGenericAndBrowserReject(response);
    await assertProviderRejects(response);
  });

  test('final-audit bypass in later arrays and cards rejects the whole response', async () => {
    const placements = [
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0]));
        second.answer = 'Recommended action: SELECT/**/1;';
        response.cards.push(second);
        response.answer.evidenceCount += second.evidence.length;
        response.answer.unknownCount += second.unknowns.length;
      },
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0].evidence[0]));
        second.id = 'final-audit-evidence';
        second.source.id = 'final-audit-evidence';
        second.value = 'Recommended action: %TEMP%\\private.cmd /silent';
        response.cards[0].evidence.push(second);
        response.answer.evidenceCount += 1;
      },
      response => {
        response.cards[0].unknowns.push({
          code: 'final_audit_unknown',
          label: 'Please run winget install private-tool before continuing.',
        });
        response.answer.unknownCount += 1;
      },
    ];
    for (const place of placements) {
      const response = validResponse();
      place(response);
      assertGenericAndBrowserReject(response);
      await assertProviderRejects(response);
    }
  });

  test('migration 037 derives both monthly authority keys explicitly in UTC', () => {
    const migration = fs.readFileSync(path.join(
      __dirname, '..', '..', 'migrations', '037_polaris_provider_usage_authority.sql'
    ), 'utf8');
    expect(migration.match(
      /current_month DATE := date_trunc\('month', clock_timestamp\(\) AT TIME ZONE 'UTC'\)::date;/g
    )).toHaveLength(2);
    expect(migration).not.toContain("date_trunc('month', clock_timestamp())::date");
  });

  test.each(AUDITOR_EXACT_VARIANTS)('rejects exact independently audited bypass: %s', value => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
  });

  test.each(SYSTEMATIC_COMMAND_GRAMMAR)('rejects systematic %s grammar', (_label, value) => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    expect(() => cardRenderer.validateProfessionalText(value))
      .toThrow('Unsupported Polaris structured contract.');
  });

  test.each(SYSTEMATIC_COMMAND_GRAMMAR)(
    'professional prose, case, NFKC, and whitespace cannot launder systematic %s grammar', (_label, value) => {
      const variants = [
        `Professional customer summary: ${value} Please continue with the appointment.`,
        alternateCase(value),
        fullwidth(value),
        value.replace(/ /g, '\t  '),
      ];
      expect(variants.filter(candidate => professionalTextPolicy.isProfessionalText(candidate))).toEqual([]);
    }
  );

  test.each(PROFESSIONAL_PREFIXES.flatMap(prefix =>
    METAMORPHIC_COMMANDS.flatMap(command =>
      PROFESSIONAL_SUFFIXES.map(suffix => [prefix, command, suffix])
    )
  ))('professional wrapper cannot launder concrete command: %s%s%s', (prefix, command, suffix) => {
    expect(professionalTextPolicy.isProfessionalText(`${prefix}${command}${suffix}`)).toBe(false);
  });

  test.each(METAMORPHIC_COMMANDS)(
    'case, whitespace, delimiter, NFKC, and invisible-format transforms remain rejected: %s', command => {
      const tokenEnd = command.search(/[\s;(]/);
      const splitAt = Math.max(1, tokenEnd > 1 ? Math.floor(tokenEnd / 2) : 1);
      const variants = [
        `Recommended action: ${alternateCase(command)}`,
        `Recommended action:\n\t${command.replace(/ /g, '\t  ')}`,
        `The diagnostic (${command}) must complete before dispatch.`,
        `Recommended action: ${fullwidth(command)}`,
        `Recommended action: ${command.slice(0, splitAt)}\ufe0f${command.slice(splitAt)}`,
        `Recommended action: ${command.slice(0, splitAt)}\u180b${command.slice(splitAt)}`,
        `Recommended action: ${command.slice(0, splitAt)}\u{e0100}${command.slice(splitAt)}`,
      ];
      expect(variants.filter(value => professionalTextPolicy.isProfessionalText(value))).toEqual([]);
    }
  );

  test.each([
    ['response answer text', response => { response.answer.text = 'Recommended action: SELECT customer_id;'; }],
    ['card title', response => { response.cards[0].title = 'Run npm ci before continuing.'; }],
    ['card subtitle', response => { response.cards[0].subtitle = 'Run git branch -a for review.'; }],
    ['card answer', response => { response.cards[0].answer = 'Please execute whoami before continuing.'; }],
    ['evidence label', response => { response.cards[0].evidence[0].label = 'Use ssh example.invalid before the visit.'; }],
    ['evidence value', response => { response.cards[0].evidence[0].value = 'Please run cp /tmp/private /tmp/copy.'; }],
    ['unknown label', response => { response.cards[0].unknowns[0].label = 'Please run python3 -c "print(1)".'; }],
    ['confidence basis', response => { response.cards[0].confidence.basis = 'Please enter calculateTotal(1); in the console.'; }],
  ])('provider, generic interceptor, server, and browser reject %s before presentation', async (_label, place) => {
    const response = validResponse();
    place(response);
    assertGenericAndBrowserReject(response);
    await assertProviderRejects(response);
  });

  test('later card and array placements reject the entire response with no safe partial subset', async () => {
    const placements = [
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0]));
        second.answer = 'Recommended action: TRUNCATE customers;';
        response.cards.push(second);
        response.answer.evidenceCount += second.evidence.length;
        response.answer.unknownCount += second.unknowns.length;
      },
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0].evidence[0]));
        second.id = 'second-evidence';
        second.source.id = 'second-evidence';
        second.value = 'Please run node -e "1 + 1" before continuing.';
        response.cards[0].evidence.push(second);
        response.answer.evidenceCount += 1;
      },
      response => {
        response.cards[0].unknowns.push({ code: 'second_unknown', label: 'Run npm ci before continuing.' });
        response.answer.unknownCount += 1;
      },
    ];
    for (const place of placements) {
      const response = validResponse();
      place(response);
      assertGenericAndBrowserReject(response);
      await assertProviderRejects(response);
    }
  });

  test('generic intercepted execution returns only the existing safe failure and no unsafe response', async () => {
    const response = validResponse();
    response.cards[0].answer = 'Please run npm ci before continuing.';
    const runtime = {
      kind: 'interceptor',
      status: async () => ({ state: 'available' }),
      respond: jest.fn(async () => response),
    };
    await expect(executeIntercepted(
      runtime,
      requestContract(),
      authority(),
      buildContextResponse(canonicalItem(), selected(), authority(), KEY)
    )).rejects.toMatchObject({
      code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID',
      statusCode: 502,
      message: 'Intercepted runtime returned an invalid assistant response.',
    });
    expect(runtime.respond).toHaveBeenCalledTimes(1);
  });

  test.each(ORDINARY_BUSINESS_PROSE)('preserves ordinary professional business prose: %s', value => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(true);
    expect(cardRenderer.validateProfessionalText(value)).toBe(value);
    const response = validResponse();
    response.answer.text = value;
    response.cards[0].answer = value;
    expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
    expect(cardRenderer.validateAssistantResponse(response)).toBe(response);
  });
});
