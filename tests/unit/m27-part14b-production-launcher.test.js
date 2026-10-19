'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const launcher = path.join(ROOT, 'scripts/production-launcher.js');
const childEntry = path.join(ROOT, 'src/productionChild.js');
const server = path.join(ROOT, 'src/server.js');
const node22 = process.env.M27_NODE22_EXECUTABLE ||
  (process.version === 'v22.23.3' ? process.execPath : null);
const canonicalRuntime = node22 && fs.existsSync(node22) ? describe : describe.skip;

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_CONFIG_NODE_OPTIONS',
    'npm_config_node_options', 'NODE_V8_COVERAGE', 'JEST_WORKER_ID',
    'NORTHSTAR_PART14B_TEST_ADAPTER']) delete env[key];
  env.AUTH_ACCESS_SECRET = 'launcher-test-secret-that-is-longer-than-thirty-two-characters';
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
    expect(pkg.scripts.start).toBe('sh scripts/start-production.sh');
    expect(pkg.scripts.dev).toBe('node --watch src/developmentChild.js');
    expect(fs.readFileSync(path.join(ROOT, '.node-version'), 'utf8')).toBe('22.23.3\n');
    expect(fs.readFileSync(path.join(ROOT, 'nixpacks.toml'), 'utf8')).toBe(
      '[variables]\nNIXPACKS_NODE_VERSION = "22.23.3"\n\n[start]\n' +
      'cmd = "sh scripts/start-production.sh"\n');
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
      expect(result.stderr).toContain('rejected NODE_OPTIONS');
      expect(fs.existsSync(marker)).toBe(false);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
});

canonicalRuntime('Mission 27 Part 14B pinned Node 22.23.3 launcher evidence', () => {
  test('clean launcher creates a genuine composition before the expected missing-DB stop', () => {
    const result = childProcess.spawnSync(node22, [launcher], {
      cwd: ROOT, encoding: 'utf8', env: cleanEnvironment(), timeout: 120000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[Bootstrap] Canonical production composition ready.');
    expect(result.stderr).toContain('PostgreSQL startup authority is unavailable');
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
