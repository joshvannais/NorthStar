'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const launcher = path.join(ROOT, 'scripts/production-launcher.js');
const productionStart = path.join(ROOT, 'scripts/start-production.sh');
const productionPrepare = path.join(ROOT, 'scripts/prepare-production-node.sh');
const runtimeManifestPath = path.join(ROOT, 'scripts/node-v22.23.3-runtime-manifest.txt');
const dockerfilePath = path.join(ROOT, 'Dockerfile');
const railwayConfigPath = path.join(ROOT, 'railway.toml');
const dockerIgnorePath = path.join(ROOT, '.dockerignore');
const localStart = path.join(ROOT, 'scripts/start-verified-local.ps1');
const systemPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const childEntry = path.join(ROOT, 'src/productionChild.js');
const server = path.join(ROOT, 'src/server.js');
const LOCAL_NODE_SHA256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e';
const node22 = process.env.M27_NODE22_EXECUTABLE ||
  (process.version === 'v22.23.3' ? process.execPath : null);
const canonicalRuntime = node22 && fs.existsSync(node22) ? describe : describe.skip;
const PINNED_DOCKER_INDEX =
  'c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392';
const PINNED_NODE_SHA256 = Object.freeze({
  amd64: 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48',
  arm64: 'd09e299258c24f7cdf6f5d5ec185e3a56512b27a697113735dac909f1cac7b8d',
});
const PINNED_NODE_ELF_HEADER = Object.freeze({
  amd64: '7f454c4602010103000000000000000002003e00',
  arm64: '7f454c460201010300000000000000000200b700',
});
const PINNED_TOOL_IDENTITY = Object.freeze({
  amd64: Object.freeze({
    setpriv: Object.freeze({ size: 80192,
      sha256: 'd5839b20edb0d77222b1e11be7d155c7122d381dbfad40876b0def7dd710f5bd' }),
    getcap: Object.freeze({ size: 14576,
      sha256: '815e0a9db190b9f50e83a9443daa368c705bf466142521b12b4770bf7f69f579' }),
  }),
  arm64: Object.freeze({
    setpriv: Object.freeze({ size: 133288,
      sha256: '24410fedc29286402ae3b366bd3a78c3d177f7a1190797f1ea564f190097356c' }),
    getcap: Object.freeze({ size: 67672,
      sha256: 'dfd4546e0dbf6213e920622249d10e4469a4e41cfbdc62fd0da2472acffdd836' }),
  }),
});
const REMOVED_CAPABILITY_HELPERS = Object.freeze([
  '/usr/sbin/capsh', '/usr/sbin/getpcaps', '/usr/sbin/setcap',
]);
const PRIVILEGED_BASE_PATHS = Object.freeze([
  '/usr/bin/chfn', '/usr/bin/chsh', '/usr/bin/gpasswd', '/usr/bin/mount',
  '/usr/bin/newgrp', '/usr/bin/passwd', '/usr/bin/su', '/usr/bin/umount',
  '/usr/bin/chage', '/usr/bin/expiry', '/usr/sbin/unix_chkpwd',
]);
const RUNTIME_IDENTITY_PREDICATE =
  '[ "$saw_uid$saw_gid$saw_groups$saw_cap_inh$saw_cap_prm$saw_cap_eff$saw_cap_amb$saw_no_new_privs" = 11111111 ]';
const STARTUP_CHECKS = Object.freeze(Array.from({ length: 19 },
  (_value, index) => `NS14B-${String(index).padStart(2, '0')}`));

function runtimeIdentityFunction(source) {
  const start = source.indexOf('check_runtime_identity() {');
  const end = source.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('Runtime identity function is unavailable.');
  return source.slice(start, end + 3);
}

function startupDiagnosticFunction(source) {
  const start = source.indexOf("FAILURE='NorthStar production startup rejected the Node runtime.'");
  const end = source.indexOf('\n\ncheck_runtime_identity() {', start);
  if (start < 0 || end < 0) throw new Error('Startup diagnostic function is unavailable.');
  return source.slice(start, end + 1);
}

function runStartupDiagnosticUnderDash(source, check) {
  const functionSource = startupDiagnosticFunction(source).replace(/\r\n/g, '\n');
  const script = `${functionSource}\nstartup_check='${check}'\nfail\n`;
  if (process.platform === 'win32') {
    return childProcess.spawnSync('C:\\Windows\\System32\\wsl.exe',
      ['-e', '/bin/dash', '-c', script], { encoding: 'utf8', timeout: 120000 });
  }
  return childProcess.spawnSync('/bin/dash', ['-c', script],
    { encoding: 'utf8', timeout: 120000 });
}

function runManifestChecksumFailureUnderDash(source, check, manifestVariable) {
  const functionSource = startupDiagnosticFunction(source).replace(/\r\n/g, '\n');
  const verificationPattern = new RegExp(
    `^/usr/bin/sha256sum -c "\\$${manifestVariable}" >/dev/null 2>&1 \\|\\| fail$`, 'm');
  const verification = source.replace(/\r\n/g, '\n').match(verificationPattern);
  if (!verification) throw new Error(`Missing bounded ${manifestVariable} verifier.`);
  const script = `${functionSource}\n` +
    `temporary=$(/usr/bin/mktemp -d) || exit 97\n` +
    `trap '/bin/rm -rf "$temporary"' EXIT\n` +
    `${manifestVariable}="$temporary/checksums"\n` +
    `/usr/bin/printf '%064d  /private/customer@example.test/provider-token-secret\\n' 0 > ` +
    `"$${manifestVariable}"\n` +
    `startup_check='${check}'\n${verification[0]}\n`;
  if (process.platform === 'win32') {
    return childProcess.spawnSync('C:\\Windows\\System32\\wsl.exe',
      ['-e', '/bin/dash', '-c', script], { encoding: 'utf8', timeout: 120000 });
  }
  return childProcess.spawnSync('/bin/dash', ['-c', script],
    { encoding: 'utf8', timeout: 120000 });
}

function dashRuntimeAvailable() {
  if (process.platform === 'linux') {
    return typeof process.getuid === 'function' && process.getuid() === 0 &&
      fs.existsSync('/bin/dash') && fs.existsSync('/usr/bin/setpriv');
  }
  return process.platform === 'win32' && process.env.M27_WSL_DASH_EXECUTION === '1' &&
    fs.existsSync('C:\\Windows\\System32\\wsl.exe');
}

function runRuntimeIdentityUnderDash(source, expectSuccess, supplementaryGroups = '1000') {
  // The production Docker checkout is LF-only. Normalize the Windows Git
  // checkout so this execution gate exercises the same Debian dash bytes.
  const functionSource = runtimeIdentityFunction(source).replace(/\r\n/g, '\n');
  const script = expectSuccess
    ? `${functionSource}\ncheck_runtime_identity\nprintf 'runtime-identity-ok\\n'\n`
    : `${functionSource}\nif check_runtime_identity; then exit 91; fi\nexit 78\n`;
  const groupArgs = supplementaryGroups === null
    ? ['--clear-groups']
    : [`--groups=${supplementaryGroups}`];
  const args = ['--reuid=1000', '--regid=1000', ...groupArgs, '--no-new-privs', '--',
    '/bin/dash', '-c', script];
  if (process.platform === 'win32') {
    return childProcess.spawnSync('C:\\Windows\\System32\\wsl.exe',
      ['--user', 'root', '-e', '/usr/bin/setpriv', ...args],
      { encoding: 'utf8', timeout: 120000 });
  }
  return childProcess.spawnSync('/usr/bin/setpriv', args,
    { encoding: 'utf8', timeout: 120000 });
}

function exactRuntimePlan(overrides = {}) {
  const inputs = {
    dockerfile: fs.readFileSync(dockerfilePath, 'utf8'),
    railway: fs.readFileSync(railwayConfigPath, 'utf8'),
    ignore: fs.readFileSync(dockerIgnorePath, 'utf8'),
    manifest: fs.readFileSync(runtimeManifestPath, 'utf8'),
    prepare: fs.readFileSync(productionPrepare, 'utf8'),
    start: fs.readFileSync(productionStart, 'utf8'),
    ...overrides,
  };
  const expectedRailway = '[build]\nbuilder = "DOCKERFILE"\n' +
    'dockerfilePath = "Dockerfile"\n\n[deploy]\n' +
    'startCommand = "/usr/bin/setpriv --no-new-privs -- ' +
    '/bin/sh /app/scripts/start-production.sh"\n';
  if (inputs.railway !== expectedRailway || /NIXPACKS|RAILPACK/.test(inputs.railway)) {
    throw new Error('Unexpected Railway builder plan.');
  }
  const manifestLines = inputs.manifest.trimEnd().split('\n');
  const expectedManifestLines = [
    'node-version=22.23.3',
    'npm-version=10.9.9',
    'official-shasums-url=https://nodejs.org/dist/v22.23.3/SHASUMS256.txt',
    'official-shasums-sha256=4fe99a2ba9d552a6f51c13ed68fb11104cfa5df601aec616be689253a8139e7a',
    'linux-x64-archive-sha256=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de',
    `linux-x64-node-sha256=${PINNED_NODE_SHA256.amd64}`,
    'linux-arm64-archive-sha256=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f',
    `linux-arm64-node-sha256=${PINNED_NODE_SHA256.arm64}`,
    `docker-index-sha256=${PINNED_DOCKER_INDEX}`,
    'docker-linux-amd64-manifest-sha256=efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562',
    'docker-linux-arm64-manifest-sha256=b20fe038d9592822dd534600a1ddf467e985178aa3fed60ec441a056c2cc45bd',
    'docker-source-revision=81f419144a1251854c6d9afb09eaa39928e724e8',
    'runtime-setpriv-path=/usr/bin/setpriv',
    'runtime-getcap-path=/usr/sbin/getcap',
    `linux-amd64-setpriv-sha256=${PINNED_TOOL_IDENTITY.amd64.setpriv.sha256}`,
    `linux-amd64-setpriv-size=${PINNED_TOOL_IDENTITY.amd64.setpriv.size}`,
    `linux-amd64-getcap-sha256=${PINNED_TOOL_IDENTITY.amd64.getcap.sha256}`,
    `linux-amd64-getcap-size=${PINNED_TOOL_IDENTITY.amd64.getcap.size}`,
    `linux-arm64-setpriv-sha256=${PINNED_TOOL_IDENTITY.arm64.setpriv.sha256}`,
    `linux-arm64-setpriv-size=${PINNED_TOOL_IDENTITY.arm64.setpriv.size}`,
    `linux-arm64-getcap-sha256=${PINNED_TOOL_IDENTITY.arm64.getcap.sha256}`,
    `linux-arm64-getcap-size=${PINNED_TOOL_IDENTITY.arm64.getcap.size}`,
    'debian-libcap2-bin-version=1:2.66-4+deb12u3+b1',
    'removed-capability-helpers=/usr/sbin/capsh,/usr/sbin/getpcaps,/usr/sbin/setcap',
  ];
  if (JSON.stringify(manifestLines) !== JSON.stringify(expectedManifestLines)) {
    throw new Error('Unexpected Node runtime provenance manifest.');
  }
  const expectedFrom = `FROM node:22.23.3-bookworm-slim@sha256:${PINNED_DOCKER_INDEX} AS pinned-node`;
  if (inputs.dockerfile.split('\n').filter(line => line === expectedFrom).length !== 1 ||
      inputs.dockerfile.split('\n').filter(line => /^FROM /.test(line) &&
        !/^FROM pinned-node /.test(line)).length !== 1 ||
      /\b(?:curl|wget|tar|NIXPACKS_NODE_VERSION)\b/.test(inputs.dockerfile) ||
      !inputs.dockerfile.includes('ARG TARGETARCH') ||
      !inputs.dockerfile.includes(`amd64) expected='${PINNED_NODE_SHA256.amd64}'`) ||
      !inputs.dockerfile.includes(`arm64) expected='${PINNED_NODE_SHA256.arm64}'`) ||
      !inputs.dockerfile.includes(
        "*) echo 'Unsupported NorthStar production architecture.' >&2; exit 78 ;;") ||
      !inputs.dockerfile.includes('| /usr/bin/sha256sum -c -') ||
      !inputs.dockerfile.includes('ci --omit=dev --ignore-scripts --no-audit --no-fund') ||
      !inputs.dockerfile.includes('NORTHSTAR_TARGETARCH="$TARGETARCH"') ||
      !inputs.dockerfile.includes("test \"$(/usr/bin/id -u node)\" = '1000'") ||
      !inputs.dockerfile.includes("test \"$(/usr/bin/id -g node)\" = '1000'") ||
      !inputs.dockerfile.includes('/bin/chown -R 0:0 /app') ||
      !inputs.dockerfile.includes(
        "/usr/bin/find /app -xdev -type d -exec /bin/chmod 0555 '{}' +") ||
      !inputs.dockerfile.includes(
        "/usr/bin/find /app -xdev -type f -exec /bin/chmod 0444 '{}' +") ||
      !inputs.dockerfile.includes('NORTHSTAR_DATA_DIR=/var/lib/northstar/data') ||
      !inputs.dockerfile.includes('/bin/mkdir -p /var/lib/northstar/data ' +
        '/var/lib/northstar/tmp /var/lib/northstar/home') ||
      !inputs.dockerfile.includes('TMPDIR=/var/lib/northstar/tmp') ||
      !inputs.dockerfile.includes(
        'libcap2=1:2.66-4+deb12u3+b1 libcap2-bin=1:2.66-4+deb12u3+b1') ||
      !inputs.dockerfile.includes(
        "/usr/bin/find / -xdev -type f -perm /6000 -exec /bin/chmod a-s '{}' +") ||
      !inputs.dockerfile.includes('/usr/sbin/getcap -r / 2>/dev/null') ||
      !inputs.dockerfile.includes('/usr/sbin/setcap -r "$capability_path"') ||
      !inputs.dockerfile.includes('/bin/rm -f "$capability_inventory" /usr/sbin/setcap') ||
      !inputs.dockerfile.includes('/bin/rm -f /usr/sbin/capsh /usr/sbin/getpcaps') ||
      !inputs.dockerfile.includes('/bin/chmod 0555 /usr/bin/setpriv /usr/sbin/getcap') ||
      !inputs.dockerfile.includes("'northstar-privilege-inventory-v2'") ||
      !inputs.dockerfile.includes("'northstar-executable-inventory-v2'") ||
      !inputs.dockerfile.includes("'setpriv_nlink=1'") ||
      !inputs.dockerfile.includes("'getcap_nlink=1'") ||
      inputs.dockerfile.includes('/app/.northstar-runtime/setpriv.identity') ||
      inputs.dockerfile.includes('/app/.northstar-runtime/getcap.identity') ||
      inputs.dockerfile.includes('/bin/ln /usr/bin/setpriv') ||
      inputs.dockerfile.includes('/bin/ln /usr/sbin/getcap') ||
      !inputs.dockerfile.includes('/usr/bin/find /usr/lib -xdev') ||
      !PRIVILEGED_BASE_PATHS.every(value => inputs.dockerfile.includes(value)) ||
      !inputs.dockerfile.includes('USER 1000:1000') ||
      !inputs.dockerfile.includes(
        'CMD ["/usr/bin/setpriv", "--no-new-privs", "--", ' +
        '"/bin/sh", "/app/scripts/start-production.sh"]') ||
      /USER root/.test(inputs.dockerfile) ||
      /(?:^|[ ;])(?:node|npm|sha256sum)(?:[ ;]|$)/m.test(inputs.dockerfile)) {
    throw new Error('Unexpected Docker runtime plan.');
  }
  const privilegeScan = inputs.dockerfile.indexOf(
    'test -z "$(/usr/bin/find / -xdev -type f -perm /6000 -print -quit)"');
  const runtimeUser = inputs.dockerfile.indexOf('USER 1000:1000');
  if (privilegeScan < 0 || privilegeScan <= inputs.dockerfile.lastIndexOf('COPY ') ||
      runtimeUser <= privilegeScan ||
      /\n(?:ADD|COPY|RUN) /.test(inputs.dockerfile.slice(privilegeScan, runtimeUser))) {
    throw new Error('Privilege scan is not the final image mutation.');
  }
  if (!inputs.ignore.includes('.northstar-runtime/*') ||
      !inputs.ignore.includes('!.northstar-runtime/.gitignore') ||
      !inputs.ignore.includes('node_modules/**')) {
    throw new Error('Workspace runtime artifacts are not excluded.');
  }
  for (const [arch, digest] of Object.entries(PINNED_NODE_SHA256)) {
    if (!inputs.prepare.includes(digest) || !inputs.start.includes(digest)) {
      throw new Error(`Missing ${arch} executable binding.`);
    }
    for (const tool of ['setpriv', 'getcap']) {
      const identity = PINNED_TOOL_IDENTITY[arch][tool];
      if (!inputs.dockerfile.includes(identity.sha256) ||
          !inputs.dockerfile.includes(`'${identity.size}'`) ||
          !inputs.manifest.includes(identity.sha256) ||
          !inputs.start.includes(identity.sha256) ||
          !inputs.start.includes(`'${identity.size}'`)) {
        throw new Error(`Missing ${arch} ${tool} identity binding.`);
      }
    }
  }
  if (!inputs.prepare.includes('[ "$8" != \'03\' ]') ||
      !inputs.start.includes('[ "$8" != \'03\' ]')) {
    throw new Error('Missing pinned Linux ELF OSABI binding.');
  }
  if (!inputs.prepare.includes('/usr/bin/dpkg --print-architecture') ||
      !inputs.prepare.includes('/usr/bin/sha256sum -c -') ||
      !inputs.prepare.includes('/bin/chmod 0555 "$NODE_PATH"') ||
      !inputs.start.includes('[ "$node_path" != \'/usr/local/bin/node\' ]') ||
      !inputs.start.includes("NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY='official-docker-node-22.23.3-v1'") ||
      !inputs.start.includes('check_runtime_identity || fail') ||
      !inputs.start.includes(RUNTIME_IDENTITY_PREDICATE) ||
      !inputs.start.includes('if [ "$#" -eq 1 ]; then') ||
      !inputs.start.includes('elif [ "$#" -eq 2 ] && [ "$2" = 1000 ]; then') ||
      !inputs.start.includes("[ \"$2\" = 1000 ]") ||
      !inputs.start.includes("[ \"$2\" = 0000000000000000 ]") ||
      !inputs.start.includes("[ \"${NORTHSTAR_DATA_DIR-}\" != '/var/lib/northstar/data' ]") ||
      !inputs.start.includes("! -uid 0 -o ! -gid 0 -o -perm /022") ||
      !inputs.start.includes('[ "$2" = 1 ]') ||
      !inputs.start.includes('/usr/sbin/getcap -r /usr "$CANONICAL_ROOT"') ||
      !inputs.start.includes('/usr/bin/sha256sum -c "$privilege_sha_manifest"') ||
      !inputs.start.includes('/usr/bin/sha256sum -c "$executable_sha_manifest"') ||
      !inputs.start.includes('setpriv_path=/usr/bin/setpriv') ||
      !inputs.start.includes('getcap_path=/usr/sbin/getcap') ||
      !inputs.start.includes("!= '0:0:555:1'") ||
      inputs.start.includes('_identity_anchor=') ||
      inputs.start.includes('_build_device_inode=') ||
      !inputs.start.includes('/usr/sbin/capsh /usr/sbin/getpcaps /usr/sbin/setcap') ||
      !inputs.start.includes('LD_PRELOAD') || !inputs.start.includes('LD_LIBRARY_PATH') ||
      !inputs.start.includes('unsafe_runtime_library=$(/usr/bin/find /usr/lib -xdev') ||
      !inputs.start.includes('PATH=$node_bin') || inputs.start.includes('PATH=/tmp') ||
      /\/nix\/store|command -v|\bwhich\b/.test(inputs.prepare + inputs.start)) {
    throw new Error('Unexpected runtime verification boundary.');
  }
  const diagnosticAssignments = Array.from(inputs.start.matchAll(
    /^startup_check='(NS14B-\d\d)'$/gm), match => match[1]);
  const checksumVerifications = Array.from(inputs.start.matchAll(
    /\/usr\/bin\/sha256sum -c (?:"\$[a-z_]+"|-) >\/dev\/null 2>&1 \|\| fail/g));
  if (JSON.stringify(diagnosticAssignments) !== JSON.stringify(STARTUP_CHECKS) ||
      !inputs.start.includes('echo "$FAILURE Check $startup_check." >&2') ||
      !inputs.start.includes("*) startup_check='NS14B-00' ;;") ||
      checksumVerifications.length !== 4) {
    throw new Error('Unexpected startup diagnostic boundary.');
  }
  return true;
}

function createRootBuiltRuntimeSimulation(architecture = 'amd64') {
  const entries = new Map();
  function add(pathname, type, mode, uid = 0, gid = 0, digest = pathname,
    capabilities = []) {
    entries.set(pathname, { type, mode, uid, gid, digest, capabilities });
  }
  for (const pathname of ['/app', '/app/scripts', '/app/src', '/app/node_modules',
    '/app/node_modules/express', '/app/.northstar-runtime', '/usr/local',
    '/usr/local/bin', '/usr/local/lib', '/usr/local/lib/node_modules']) {
    add(pathname, 'directory', 0o555);
  }
  for (const pathname of ['/usr/local/bin/node', '/app/scripts/start-production.sh',
    '/app/scripts/production-launcher.js', '/app/src/productionChild.js',
    '/app/src/server.js', '/app/package.json', '/app/package-lock.json',
    '/app/Dockerfile', '/app/railway.toml',
    '/app/scripts/node-v22.23.3-runtime-manifest.txt',
    '/app/.northstar-runtime/node-path', '/app/.northstar-runtime/node-sha256',
    '/app/.northstar-runtime/node-arch', '/app/.northstar-runtime/privilege-inventory',
    '/app/.northstar-runtime/privilege-inventory.sha256',
    '/app/.northstar-runtime/executable-inventory',
    '/app/.northstar-runtime/executable-inventory.sha256',
    '/app/node_modules/express/index.js']) {
    add(pathname, 'file', pathname === '/usr/local/bin/node' ? 0o555 : 0o444);
  }
  const setpriv = { type: 'file', mode: 0o555, uid: 0, gid: 0,
    digest: PINNED_TOOL_IDENTITY[architecture].setpriv.sha256, capabilities: [],
    size: PINNED_TOOL_IDENTITY[architecture].setpriv.size, nlink: 1 };
  const getcap = { type: 'file', mode: 0o555, uid: 0, gid: 0,
    digest: PINNED_TOOL_IDENTITY[architecture].getcap.sha256, capabilities: [],
    size: PINNED_TOOL_IDENTITY[architecture].getcap.size, nlink: 1 };
  entries.set('/usr/bin/setpriv', setpriv);
  entries.set('/usr/sbin/getcap', getcap);
  for (const pathname of REMOVED_CAPABILITY_HELPERS) add(pathname, 'file', 0o755);
  for (const pathname of PRIVILEGED_BASE_PATHS) {
    add(pathname, 'file', pathname.includes('chage') || pathname.includes('expiry') ||
      pathname.includes('unix_chkpwd') ? 0o2755 : 0o4755, 0, 0,
    `${architecture}:${pathname}`);
  }
  add('/app/node_modules/injected-setuid', 'file', 0o4755);
  add('/usr/local/bin/injected-setgid', 'file', 0o2755);
  add('/var/lib/northstar/tmp/injected-filecap', 'file', 0o700, 1000, 1000,
    'cap-injected', ['cap_dac_override=ep']);
  const hardlink = { type: 'file', mode: 0o4755, uid: 0, gid: 0,
    digest: 'hardlink-setuid', capabilities: [] };
  entries.set('/app/node_modules/injected-hardlink', hardlink);
  entries.set('/usr/bin/injected-hardlink', hardlink);
  for (const pathname of ['/var/lib/northstar', '/var/lib/northstar/data',
    '/var/lib/northstar/tmp', '/var/lib/northstar/home']) {
    add(pathname, 'directory', 0o700, 1000, 1000);
  }
  return entries;
}

function hardenRootBuiltRuntime(entries) {
  for (const pathname of PRIVILEGED_BASE_PATHS) entries.delete(pathname);
  for (const pathname of REMOVED_CAPABILITY_HELPERS) entries.delete(pathname);
  for (const entry of new Set(entries.values())) {
    if (entry.type !== 'file') continue;
    entry.mode &= ~0o6000;
    entry.capabilities = [];
  }
  return entries;
}

function privilegeInventory(entries) {
  const setid = [], filecaps = [];
  for (const [pathname, entry] of entries) {
    if (entry.type !== 'file') continue;
    if (entry.mode & 0o6000) setid.push(pathname);
    if (entry.capabilities.length) filecaps.push(pathname);
  }
  return { setid: setid.sort(), filecaps: filecaps.sort() };
}

function runtimePrivilegeBoundaryAccepts(entries) {
  const protectedRoots = ['/usr/', '/app/', '/var/lib/northstar/', '/tmp/', '/home/'];
  for (const [pathname, entry] of entries) {
    if (entry.type !== 'file' || !protectedRoots.some(root => pathname.startsWith(root))) continue;
    if ((entry.mode & 0o6000) !== 0 || entry.capabilities.length !== 0) return false;
  }
  return true;
}

function executableInventoryAccepts(entries, architecture) {
  const expected = PINNED_TOOL_IDENTITY[architecture];
  const executables = [
    ['/usr/bin/setpriv', expected.setpriv],
    ['/usr/sbin/getcap', expected.getcap],
  ];
  if (REMOVED_CAPABILITY_HELPERS.some(pathname => entries.has(pathname))) return false;
  for (const [pathname, identity] of executables) {
    const executable = entries.get(pathname);
    if (!executable || executable.type !== 'file' ||
        executable.uid !== 0 || executable.gid !== 0 || executable.mode !== 0o555 ||
        executable.capabilities.length !== 0 || executable.digest !== identity.sha256 ||
        executable.size !== identity.size || executable.nlink !== 1) return false;
  }
  return true;
}

function permissionBits(entry, actor) {
  if (actor.uid === entry.uid) return (entry.mode >> 6) & 7;
  if (actor.groups.includes(entry.gid)) return (entry.mode >> 3) & 7;
  return entry.mode & 7;
}

function parentPath(pathname) {
  const value = path.posix.dirname(pathname);
  return value === '.' ? '/' : value;
}

function canRuntimeMutate(entries, pathname, operation, actor) {
  const entry = entries.get(pathname);
  if (!entry || actor.uid === 0 || actor.capabilities.length > 0) return actor.uid === 0;
  if (operation === 'chmod' || operation === 'chown') return actor.uid === entry.uid;
  if (operation === 'write') return (permissionBits(entry, actor) & 2) !== 0;
  const parent = entries.get(parentPath(pathname));
  return Boolean(parent && (permissionBits(parent, actor) & 3) === 3);
}

function authenticatedRuntimeEnvironment() {
  const stat = fs.statSync(node22);
  return {
    NORTHSTAR_AUTHENTICATED_NODE_PATH: fs.realpathSync.native(node22),
    NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY: 'official-win-x64-22.23.3-v1',
    NORTHSTAR_AUTHENTICATED_NODE_SHA256: LOCAL_NODE_SHA256,
    NORTHSTAR_AUTHENTICATED_NODE_DEVICE: String(stat.dev),
    NORTHSTAR_AUTHENTICATED_NODE_INODE: String(stat.ino),
    NORTHSTAR_AUTHENTICATED_NODE_SIZE: String(stat.size),
    NORTHSTAR_CANONICAL_ROOT: ROOT,
  };
}

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
    'npm_config_node_options', 'NODE_V8_COVERAGE', 'JEST_WORKER_ID',
    'NORTHSTAR_PART14B_TEST_ADAPTER']) delete env[key];
  env.AUTH_ACCESS_SECRET = 'launcher-test-secret-that-is-longer-than-thirty-two-characters';
  delete env.RAILWAY_ENVIRONMENT; delete env.RAILWAY_ENVIRONMENT_ID;
  delete env.RAILWAY_PROJECT_ID; delete env.RAILWAY_SERVICE_ID;
  delete env.RAILWAY_STATIC_URL; delete env.NIXPACKS_NODE_VERSION;
  Object.assign(env, overrides);
  return env;
}

function spawnChildWithProof({ digest, payload, environment = {} }) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(node22, [childEntry], {
      cwd: ROOT,
      env: cleanEnvironment({
        NODE_ENV: 'production', NORTHSTAR_CANONICAL_LAUNCH: 'os-pipe-v1',
        NORTHSTAR_CANONICAL_LAUNCH_DIGEST: digest,
        NORTHSTAR_CANONICAL_LAUNCH_PARENT: String(process.pid),
        ...authenticatedRuntimeEnvironment(),
        ...environment,
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, stdout, stderr, pid: child.pid }));
    const value = typeof payload === 'function' ? payload(child.pid) : payload;
    if (value === null) child.stdio[3].destroy();
    else child.stdio[3].end(value);
  });
}

describe('Mission 27 Part 14B production launcher contract', () => {
  test('source pins Node 22.23.3 and the deployed Docker start command', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    expect(pkg.engines).toEqual({ node: '22.23.3' });
    expect(lock.packages[''].engines).toEqual({ node: '22.23.3' });
    expect(pkg.scripts.start).toBe(
      '/usr/bin/setpriv --no-new-privs -- /bin/sh /app/scripts/start-production.sh');
    expect(pkg.scripts['start:verified-local']).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe ' +
      '-NoProfile -ExecutionPolicy Bypass -File scripts/start-verified-local.ps1');
    expect(pkg.scripts.dev).toBe('node --watch src/developmentChild.js');
    expect(fs.readFileSync(path.join(ROOT, '.node-version'), 'utf8')).toBe('22.23.3\n');
    expect(fs.existsSync(path.join(ROOT, 'nixpacks.toml'))).toBe(false);
    expect(exactRuntimePlan()).toBe(true);
    const startSource = fs.readFileSync(productionStart, 'utf8');
    const prepareSource = fs.readFileSync(productionPrepare, 'utf8');
    expect(startSource).toContain('[ "$node_path" != \'/usr/local/bin/node\' ]');
    expect(startSource).toContain("CANONICAL_ROOT='/app'");
    expect(startSource).toContain('runtime_directory="$CANONICAL_ROOT/.northstar-runtime"');
    expect(startSource).toContain('manifest="$runtime_directory/node-path"');
    expect(startSource).toContain('launcher="$CANONICAL_ROOT/scripts/production-launcher.js"');
    expect(startSource).toContain('exec "$node_path" "$launcher"');
    expect(startSource).toContain('[ "$2" = 1 ]');
    expect(startSource).toContain('/usr/sbin/getcap -r /usr "$CANONICAL_ROOT"');
    expect(startSource).toContain('/usr/bin/readlink -f -- "$node_path"');
    expect(startSource).toContain('/usr/bin/stat -c \'%u:%g:%a\' -- "$node_path"');
    expect(startSource).toContain('/usr/bin/od -An -tx1 -N20 -- "$node_path"');
    expect(startSource).not.toMatch(/(?:exec|command -v|which)\s+node(?:\s|$)/);
    expect(prepareSource).toContain("CANONICAL_ROOT='/app'");
    expect(prepareSource).toContain('"$runtime_directory/node-path"');
    expect(prepareSource).toContain(
      "printf '%s\\n' \"$NODE_PATH\" > \"$runtime_directory/node-path\"");
    expect(fs.readFileSync(localStart, 'utf8')).toContain(LOCAL_NODE_SHA256);
  });

  test.each(Object.entries(PINNED_NODE_ELF_HEADER))(
    'the official %s executable header binds Linux OSABI before execution', (arch, hex) => {
      const header = Buffer.from(hex, 'hex');
      expect(header.length).toBe(20);
      expect(header.subarray(0, 7).toString('hex')).toBe('7f454c46020101');
      expect(header[7]).toBe(0x03);
      expect(header[8]).toBe(0x00);
      expect(header.readUInt16LE(18)).toBe(arch === 'amd64' ? 0x3e : 0xb7);
      const prepareSource = fs.readFileSync(productionPrepare, 'utf8');
      const startSource = fs.readFileSync(productionStart, 'utf8');
      expect(prepareSource).toContain('[ "$8" != \'03\' ]');
      expect(startSource).toContain('[ "$8" != \'03\' ]');
    });

  test.each([
    ['Nixpacks 22.14 fallback', input => ({ railway: input.railway +
      '\nNIXPACKS_NODE_VERSION = "22.14.0"\n' })],
    ['mutable Docker tag', input => ({ dockerfile: input.dockerfile.replace(
      `@sha256:${PINNED_DOCKER_INDEX}`, '') })],
    ['wrong image digest', input => ({ dockerfile: input.dockerfile.replace(
      PINNED_DOCKER_INDEX, '0'.repeat(64)) })],
    ['wrong executable digest', input => ({ dockerfile: input.dockerfile.replace(
      PINNED_NODE_SHA256.amd64, '1'.repeat(64)) })],
    ['build-time System V OSABI substitution', input => ({ prepare: input.prepare.replace(
      '[ "$8" != \'03\' ]', '[ "$8" != \'00\' ]') })],
    ['runtime System V OSABI substitution', input => ({ start: input.start.replace(
      '[ "$8" != \'03\' ]', '[ "$8" != \'00\' ]') })],
    ['unsupported architecture fallback', input => ({ dockerfile: input.dockerfile.replace(
      "*) echo 'Unsupported NorthStar production architecture.' >&2; exit 78 ;;",
      "*) expected='" + PINNED_NODE_SHA256.amd64 + "' ;;") })],
    ['in-build network download', input => ({ dockerfile: input.dockerfile +
      '\nRUN curl -L https://mirror.invalid/node.tar.xz | tar -xJ\n' })],
    ['PATH-selected digest tool', input => ({ dockerfile: input.dockerfile.replace(
      '/usr/bin/sha256sum -c -', 'sha256sum -c -') })],
    ['workspace runtime override', input => ({ ignore: input.ignore.replace(
      '.northstar-runtime/*\n', '') })],
    ['multiple external base images', input => ({ dockerfile: input.dockerfile +
      '\nFROM node:22.14.0\n' })],
    ['writable runtime contract', input => ({ prepare: input.prepare.replace(
      '/bin/chmod 0555 "$NODE_PATH"', '/bin/chmod 0777 "$NODE_PATH"') })],
    ['root runtime', input => ({ dockerfile: input.dockerfile.replace(
      'USER 1000:1000', 'USER root') })],
    ['group-writable application', input => ({ dockerfile: input.dockerfile.replace(
      "/usr/bin/find /app -xdev -type d -exec /bin/chmod 0555 '{}' +",
      "/usr/bin/find /app -xdev -type d -exec /bin/chmod 0775 '{}' +") })],
    ['runtime-owned authority tree', input => ({ dockerfile: input.dockerfile.replace(
      '/bin/chown -R 0:0 /app', '/bin/chown -R 1000:1000 /app') })],
    ['writable data below authority root', input => ({ dockerfile: input.dockerfile.replace(
      '/var/lib/northstar/data', '/app/runtime-data') })],
    ['missing capability gate', input => ({ start: input.start.replace(
      'check_runtime_identity || fail', ': # identity gate removed') })],
    ['split runtime identity comparison', input => ({ start: input.start.replace(
      RUNTIME_IDENTITY_PREDICATE,
      RUNTIME_IDENTITY_PREDICATE.replace(' = 11111111 ]', ' =\\n    11111111 ]')) })],
    ['continued runtime identity comparison', input => ({ start: input.start.replace(
      RUNTIME_IDENTITY_PREDICATE,
      RUNTIME_IDENTITY_PREDICATE.replace(' = 11111111 ]', ' = \\\\\n    11111111 ]')) })],
    ['supplementary group clearing denied', input => ({ start: input.start.replace(
      'if [ "$#" -eq 1 ]; then', 'if false; then') })],
    ['unexpected supplementary groups allowed', input => ({ start: input.start.replace(
      'elif [ "$#" -eq 2 ] && [ "$2" = 1000 ]; then',
      'elif [ "$#" -ge 2 ]; then') })],
    ['startup diagnostic widened to caller text', input => ({ start: input.start.replace(
      'echo "$FAILURE Check $startup_check." >&2',
      'echo "$FAILURE Check ${STARTUP_DETAIL-}." >&2') })],
    ['checksum verifier exposes utility stderr', input => ({ start: input.start.replace(
      '>/dev/null 2>&1 || fail', '>/dev/null || fail') })],
    ['PATH-selected application runtime', input => ({ start: input.start.replace(
      'PATH=$node_bin', 'PATH=/tmp:$node_bin') })],
    ['missing setid clearing', input => ({ dockerfile: input.dockerfile.replace(
      "/usr/bin/find / -xdev -type f -perm /6000 -exec /bin/chmod a-s '{}' +",
      ': # setid clearing removed') })],
    ['missing file capability clearing', input => ({ dockerfile: input.dockerfile.replace(
      '/usr/sbin/setcap -r "$capability_path"', ': # capability clearing removed') })],
    ['retained capability mutation helpers', input => ({ dockerfile: input.dockerfile.replace(
      '/bin/rm -f /usr/sbin/capsh /usr/sbin/getpcaps', ': # helpers retained') })],
    ['non-executable retained verifier', input => ({ dockerfile: input.dockerfile.replace(
      '/bin/chmod 0555 /usr/bin/setpriv /usr/sbin/getcap',
      '/bin/chmod 0444 /usr/bin/setpriv /usr/sbin/getcap') })],
    ['missing executable identity inventory', input => ({ dockerfile: input.dockerfile.replace(
      "'northstar-executable-inventory-v2'", "'unbound-executable-inventory'") })],
    ['copy after privilege scan', input => ({ dockerfile: input.dockerfile.replace(
      'USER 1000:1000', 'COPY package.json /usr/bin/late-copy\nUSER 1000:1000') })],
    ['runtime without no-new-privileges', input => ({ railway: input.railway.replace(
      '/usr/bin/setpriv --no-new-privs -- ', '') })],
    ['startup without runtime privilege scan', input => ({ start: input.start.replace(
       '/usr/sbin/getcap -r /usr "$CANONICAL_ROOT"', ': # getcap scan removed') })],
    ['startup accepts dynamic-loader injection', input => ({ start: input.start.replace(
      'if [ -n "${LD_PRELOAD-}" ] || [ -n "${LD_LIBRARY_PATH-}" ]; then',
      'if false; then') })],
    ['writable dynamic library tree', input => ({ dockerfile: input.dockerfile.replace(
      '/usr/bin/find /usr/lib -xdev', '/usr/bin/find /app -xdev') })],
  ])('offline production plan rejects %s', (_name, mutate) => {
    const input = {
      dockerfile: fs.readFileSync(dockerfilePath, 'utf8'),
      railway: fs.readFileSync(railwayConfigPath, 'utf8'),
      ignore: fs.readFileSync(dockerIgnorePath, 'utf8'),
      manifest: fs.readFileSync(runtimeManifestPath, 'utf8'),
      prepare: fs.readFileSync(productionPrepare, 'utf8'),
      start: fs.readFileSync(productionStart, 'utf8'),
    };
    expect(() => exactRuntimePlan(mutate(input))).toThrow();
  });

  test.each(['amd64', 'arm64'])(
    'exact %s OCI privilege inventory is empty after the final hardening mutation', architecture => {
      const entries = createRootBuiltRuntimeSimulation(architecture);
      const before = privilegeInventory(entries);
      expect(before.setid).toEqual(expect.arrayContaining(PRIVILEGED_BASE_PATHS));
      expect(before.filecaps).toEqual([
        '/var/lib/northstar/tmp/injected-filecap',
      ]);
      hardenRootBuiltRuntime(entries);
      expect(privilegeInventory(entries)).toEqual({ setid: [], filecaps: [] });
      expect(runtimePrivilegeBoundaryAccepts(entries)).toBe(true);
      expect(executableInventoryAccepts(entries, architecture)).toBe(true);
      for (const pathname of PRIVILEGED_BASE_PATHS) expect(entries.has(pathname)).toBe(false);
      for (const pathname of REMOVED_CAPABILITY_HELPERS) expect(entries.has(pathname)).toBe(false);
    });

  test.each(['amd64', 'arm64'])(
    'exact %s archive tool identity stays executable, immutable, and read-only', architecture => {
      const entries = hardenRootBuiltRuntime(createRootBuiltRuntimeSimulation(architecture));
      const expected = PINNED_TOOL_IDENTITY[architecture];
      expect(entries.get('/usr/bin/setpriv')).toMatchObject({ mode: 0o555, uid: 0, gid: 0,
        digest: expected.setpriv.sha256, size: expected.setpriv.size, capabilities: [] });
      expect(entries.get('/usr/sbin/getcap')).toMatchObject({ mode: 0o555, uid: 0, gid: 0,
        digest: expected.getcap.sha256, size: expected.getcap.size, capabilities: [] });
      expect(entries.has('/app/.northstar-runtime/setpriv.identity')).toBe(false);
      expect(entries.has('/app/.northstar-runtime/getcap.identity')).toBe(false);
      expect(entries.get('/usr/bin/setpriv').nlink).toBe(1);
      expect(entries.get('/usr/sbin/getcap').nlink).toBe(1);
      expect(executableInventoryAccepts(entries, architecture)).toBe(true);
    });

  test.each(['amd64', 'arm64'])(
    'exact %s executable identity survives OCI export without cross-path hardlinks', architecture => {
      const entries = hardenRootBuiltRuntime(createRootBuiltRuntimeSimulation(architecture));
      const exported = new Map([...entries].map(([pathname, entry]) =>
        [pathname, { ...entry, capabilities: [...entry.capabilities] }]));
      expect(exported.get('/usr/bin/setpriv'))
        .not.toBe(entries.get('/usr/bin/setpriv'));
      expect(exported.get('/usr/sbin/getcap'))
        .not.toBe(entries.get('/usr/sbin/getcap'));
      expect(executableInventoryAccepts(exported, architecture)).toBe(true);
    });

  test.each([
    ['setpriv mode 0444', '/usr/bin/setpriv', { mode: 0o444 }],
    ['setpriv mode 0755 drift', '/usr/bin/setpriv', { mode: 0o755 }],
    ['getcap digest drift', '/usr/sbin/getcap', { digest: '0'.repeat(64) }],
    ['getcap size drift', '/usr/sbin/getcap', { size: 1 }],
    ['getcap owner drift', '/usr/sbin/getcap', { uid: 1000 }],
    ['setpriv group drift', '/usr/bin/setpriv', { gid: 1000 }],
    ['setpriv symlink substitution', '/usr/bin/setpriv', { type: 'symlink' }],
    ['getcap gained file capability', '/usr/sbin/getcap',
      { capabilities: ['cap_dac_override=ep'] }],
    ['setpriv extra hardlink', '/usr/bin/setpriv', { nlink: 2 }],
    ['getcap missing link count', '/usr/sbin/getcap', { nlink: 0 }],
    ['capsh restored', '/usr/sbin/capsh', { mode: 0o755 }],
    ['getpcaps restored', '/usr/sbin/getpcaps', { mode: 0o755 }],
    ['setcap restored', '/usr/sbin/setcap', { mode: 0o755 }],
  ])('runtime rejects executable inventory drift: %s', (_name, pathname, change) => {
    const entries = hardenRootBuiltRuntime(createRootBuiltRuntimeSimulation());
    const current = entries.get(pathname);
    entries.set(pathname, { type: 'file', uid: 0, gid: 0, mode: 0o555,
      digest: pathname, capabilities: [], size: 1, nlink: 1,
      ...(current || {}), ...change });
    expect(executableInventoryAccepts(entries, 'amd64')).toBe(false);
  });

  test('data resources and executable authority use disjoint exact modes', () => {
    const source = fs.readFileSync(productionStart, 'utf8');
    expect(source).toContain("!= '0:0:444:1'");
    expect(source).toContain("!= '0:0:555:1'");
    expect(source).not.toContain('_identity_anchor=');
    expect(source).not.toContain('_build_device_inode=');
    expect(source).not.toMatch(/privilege_sha_manifest" \/usr\/bin\/setpriv/);
    expect(source).toContain('check_executable_identity /usr/bin/setpriv');
    expect(source).toContain('check_executable_identity /usr/sbin/getcap');
    expect(source).toContain(
      'for removed_helper in /usr/sbin/capsh /usr/sbin/getpcaps /usr/sbin/setcap');
  });

  (dashRuntimeAvailable() ? test : test.skip)(
    'Debian dash accepts cleared or exact-primary supplementary groups and rejects others', () => {
      const source = fs.readFileSync(productionStart, 'utf8');
      const cleared = runRuntimeIdentityUnderDash(source, true, null);
      expect({ status: cleared.status, stdout: cleared.stdout, stderr: cleared.stderr })
        .toEqual({ status: 0, stdout: 'runtime-identity-ok\n', stderr: '' });

      const canonical = runRuntimeIdentityUnderDash(source, true);
      expect({ status: canonical.status, stdout: canonical.stdout, stderr: canonical.stderr })
        .toEqual({ status: 0, stdout: 'runtime-identity-ok\n', stderr: '' });

      for (const invalidGroups of ['1001', '1000,1001']) {
        const rejectedGroups = runRuntimeIdentityUnderDash(source, false, invalidGroups);
        expect({ status: rejectedGroups.status, stdout: rejectedGroups.stdout,
          stderr: rejectedGroups.stderr })
          .toEqual({ status: 78, stdout: '', stderr: '' });
      }

      const split = source.replace(RUNTIME_IDENTITY_PREDICATE,
        RUNTIME_IDENTITY_PREDICATE.replace(' = 11111111 ]', ' =\n    11111111 ]'));
      const rejected = runRuntimeIdentityUnderDash(split, false);
      expect(rejected.status).toBe(78);
      expect(rejected.stderr).toMatch(/\[: missing \]|11111111: not found/);
      expect(rejected.stdout).toBe('');
    });

  (dashRuntimeAvailable() ? test : test.skip)(
    'Debian dash emits only an allowlisted startup check identifier', () => {
      const source = fs.readFileSync(productionStart, 'utf8');
      for (const check of STARTUP_CHECKS) {
        const result = runStartupDiagnosticUnderDash(source, check);
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr })
          .toEqual({ status: 78, stdout: '',
            stderr: `NorthStar production startup rejected the Node runtime. Check ${check}.\n` });
      }
      const rejected = runStartupDiagnosticUnderDash(source,
        'secret=customer@example.test provider-token=private');
      expect({ status: rejected.status, stdout: rejected.stdout, stderr: rejected.stderr })
        .toEqual({ status: 78, stdout: '',
          stderr: 'NorthStar production startup rejected the Node runtime. Check NS14B-00.\n' });
      expect(rejected.stderr).not.toMatch(/customer|provider|private|secret|@/i);
    });

  (dashRuntimeAvailable() ? test : test.skip)(
    'Debian dash suppresses hostile checksum utility output before the bounded stage failure', () => {
      const source = fs.readFileSync(productionStart, 'utf8');
      for (const [check, manifestVariable] of [
        ['NS14B-11', 'privilege_sha_manifest'],
        ['NS14B-12', 'executable_sha_manifest'],
      ]) {
        const result = runManifestChecksumFailureUnderDash(source, check, manifestVariable);
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr })
          .toEqual({ status: 78, stdout: '',
            stderr: `NorthStar production startup rejected the Node runtime. Check ${check}.\n` });
        expect(result.stderr).not.toMatch(/customer|provider|private|secret|@|sha256sum/i);
      }
    });

  test.each([
    ['/usr/bin injected setuid', '/usr/bin/injected-setuid', 0o4755, []],
    ['/usr/sbin injected setgid', '/usr/sbin/injected-setgid', 0o2755, []],
    ['/app injected setuid', '/app/injected-setuid', 0o4755, []],
    ['/usr/local injected setgid', '/usr/local/injected-setgid', 0o2755, []],
    ['node_modules injected setuid', '/app/node_modules/injected-late', 0o4755, []],
    ['writable directory injected setgid', '/var/lib/northstar/tmp/injected-late', 0o2755, []],
    ['Node file capability', '/usr/local/bin/node', 0o555, ['cap_setuid=ep']],
    ['launcher file capability', '/app/scripts/production-launcher.js', 0o444,
      ['cap_dac_override=ep']],
    ['interpreter file capability', '/usr/bin/dash', 0o555, ['cap_setgid=ep']],
  ])('runtime privilege boundary rejects %s', (_name, pathname, mode, capabilities) => {
    const entries = hardenRootBuiltRuntime(createRootBuiltRuntimeSimulation());
    const current = entries.get(pathname);
    entries.set(pathname, current ? { ...current, mode, capabilities: [...capabilities] } : {
      type: 'file', mode, uid: 0, gid: 0, digest: `late:${pathname}`,
      capabilities: [...capabilities],
    });
    expect(runtimePrivilegeBoundaryAccepts(entries)).toBe(false);
  });

  test('hardlinks, symlinks, and late overlays cannot hide a privileged regular file', () => {
    const entries = hardenRootBuiltRuntime(createRootBuiltRuntimeSimulation());
    const privileged = { type: 'file', mode: 0o4755, uid: 0, gid: 0,
      digest: 'late-shared-inode', capabilities: [] };
    entries.set('/usr/bin/late-hardlink', privileged);
    entries.set('/app/node_modules/late-hardlink', privileged);
    entries.set('/tmp/late-link', { type: 'symlink', mode: 0o777, uid: 1000, gid: 1000,
      digest: '/usr/bin/late-target', capabilities: [] });
    entries.set('/usr/bin/late-target', { ...privileged, digest: 'late-target-inode' });
    entries.set('/app/overlay-copy', { type: 'file', mode: 0o755, uid: 0, gid: 0,
      digest: 'late-overlay', capabilities: ['cap_setfcap=ep'] });
    expect(runtimePrivilegeBoundaryAccepts(entries)).toBe(false);
    expect(privilegeInventory(entries)).toEqual({
      setid: ['/app/node_modules/late-hardlink', '/usr/bin/late-hardlink',
        '/usr/bin/late-target'],
      filecaps: ['/app/overlay-copy'],
    });
  });

  test('root-built runtime denies same-container persistence to uid 1000', () => {
    const entries = hardenRootBuiltRuntime(createRootBuiltRuntimeSimulation());
    const actor = { uid: 1000, gid: 1000, groups: [1000], capabilities: [] };
    const authorityEntries = [...entries.entries()]
      .filter(([, entry]) => entry.uid === 0).map(([pathname]) => pathname);
    const before = new Map([...entries].map(([pathname, entry]) => [pathname, entry.digest]));
    for (const pathname of authorityEntries) {
      for (const operation of ['chmod', 'chown', 'write', 'rename', 'unlink',
        'symlink', 'hardlink']) {
        expect(canRuntimeMutate(entries, pathname, operation, actor)).toBe(false);
      }
    }
    for (const pathname of ['/var/lib/northstar/data', '/var/lib/northstar/tmp',
      '/var/lib/northstar/home']) {
      expect(canRuntimeMutate(entries, pathname, 'write', actor)).toBe(true);
    }
    expect(new Map([...entries].map(([pathname, entry]) => [pathname, entry.digest])))
      .toEqual(before);
  });

  test.each([launcher, childEntry])('%s is executable-only and exposes no import capability', entry => {
    const result = childProcess.spawnSync(process.execPath,
      ['-e', `try{require(${JSON.stringify(entry)});process.exit(2)}catch(e){` +
        `process.stdout.write(e.message)}`], { cwd: ROOT, encoding: 'utf8',
        env: cleanEnvironment() });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/not importable/);
  });

  test('direct server require fails before forged database or adaptive isProxy effects', () => {
    const script = String.raw`
'use strict';
const values=JSON.parse(process.argv[1]),Module=require('node:module'),types=require('node:util/types');
const native=Module._cache,real=types.isProxy;let has=0,get=0,detector=0,provider=0,query=0;
native[values.db]={id:values.db,filename:values.db,loaded:true,exports:{getPool(){provider+=1;
 return {query(){query+=1;},connect(){query+=1;}};}},children:[],paths:[]};
const hidden=new Proxy(native,{has(target,key){has+=1;return key===values.db?false:key in target;},
 get(target,key,receiver){get+=1;return Reflect.get(target,key,receiver);}});Module._cache=hidden;
types.isProxy=function(value){detector+=1;return value===hidden?false:real(value);};
let loaded=false,error=null;try{require(values.server);loaded=true;}catch(value){error=value.message;}
process.stdout.write(JSON.stringify({loaded,error,has,get,detector,provider,query}));`;
    const result = childProcess.spawnSync(process.execPath, ['-e', script,
      JSON.stringify({ server, db: path.join(ROOT, 'src/db.js') })], {
      cwd: ROOT, encoding: 'utf8', env: cleanEnvironment({ NODE_ENV: 'production' }),
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ loaded: false,
      error: 'The fictional demo journey application composition is unavailable.',
      has: 0, get: 1, detector: 0, provider: 0, query: 0 });
  });

  test('the POSIX boundary rejects inherited Node injection before its preload executes', () => {
    if (process.platform !== 'win32') return;
    const shell = 'C:\\Program Files\\Git\\usr\\bin\\sh.exe';
    if (!fs.existsSync(shell)) return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'm27-launch-'));
    try {
      const marker = path.join(temporary, 'preload-ran');
      const preload = path.join(temporary, 'preload.js');
      fs.writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`);
      const result = childProcess.spawnSync(shell, ['scripts/start-production.sh'], {
        cwd: ROOT, encoding: 'utf8', env: cleanEnvironment({
          NODE_OPTIONS: `--require=${preload}`,
        }),
      });
      if (result.status === 3221225794) {
        // The managed Windows sandbox blocks MSYS before the script executes;
        // the exact boundary is exercised on the pinned Linux deployment path.
        expect(fs.existsSync(marker)).toBe(false);
        return;
      }
      expect(result.status).toBe(78);
      expect(result.stderr).toMatch(/rejected (?:NODE_OPTIONS|the Node runtime)/);
      expect(fs.existsSync(marker)).toBe(false);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  test('the POSIX boundary never dispatches a PATH-shadowed Node or utility', () => {
    if (process.platform !== 'win32') return;
    const shell = 'C:\\Program Files\\Git\\usr\\bin\\sh.exe';
    if (!fs.existsSync(shell)) return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'm27-path-shadow-'));
    try {
      const marker = path.join(temporary, 'substitute-ran');
      const fake = `#!/bin/sh\nprintf ran > ${JSON.stringify(marker.replace(/\\/g, '/'))}\nexit 90\n`;
      for (const name of ['node', 'readlink', 'realpath', 'stat', 'sha256sum']) {
        const entry = path.join(temporary, name);
        fs.writeFileSync(entry, fake, { mode: 0o755 });
        fs.chmodSync(entry, 0o755);
      }
      const result = childProcess.spawnSync(shell, ['scripts/start-production.sh'], {
        cwd: ROOT, encoding: 'utf8', env: cleanEnvironment({
          PATH: `${temporary};${process.env.PATH || ''}`,
        }),
      });
      if (result.status === 3221225794 && /NtCreateDirectoryObject/.test(result.stderr)) {
        expect(fs.existsSync(marker)).toBe(false); return;
      }
      expect(result.status).toBe(78);
      expect(result.stderr).toContain('rejected the Node runtime');
      expect(fs.existsSync(marker)).toBe(false);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  test('alternate cwd, copied, linked, and caller-selected roots cannot replace the launcher', () => {
    if (process.platform !== 'win32') return;
    const shell = 'C:\\Program Files\\Git\\usr\\bin\\sh.exe';
    if (!fs.existsSync(shell)) return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'm27 alternate root '));
    try {
      const marker = path.join(temporary, 'attacker-launcher-ran');
      fs.mkdirSync(path.join(temporary, '.northstar-runtime'), { recursive: true });
      fs.mkdirSync(path.join(temporary, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(temporary, '.northstar-runtime', 'node-path'),
        '/nix/store/00000000000000000000000000000000-nodejs-22.23.3/bin/node\n');
      fs.writeFileSync(path.join(temporary, 'scripts', 'production-launcher.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`);
      const copied = path.join(temporary, 'copied-start-production.sh');
      const linked = path.join(temporary, 'linked-start-production.sh');
      fs.copyFileSync(productionStart, copied);
      const candidates = [productionStart, copied];
      try {
        fs.linkSync(productionStart, linked); candidates.push(linked);
      } catch (_) { /* The managed sandbox may deny hard links. */ }
      try {
        const symlink = path.join(temporary, 'symlink-start-production.sh');
        fs.symlinkSync(productionStart, symlink, 'file'); candidates.push(symlink);
      } catch (_) { /* Windows may deny unprivileged symlink creation. */ }
      for (const entry of candidates) {
        const result = childProcess.spawnSync(shell, [entry], {
          cwd: temporary, encoding: 'utf8', env: cleanEnvironment({
            PWD: '/app', OLDPWD: '/app', CDPATH: temporary, INIT_CWD: temporary,
            npm_config_prefix: temporary,
          }),
        });
        if (result.status === 3221225794 && /NtCreateDirectoryObject/.test(result.stderr)) continue;
        expect(result.status).toBe(78);
        expect(result.stderr).toContain('rejected the Node runtime');
        expect(fs.existsSync(marker)).toBe(false);
      }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});

canonicalRuntime('Mission 27 Part 14B pinned Node 22.23.3 launcher evidence', () => {
  test('direct launcher invocation without an authenticated executable fails closed', () => {
    const result = childProcess.spawnSync(node22, [launcher], {
      cwd: ROOT, encoding: 'utf8', env: cleanEnvironment(), timeout: 120000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('Canonical production composition ready.');
    expect(result.stderr).toContain('authenticated v22.23.3 executable');
  });

  test('pinned local boundary creates a genuine composition before the expected missing-DB stop', () => {
    const result = childProcess.spawnSync(systemPowerShell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', localStart,
      '-NodeBinary', node22,
    ], {
      cwd: ROOT, encoding: 'utf8', env: cleanEnvironment({ DATABASE_URL: '' }),
      timeout: 120000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[Bootstrap] Canonical production composition ready.');
    expect(result.stderr).toContain('PostgreSQL startup authority is unavailable');
  });

  test('pinned local boundary rejects a substitute before executing it', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'm27-local-substitute-'));
    try {
      const substitute = path.join(temporary, 'node.exe');
      const marker = path.join(temporary, 'ran');
      fs.writeFileSync(substitute, `not a node executable ${marker}`);
      const result = childProcess.spawnSync(systemPowerShell, [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', localStart,
        '-NodeBinary', substitute,
      ], { cwd: ROOT, encoding: 'utf8', env: cleanEnvironment(), timeout: 120000 });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('rejected the Node runtime');
      expect(fs.existsSync(marker)).toBe(false);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  test.each([
    { name: 'relative path', node: 'node.exe', environment: {} },
    { name: 'Railway marker', node: node22,
      environment: { RAILWAY_ENVIRONMENT_ID: 'production-environment' } },
    { name: 'Nixpacks marker', node: node22,
      environment: { NIXPACKS_NODE_VERSION: '22.23.3' } },
  ])('pinned local boundary rejects $name before Node execution', scenario => {
    const result = childProcess.spawnSync(systemPowerShell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', localStart,
      '-NodeBinary', scenario.node,
    ], { cwd: ROOT, encoding: 'utf8',
      env: cleanEnvironment(scenario.environment), timeout: 120000 });
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('Canonical production composition ready.');
    expect(`${result.stdout}${result.stderr}`).toContain('rejected the Node runtime');
  });

  test.each(['missing-pipe', 'wrong-digest', 'duplicate-proof', 'wrong-parent', 'extra-argv'])(
    '%s cannot create or replay the one-use child proof', async variant => {
      const nonce = crypto.randomBytes(32);
      const digest = crypto.createHash('sha256').update(nonce).digest('hex');
      if (variant === 'extra-argv') {
        const result = childProcess.spawnSync(node22, [childEntry, 'extra'], {
          cwd: ROOT, encoding: 'utf8', env: cleanEnvironment({
            NODE_ENV: 'production', NORTHSTAR_CANONICAL_LAUNCH: 'os-pipe-v1',
            NORTHSTAR_CANONICAL_LAUNCH_DIGEST: digest,
            NORTHSTAR_CANONICAL_LAUNCH_PARENT: String(process.pid),
            ...authenticatedRuntimeEnvironment(),
          }),
        });
        expect(result.status).toBe(1); expect(result.stderr).toContain('production child is unavailable');
        return;
      }
      const result = await spawnChildWithProof({
        digest: variant === 'wrong-digest' ? '0'.repeat(64) : digest,
        environment: variant === 'wrong-parent' ? { NORTHSTAR_CANONICAL_LAUNCH_PARENT: '1' } : {},
        payload: variant === 'missing-pipe' ? null : pid => {
          const value = Buffer.alloc(variant === 'duplicate-proof' ? 80 : 40);
          nonce.copy(value, 0); value.writeBigUInt64BE(BigInt(pid), 32);
          if (variant === 'duplicate-proof') nonce.copy(value, 40);
          return value;
        },
      });
      expect(result.code).toBe(1);
      expect(result.stdout).not.toContain('Canonical production composition ready');
      expect(result.stderr).toContain('production child is unavailable');
    });
});
