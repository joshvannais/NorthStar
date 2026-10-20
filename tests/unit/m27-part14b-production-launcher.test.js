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
    'startCommand = "/bin/sh /app/scripts/start-production.sh"\n';
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
      /(?:^|[ ;])(?:node|npm|sha256sum)(?:[ ;]|$)/m.test(inputs.dockerfile)) {
    throw new Error('Unexpected Docker runtime plan.');
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
  }
  if (!inputs.prepare.includes('/usr/bin/dpkg --print-architecture') ||
      !inputs.prepare.includes('/usr/bin/sha256sum -c -') ||
      !inputs.prepare.includes('/bin/chmod 0555 "$NODE_PATH"') ||
      !inputs.start.includes('[ "$node_path" != \'/usr/local/bin/node\' ]') ||
      !inputs.start.includes("NORTHSTAR_AUTHENTICATED_NODE_AUTHORITY='official-docker-node-22.23.3-v1'") ||
      /\/nix\/store|command -v|\bwhich\b/.test(inputs.prepare + inputs.start)) {
    throw new Error('Unexpected runtime verification boundary.');
  }
  return true;
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
    expect(pkg.scripts.start).toBe('/bin/sh /app/scripts/start-production.sh');
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
    expect(startSource).toContain('/usr/bin/readlink -f -- "$node_path"');
    expect(startSource).toContain('/usr/bin/stat -c \'%u:%a\' -- "$node_path"');
    expect(startSource).toContain('/usr/bin/od -An -tx1 -N20 -- "$node_path"');
    expect(startSource).not.toMatch(/(?:exec|command -v|which)\s+node(?:\s|$)/);
    expect(prepareSource).toContain("CANONICAL_ROOT='/app'");
    expect(prepareSource).toContain('"$runtime_directory/node-path"');
    expect(prepareSource).toContain(
      "printf '%s\\n' \"$NODE_PATH\" > \"$runtime_directory/node-path\"");
    expect(fs.readFileSync(localStart, 'utf8')).toContain(LOCAL_NODE_SHA256);
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
      if (result.status === 3221225794 && /NtCreateDirectoryObject/.test(result.stderr)) {
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
