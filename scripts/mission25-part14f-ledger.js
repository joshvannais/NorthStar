#!/usr/bin/env node
// Rebuild or verify the immutable, pre-release Mission 25 audit inventory.
// All file hashes are taken from the independently accepted Part 14E Git tree.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const acceptedBase = '1cd897242fe77d7c4610bd882a7da1e019fc890a';
const knownNonpassing = [
  { id: 'm23-part9b-overview', test: 'tests/integration/m23-part9b-overview-postgres.test.js',
    observation: 'Part 13D accepted-base and candidate: 15 failures; Part 14F selected fixture still fails with SQLSTATE 42501.' },
  { id: 'm25-part11f-heading', test: 'tests/ratification/m25-part11f-imported-material-calibration.test.js',
    observation: 'Current Part 14F: 6 passed, 1 stale documentation-heading assertion failed.' },
  { id: 'm25-part9f-route-literal', test: 'tests/ratification/m25-part9f-travel-learning-center.test.js',
    observation: 'Independent Part 14F: 3 passed, 1 inherited stale route-literal assertion failed.' },
  { id: 'm20-phase6a-timing', test: 'tests/api/m20-phase6a-retell-webhook-containment-postgres.test.js',
    observation: 'Accepted Part 14D base/head: 46 passed, 1 terminal-call fixture timing failure; not rerun in Part 14F.' },
];
const parts = {
  '1': 'bd7459eec4d3845dae4c0e33ddfbfd5b80c8e484',
  '2': 'e28ed583c7d4fea30902f0b5459a3acbafcd299c',
  '3': '9b34b94e32e150ec358cf82c35ed08e844dc050f',
  '4': '00d7c2d3376083dc86f4807560b7f2c8ef4ffc26',
  '5': '98913f28cd83321875cb9a67abed81d3ad035a75',
  '6': 'e155f27ce1ac23bcbe8a18650a8e405c7bf19a27',
  '7': '0dfa96dddba11e53abf2cffeee4a168216e3b3bc',
  '8': 'a1a1fab5be23b9c4e3abc21d8ad8baed35a4ee42',
  '9A': '1b9717c76f4becc441af1dec66838d74fe2f523d',
  '9B': '173061ef76b4c9e7c91bc839c95b7e85ef80bb35',
  '9C': 'f9e86aa97eaf15e177b3e142e055ab3702c7c0a5',
  '9D': '694053d4d2f2842ad38313f613dd5810f136e72b',
  '9E': '13181dbf00266d9f82ca72607710af9b85a488b6',
  '9F': '78a8a7bcca2f61ac0f5d1f49974911cdf83901f7',
  '10A': '21b2a3003367311b03fd5df2a21a67004f28d150',
  '10B': '2380fe4285e0b27b1bb3fea0fb324504c20e5262',
  '10C': '1c13c82fecfe6e6a5699e3b30a4790c9ea8b135e',
  '10D': 'fa5b99462bb4c068b5f6aabe74beb6958785958b',
  '10E': '9c082e5d1f4e008d4bac04207d5d29703d0509d9',
  '10F': '63e9c84159cf66cee1082d421e634a865cf0d082',
  '10G': 'adfc9a9e51d44b90a7d57f7f6ff14c905ac62dbe',
  '10H': '8f6af4c2a3654d2e1b9a1e2246d35b6933838cad',
  '11A': '82ceac0be5ca4169a5bbd5dcf681a498a3ad5415',
  '11B': 'a06968bad9620de8199286d7011bce511ea43a39',
  '11C': '5befa1351f0b64e46e028dcdb5f6ce1f0c41f005',
  '11D': 'b0f859aa2b96a75721f207925e8e58cf85655c13',
  '11E': '1effdbc5768efe091d788dda544a37084f65cd7c',
  '11F': '410c7c5ddaf73a6962c0f2d44e64fb6d1b5a1ff3',
  '11G': '6a287257503278982c2225ef4a1e345dff9a93d1',
  '11H': '97a08a9733a3f7f0fb19465f418a58a927c2158d',
  '12A': '1be699f1fc855d2570df9f9930d3a78667a1990e',
  '12B': 'ff26d626b0ac111d93ed43fb641465cd4d0995c2',
  '12C': '8a238ba1f0f95fbcee44ae9cedcaabe6d8edbe2a',
  '12D': 'ffd9b73cc377daa2f1daf1dbc510adf4caa356a5',
  '12E': 'd8c2492a72b95d667064ef23fe63e04ab084be4e',
  '12F': '24e135c9a7ac67401ec255155009684b536fb8b8',
  '12G': 'e4909a961cecd5be260b1bfa3a4fb7dcca1d80f4',
  '12H': 'a7bb05a5ea159ea11fd09005cac9e9df8abddc63',
  '12I': '0d901e96af34725ad5d6442d65d90b2d791bc3ba',
  '12J': 'f8a3dac3c3433f05d398b597395b7575fcf34a47',
  '12K': '04f1bcd2b486e49fbfc0e04052c2170b634344f5',
  '13A': 'e7d40ef2a089d763ea7d08bf5bb7b30e7b753eab',
  '13B': '871d46014ea91377ed03957d3547d880a59229e1',
  '13C': 'b4267f035a70d41b21de375c0e4f078d97f2f68d',
  '13D': '5ea498ea696234e4aa0a422851107b0fe5ff3e80',
  '13E': '48658790426cf0ec82ab40d8572c25ecc81f18ee',
  '13F': 'b0b1999f0aa049013dc009e718baf6f7e380366c',
  '13G': 'fe6560219d2fd101d0bcae0e333aad01915ef3d0',
  '13H': '8db556abfeec3af9d8eb4244da5822e3eea0c3e2',
  '14A': '444897cbd7c588873c33bc95ec6d8bde6544f731',
  '14B': '3f1a6cefd3cf3c2b759d424ed98380cae1d3a45b',
  '14C': 'aec53dd6d7f3058c2830a8ba2f7bcaf50f29cb8b',
  '14D': '19d341c9bf23bae77eb117e698b180a6c3f3d8d8',
  '14E': acceptedBase,
};

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitBytes(spec) {
  return execFileSync('git', ['show', spec], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactArtifact(file) {
  const acceptedBytes = gitBytes(`${acceptedBase}:${file}`);
  if (sha256(readFileSync(path.join(root, file))) !== sha256(acceptedBytes)) {
    throw new Error(`Accepted artifact changed in candidate: ${file}`);
  }
  return {
    file,
    gitBlob: git('rev-parse', `${acceptedBase}:${file}`),
    sha256: sha256(acceptedBytes),
  };
}

function assertCoverage(ledger, acceptancePaths, requiredNonpassingIds) {
  const listed = ledger.evidence.map(item => item.file);
  if (new Set(listed).size !== listed.length ||
      JSON.stringify(listed) !== JSON.stringify([...acceptancePaths].sort())) {
    throw new Error('Acceptance-document inventory is incomplete, duplicated or out of order');
  }
  const exclusions = ledger.knownNonpassing.map(item => item.id);
  if (new Set(exclusions).size !== exclusions.length ||
      JSON.stringify(exclusions) !== JSON.stringify(requiredNonpassingIds)) {
    throw new Error('Known nonpassing regression inventory is incomplete or duplicated');
  }
}

function build() {
  if (git('rev-parse', acceptedBase) !== acceptedBase) throw new Error('Accepted base is missing');
  if (git('merge-base', acceptedBase, 'HEAD') !== acceptedBase) throw new Error('Candidate is not based on accepted 14E');
  const allowedCandidatePaths = new Set([
    'docs/roadmap/MISSION_25_OUTCOME_LEARNING.md',
    'docs/evidence/MISSION_25_PART14F_AUDIT_HANDOFF.md',
    'docs/evidence/MISSION_25_PART14F_IMMUTABLE_LEDGER.json',
    'scripts/mission25-part14f-ledger.js',
    'tests/ratification/m25-part14f-audit-ledger.test.js',
  ]);
  const changedPaths = git('diff', '--name-only', acceptedBase, 'HEAD').split(/\r?\n/).filter(Boolean);
  for (const file of changedPaths) {
    if (!allowedCandidatePaths.has(file)) throw new Error(`Unexpected Part 14F candidate path: ${file}`);
  }
  let previous = null;
  for (const [part, head] of Object.entries(parts)) {
    if (git('merge-base', head, acceptedBase) !== head) throw new Error(`${part} is outside the accepted base`);
    if (previous && git('merge-base', previous, head) !== previous) {
      throw new Error(`${part} breaks serialized ancestry after ${previous}`);
    }
    previous = head;
  }
  if (Object.keys(parts).length !== 54) throw new Error('Expected 54 accepted parts/slices through 14E');
  const migrationPaths = git('ls-tree', '-r', '--name-only', acceptedBase, 'migrations').split(/\r?\n/)
    .filter(p => /^migrations\/\d{3}_.+\.sql$/.test(p));
  if (migrationPaths.length !== 133) throw new Error(`Expected 133 migration files; found ${migrationPaths.length}`);
  const numbers = migrationPaths.map(p => Number(path.posix.basename(p).slice(0, 3)));
  // Historical filenames 013 and 014 do not exist in the accepted repository.
  const expectedNumbers = [...Array.from({ length: 12 }, (_, i) => i + 1),
    ...Array.from({ length: 121 }, (_, i) => i + 15)];
  if (numbers.some((number, i) => number !== expectedNumbers[i])) {
    throw new Error('Migration filenames differ from the accepted 001–012, 015–135 inventory');
  }
  const evidencePaths = git('ls-tree', '-r', '--name-only', acceptedBase, 'docs').split(/\r?\n/)
    .filter(p => /^docs\/.*\/MISSION_25_.*_ACCEPTANCE\.md$/.test(p)).sort();
  if (evidencePaths.length !== 29 ||
      !evidencePaths.includes('docs/roadmap/MISSION_25_PART13H_ACCEPTANCE.md')) {
    throw new Error('Expected 29 source-controlled Mission 25 acceptance documents across docs');
  }
  const ledger = {
    schema: 1,
    acceptedBase,
    status: 'Accepted through Part 14E; Part 14F independent audit and Part 14G release remain pending',
    parts,
    migrationCount: migrationPaths.length,
    migrations: migrationPaths.map(exactArtifact),
    evidence: evidencePaths.map(exactArtifact),
    knownNonpassing,
    broadRegression: { suitesPassed: 38, suitesFailed: 1, testsPassed: 168, testsFailed: 1 },
  };
  assertCoverage(ledger, evidencePaths, knownNonpassing.map(item => item.id));
  return ledger;
}

const target = path.join(root, 'docs/evidence/MISSION_25_PART14F_IMMUTABLE_LEDGER.json');
if (require.main === module) {
  const expected = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--write')) {
    writeFileSync(target, expected);
    process.stdout.write(`Wrote ${path.relative(root, target)}\n`);
  } else {
    if (readFileSync(target, 'utf8') !== expected) throw new Error('Mission 25 Part 14F ledger drift');
    process.stdout.write('Mission 25 accepted-head ancestry, 133 migration blobs and 29 acceptance hashes verified\n');
  }
}

module.exports = { assertCoverage, build, knownNonpassing };
