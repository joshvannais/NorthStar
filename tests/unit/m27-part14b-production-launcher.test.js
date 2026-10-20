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
const localStart = path.join(ROOT, 'scripts/start-verified-local.ps1');
const systemPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const childEntry = path.join(ROOT, 'src/productionChild.js');
const server = path.join(ROOT, 'src/server.js');
const LOCAL_NODE_SHA256 = '9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e';
const node22 = process.env.M27_NODE22_EXECUTABLE ||
  (process.version === 'v22.23.3' ? process.execPath : null);
const canonicalRuntime = node22 && fs.existsSync(node22) ? describe : describe.skip;

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
  test('source pins Node 22.23.3 and the deployed Nixpacks start command', () => {
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
    expect(fs.readFileSync(path.join(ROOT, 'nixpacks.toml'), 'utf8')).toBe(
      '[variables]\nNIXPACKS_NODE_VERSION = "22.23.3"\n\n' +
      '[phases.build]\ncmds = ["/bin/sh /app/scripts/prepare-production-node.sh"]\n\n' +
      '[start]\ncmd = "/bin/sh /app/scripts/start-production.sh"\n');
    const startSource = fs.readFileSync(productionStart, 'utf8');
    const prepareSource = fs.readFileSync(productionPrepare, 'utf8');
    expect(startSource).toContain('/nix/store/*-nodejs-22.23.3/bin/node');
    expect(startSource).toContain("CANONICAL_ROOT='/app'");
    expect(startSource).toContain('manifest="$CANONICAL_ROOT/.northstar-runtime/node-path"');
    expect(startSource).toContain('launcher="$CANONICAL_ROOT/scripts/production-launcher.js"');
    expect(startSource).toContain('exec "$node_path" "$launcher"');
    expect(startSource).toContain('/usr/bin/readlink -f -- "$node_path"');
    expect(startSource).toContain('/usr/bin/stat -c \'%u:%a\' -- "$node_path"');
    expect(startSource).toContain('/usr/bin/od -An -tx1 -N20 -- "$node_path"');
    expect(startSource).not.toMatch(/(?:exec|command -v|which)\s+node(?:\s|$)/);
    expect(prepareSource).toContain("CANONICAL_ROOT='/app'");
    expect(prepareSource).toContain('manifest="$runtime_directory/node-path"');
    expect(prepareSource).toContain("printf '%s\\n' \"$node_path\" > \"$manifest\"");
    expect(fs.readFileSync(localStart, 'utf8')).toContain(LOCAL_NODE_SHA256);
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
      fs.linkSync(productionStart, linked);
      const candidates = [productionStart, copied, linked];
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
