'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

const retiredProduction = Object.freeze([
  'src/services/intelligence.js',
  'src/services/decisionEngine.js',
  'src/services/customerIntelligence.js',
  'src/services/polarisContextBuilder.js',
  'src/voice/executiveContext.js',
]);

const legacyTestDisposition = Object.freeze({
  'tests/unit/intelligence.test.js': [
    'tests/unit/m19-part3-canonical-calculation.test.js',
    'tests/integration/m19-part3-canonical-graph-postgres.test.js',
  ],
  'tests/unit/decisionEngine.test.js': [
    'tests/unit/m19-part3-canonical-calculation.test.js',
    'tests/api/m19-part3-canonical-api-postgres.test.js',
  ],
  'tests/unit/customerIntelligence.test.js': [
    'tests/unit/m19-part3-canonical-calculation.test.js',
    'tests/api/m19-part3-canonical-api-postgres.test.js',
  ],
  'tests/unit/voice/executiveContext.test.js': [
    'tests/integration/m19-part3-voice-sessions-postgres.test.js',
    'tests/unit/m19-part3-canonical-voice-tools.test.js',
  ],
  'tests/integration/pipeline.test.js': [
    'tests/integration/m19-part3-canonical-graph-postgres.test.js',
    'tests/api/m19-part3-canonical-api-postgres.test.js',
  ],
  'tests/regression/m16.5-bugs.test.js': [
    'tests/unit/m19-part3-canonical-calculation.test.js',
    'tests/api/m19-part3-canonical-api-postgres.test.js',
  ],
  'tests/regression/determinism.test.js': [
    'tests/unit/m19-part3-canonical-calculation.test.js',
    'tests/integration/m19-part3-canonical-graph-postgres.test.js',
  ],
});

function absolute(relative) {
  return path.join(root, ...relative.split('/'));
}

function javascriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath);
  }
  return files;
}

function relativeRequireTargets(filename) {
  const targets = [];
  const source = fs.readFileSync(filename, 'utf8');
  const pattern = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[2].startsWith('.')) continue;
    const base = path.resolve(path.dirname(filename), match[2]);
    for (const candidate of [base, base + '.js', path.join(base, 'index.js')]) {
      targets.push(path.normalize(candidate));
    }
  }
  return targets;
}

describe('Mission 19 Part 4 Slice 2 legacy intelligence retirement', () => {
  test('the exact duplicate chain and its implementation-only tests are retired with canonical replacements retained', () => {
    expect(retiredProduction.filter(relative => fs.existsSync(absolute(relative)))).toEqual([]);
    expect(Object.keys(legacyTestDisposition).filter(relative => fs.existsSync(absolute(relative)))).toEqual([]);

    for (const replacementPaths of Object.values(legacyTestDisposition)) {
      for (const replacement of replacementPaths) {
        expect(fs.existsSync(absolute(replacement))).toBe(true);
      }
    }
  });

  test('the dependency guard detects a literal relative require of an absent retired module', () => {
    const probe = absolute('src/services/__slice2-retained-require-negative-control.js');
    const retiredTarget = path.normalize(absolute('src/services/intelligence.js'));

    expect(fs.existsSync(probe)).toBe(false);
    expect(fs.existsSync(retiredTarget)).toBe(false);

    try {
      fs.writeFileSync(probe, "'use strict';\nmodule.exports = require('./intelligence');\n", { flag: 'wx' });
      expect(relativeRequireTargets(probe)).toContain(retiredTarget);
    } finally {
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    }
  });

  test('no remaining production CommonJS dependency resolves to a retired module', () => {
    const retired = new Set(retiredProduction.map(relative => path.normalize(absolute(relative)).toLowerCase()));
    const references = [];
    for (const filename of javascriptFiles(path.join(root, 'src'))) {
      for (const target of relativeRequireTargets(filename)) {
        if (retired.has(target.toLowerCase())) {
          references.push({
            source: path.relative(root, filename).replace(/\\/g, '/'),
            target: path.relative(root, target).replace(/\\/g, '/'),
          });
        }
      }
    }
    expect(references).toEqual([]);
  });

  test('the real package entrypoint mounts canonical routes while retired module loads are fatal', () => {
    const child = String.raw`
      'use strict';
      const Module = require('module');
      const path = require('path');
      const request = require('supertest');
      const root = process.cwd();
      const retired = new Set(${JSON.stringify(retiredProduction)}.map(function (relative) {
        return path.normalize(path.join(root, ...relative.split('/'))).toLowerCase();
      }));
      const loaded = new Set();
      const externalDestinations = [];
      global.fetch = async function (url) {
        externalDestinations.push(String(url));
        throw new Error('External fetch is forbidden in the Slice 2 runtime proof');
      };
      const originalLoad = Module._load;
      Module._load = function (requestName, parent, isMain) {
        let resolved = null;
        try {
          resolved = Module._resolveFilename(requestName, parent, isMain);
        } catch (_error) {
          // Preserve Node's own resolution error through the original loader.
        }
        if (resolved && path.isAbsolute(resolved)) {
          const normalized = path.normalize(resolved).toLowerCase();
          if (retired.has(normalized)) {
            const error = new Error('Retired legacy intelligence module load attempted: ' + normalized);
            error.code = 'RETIRED_LEGACY_INTELLIGENCE_LOAD';
            throw error;
          }
          loaded.add(normalized);
        }
        return originalLoad.apply(this, arguments);
      };

      (async function () {
        const packageMetadata = require(path.join(root, 'package.json'));
        if (packageMetadata.main !== 'src/server.js') throw new Error('Unexpected package entrypoint');
        const server = require(path.join(root, packageMetadata.main));
        if (!server || !server.app) throw new Error('Production Express app was not exported');
        const canonicalResponse = await request(server.app).get('/api/v1/canonical/graphs');
        const contextResponse = await request(server.app).get('/api/v1/polaris/unified-context');
        if (canonicalResponse.status !== 401 || contextResponse.status !== 401) {
          throw new Error('Mounted canonical routes did not preserve the authentication boundary');
        }
        const canonicalRoute = path.normalize(path.join(root, 'src/routes/canonicalPolaris.js')).toLowerCase();
        const canonicalGraph = path.normalize(path.join(root, 'src/services/canonicalGraphService.js')).toLowerCase();
        if (!loaded.has(canonicalRoute) || !loaded.has(canonicalGraph)) {
          throw new Error('Production entrypoint did not load the canonical route and graph modules');
        }
        if (Array.from(retired).some(function (filename) { return loaded.has(filename); })) {
          throw new Error('Production entrypoint loaded retired legacy intelligence');
        }
        if (externalDestinations.length) throw new Error('A provider-shaped external destination was attempted');
        process.stdout.write('\nSLICE2_RESULT=' + JSON.stringify({
          canonicalStatus: canonicalResponse.status,
          contextStatus: contextResponse.status,
          canonicalRouteLoaded: true,
          canonicalGraphLoaded: true,
          retiredLoads: 0,
          externalDestinations,
        }) + '\n');
      }()).catch(function (error) {
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
      });
    `;

    const safeEnvironment = {
      COMSPEC: process.env.COMSPEC,
      NODE_ENV: 'test',
      NODE_NO_WARNINGS: '1',
      NODE_OPTIONS: '',
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      OPENAI_API_KEY: '',
      RETELL_API_KEY: '',
      RETELL_AGENT_ID: '',
      RETELL_PHONE_NUMBER: '',
      RETELL_WEBHOOK_SECRET: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_PHONE_NUMBER: '',
      GOOGLE_SHEETS_CLIENT_EMAIL: '',
      GOOGLE_SHEETS_PRIVATE_KEY: '',
      SMTP_PASS: '',
      RESEND_API_KEY: '',
      JOBBER_CLIENT_SECRET: '',
      STRIPE_SECRET_KEY: '',
    };
    const result = childProcess.spawnSync(process.execPath, ['-e', child], {
      cwd: root,
      encoding: 'utf8',
      env: safeEnvironment,
      timeout: 15000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect({ status: result.status, signal: result.signal, stderr: result.stderr }).toEqual({
      status: 0,
      signal: null,
      stderr: '',
    });
    const resultLine = result.stdout.split(/\r?\n/)
      .find(line => line.startsWith('SLICE2_RESULT='));
    expect(resultLine).toBeDefined();
    expect(JSON.parse(resultLine.slice('SLICE2_RESULT='.length))).toEqual({
      canonicalStatus: 401,
      contextStatus: 401,
      canonicalRouteLoaded: true,
      canonicalGraphLoaded: true,
      retiredLoads: 0,
      externalDestinations: [],
    });
  });

  test.each(retiredProduction)('direct load of retired contract fails: %s', relative => {
    expect(() => require(absolute(relative))).toThrow(expect.objectContaining({ code: 'MODULE_NOT_FOUND' }));
  });
});
