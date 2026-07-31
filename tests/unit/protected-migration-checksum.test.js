'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  PROTECTED_LEGACY_MIGRATION_CHECKSUMS,
  canonicalizeMigrationChecksumBytes,
  loadMigrations,
} = require('../../src/db');

const ROOT = path.resolve(__dirname, '../..');
const MERGED_MAIN_SHA = '4618ebcc9386f56655c9fd4bec612d0881fcca51';
const AUTHORITATIVE_PROTECTED = Object.freeze([
  ['001_initial_schema.sql', 15275, '74ee47a852a376c3f5f8b2a5bf24579d24eb6a20dc8284e8b233a0159e858c14', 'dbbcad4947474777a61a3b230aa8aca54b9a3ef4257301368e39731fa05307e9'],
  ['002_seed_data.sql', 3973, '370b2b2cd466817724f4788e104adef3f93d3d8a02bd877f252d1e3d6f588cd5', '4b124ac5713caaddc4f2316e8c055c6235eb17881c5b4ba5d0edef481a8a63ff'],
  ['003_voice_sessions.sql', 2729, '535a47115df60e96a7d18d8b7c557b378aa18391a19eb658750f86faa18d1e1f', 'd37d402df2792a015b6d1f9d3e0f72226298f9a4d9ec7551f629e52c677f41c2'],
  ['004_canonical_persistence_v2.sql', 14771, '097f398d0bf37982947d35b04890c396dee2d84ce8acdb34fa5434e13ba1263a', '946b1819dd4c5205637e9fae91f3b36c28c1688e401f1f2f5b67ffba7d2e1651'],
  ['005_canonical_organization_authority.sql', 4518, 'b45c61d2da94d6aba753d3d2bbd1ebf657af4626ff1bcbabd2e45434e0e529f6', '4065d873dd204935cfbd8ea8abe45d2b0b44e80df38ef203359d2863d37c5379'],
  ['006_canonical_voice_sessions.sql', 3840, 'acde20fd0cfa4ef8e8899f036cac4dd82d9052c12c50cec28014c2ac3cc0daf7', '236809d3b87367804bbd6c28ccaaca27408fa340020ab3d3b48e3e81da203ec2'],
  ['007_canonical_tax_authority.sql', 1201, 'c1838c6ea7cd83d12d2b9c3f9bf7740f0c5344d21f06873968527ad1318ac5a0', 'a5f2c8c78fc339790f2993c997ea2cd50134a9ed97de93267cd470b18ea408a6'],
  ['008_canonical_demo_authority.sql', 647, 'a71a0c49be60943ee52e041139c9db3b64c64cbeaf4449dec46571c721fbd1e0', 'c157ac2c10f07bf933b4774ac14584ecc580f93108926b5e53acbfed28263ef2'],
  ['009_canonical_voice_provider_identity.sql', 463, 'a521efdcf96cd90d11e505018f034fd2b93a4998da97823491b5195aa78aef98', '6ec531dbb385607818c4a70ae69bab7f5d85ff98565d61ad8026c20ef68634fe'],
]);

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function runGit(executable, args, options = {}) {
  const result = spawnSync(
    executable,
    ['-c', `safe.directory=${ROOT.replace(/\\/g, '/')}`, '-C', ROOT, ...args],
    { encoding: null, maxBuffer: 16 * 1024 * 1024, shell: false, windowsHide: true }
  );
  if (result.error) throw new Error(`Required Git executable failed: ${result.error.message}`);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : '';
  if (!options.allowFailure && (result.status !== 0 || /\bfatal:/i.test(stderr))) {
    throw new Error(`Required Git command failed with exit ${result.status}`);
  }
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ''),
  };
}

function readGitBlob(repositoryPath) {
  const executable = process.env.M19_GIT_EXECUTABLE || 'git';
  const result = runGit(executable, ['cat-file', 'blob', `${MERGED_MAIN_SHA}:${repositoryPath}`]);
  if (result.stdout.length === 0) throw new Error('Required Git blob is empty');
  return result.stdout;
}

function completeCrlfCheckout(lfBytes) {
  const output = [];
  for (const byte of lfBytes) {
    if (byte === 0x0a) output.push(0x0d);
    output.push(byte);
  }
  return Buffer.from(output);
}

function loadSingleMigration(filename, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-checksum-contract-'));
  try {
    fs.writeFileSync(path.join(directory, filename), contents);
    return loadMigrations(directory)[0];
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function alterOneNonNewlineByte(contents) {
  const altered = Buffer.from(contents);
  const offset = altered.findIndex(byte => byte !== 0x0a && byte !== 0x0d);
  if (offset < 0) throw new Error('Fixture has no alterable byte');
  altered[offset] ^= 0x01;
  return altered;
}

function insertAt(contents, offset, addition) {
  return Buffer.concat([contents.subarray(0, offset), Buffer.from(addition), contents.subarray(offset)]);
}

describe('protected migration checksum authority', () => {
  test('raw Git blobs define the exact immutable LF authority for migrations 001-009', () => {
    const observed = {};
    for (const [filename, length, lfHash, crlfHash] of AUTHORITATIVE_PROTECTED) {
      const lfBytes = readGitBlob(`migrations/${filename}`);
      expect(lfBytes).toHaveLength(length);
      expect(sha256(lfBytes)).toBe(lfHash);
      expect(sha256(completeCrlfCheckout(lfBytes))).toBe(crlfHash);
      expect(PROTECTED_LEGACY_MIGRATION_CHECKSUMS[filename]).toBe(lfHash);
      expect(PROTECTED_LEGACY_MIGRATION_CHECKSUMS[filename]).not.toBe(crlfHash);
      observed[filename] = lfHash;
    }
    expect(PROTECTED_LEGACY_MIGRATION_CHECKSUMS).toEqual(observed);
  });

  test('provenance fails closed when the configured Git executable is unavailable', () => {
    expect(() => runGit(
      path.join(os.tmpdir(), 'northstar-git-does-not-exist'),
      ['cat-file', 'blob', `${MERGED_MAIN_SHA}:migrations/001_initial_schema.sql`]
    )).toThrow('Required Git executable failed');
  });

  test('provenance fails closed when genuine Git history is unavailable', () => {
    const executable = process.env.M19_GIT_EXECUTABLE || 'git';
    expect(() => runGit(executable, [
      'cat-file',
      'blob',
      `0000000000000000000000000000000000000000:migrations/001_initial_schema.sql`,
    ])).toThrow('Required Git command failed');
  });

  describe.each(AUTHORITATIVE_PROTECTED)('%s', (filename, length, lfHash) => {
    test('accepts the exact LF Git bytes', () => {
      const lfBytes = readGitBlob(`migrations/${filename}`);
      expect(lfBytes).toHaveLength(length);
      expect(loadSingleMigration(filename, lfBytes).digest).toBe(lfHash);
    });

    test('accepts only complete CRLF checkout conversion and emits the LF digest', () => {
      const lfBytes = readGitBlob(`migrations/${filename}`);
      const crlfBytes = completeCrlfCheckout(lfBytes);
      const migration = loadSingleMigration(filename, crlfBytes);
      expect(migration.digest).toBe(lfHash);
      expect(sha256(canonicalizeMigrationChecksumBytes(crlfBytes))).toBe(lfHash);
    });

    test('rejects one-byte alterations in both LF and CRLF representations', () => {
      const lfBytes = readGitBlob(`migrations/${filename}`);
      expect(() => loadSingleMigration(filename, alterOneNonNewlineByte(lfBytes)))
        .toThrow(`Protected legacy migration checksum mismatch: ${filename}`);
      expect(() => loadSingleMigration(filename, alterOneNonNewlineByte(completeCrlfCheckout(lfBytes))))
        .toThrow(`Protected legacy migration checksum mismatch: ${filename}`);
    });
  });

  test('rejects mixed LF/CRLF and lone carriage returns before migration execution', () => {
    const filename = '003_voice_sessions.sql';
    const lfBytes = readGitBlob(`migrations/${filename}`);
    const firstLf = lfBytes.indexOf(0x0a);
    expect(firstLf).toBeGreaterThanOrEqual(0);
    const mixed = insertAt(lfBytes, firstLf, [0x0d]);
    const loneCr = Buffer.from(lfBytes);
    loneCr[firstLf] = 0x0d;
    expect(() => loadSingleMigration(filename, mixed)).toThrow('Migration has unsupported line endings');
    expect(() => loadSingleMigration(filename, loneCr)).toThrow('Migration has unsupported line endings');
  });

  test('rejects BOM, final-newline, trailing-space, whitespace, comment, and ordering alterations', () => {
    const withFinalNewlineName = '003_voice_sessions.sql';
    const withFinalNewline = readGitBlob(`migrations/${withFinalNewlineName}`);
    expect(withFinalNewline.at(-1)).toBe(0x0a);
    expect(() => loadSingleMigration(withFinalNewlineName, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), withFinalNewline])))
      .toThrow('Protected legacy migration checksum mismatch');
    expect(() => loadSingleMigration(withFinalNewlineName, withFinalNewline.subarray(0, -1)))
      .toThrow('Protected legacy migration checksum mismatch');

    const withoutFinalNewlineName = '001_initial_schema.sql';
    const withoutFinalNewline = readGitBlob(`migrations/${withoutFinalNewlineName}`);
    expect(withoutFinalNewline.at(-1)).not.toBe(0x0a);
    expect(() => loadSingleMigration(withoutFinalNewlineName, Buffer.concat([withoutFinalNewline, Buffer.from('\n')])))
      .toThrow('Protected legacy migration checksum mismatch');

    const firstLf = withFinalNewline.indexOf(0x0a);
    expect(() => loadSingleMigration(withFinalNewlineName, insertAt(withFinalNewline, firstLf, Buffer.from(' '))))
      .toThrow('Protected legacy migration checksum mismatch');

    const removedWhitespaceOffset = withoutFinalNewline.indexOf(0x20);
    const removedWhitespace = Buffer.concat([
      withoutFinalNewline.subarray(0, removedWhitespaceOffset),
      withoutFinalNewline.subarray(removedWhitespaceOffset + 1),
    ]);
    expect(() => loadSingleMigration(withoutFinalNewlineName, removedWhitespace))
      .toThrow('Protected legacy migration checksum mismatch');
    expect(sha256(canonicalizeMigrationChecksumBytes(Buffer.from('-- comment \n'))))
      .not.toBe(sha256(canonicalizeMigrationChecksumBytes(Buffer.from('-- comment\n'))));

    const commentOffset = withoutFinalNewline.indexOf(Buffer.from('--')) + 2;
    expect(commentOffset).toBeGreaterThan(1);
    const alteredComment = Buffer.from(withoutFinalNewline);
    alteredComment[commentOffset] ^= 0x01;
    expect(() => loadSingleMigration(withoutFinalNewlineName, alteredComment))
      .toThrow('Protected legacy migration checksum mismatch');

    const lines = withFinalNewline.toString('utf8').split('\n');
    [lines[1], lines[2]] = [lines[2], lines[1]];
    expect(() => loadSingleMigration(withFinalNewlineName, Buffer.from(lines.join('\n'))))
      .toThrow('Protected legacy migration checksum mismatch');
  });

  test('rejects added content, deleted content, and an empty protected file', () => {
    const filename = '001_initial_schema.sql';
    const lfBytes = readGitBlob(`migrations/${filename}`);
    expect(() => loadSingleMigration(filename, Buffer.concat([lfBytes, Buffer.from(' ')])))
      .toThrow('Protected legacy migration checksum mismatch');
    expect(() => loadSingleMigration(filename, lfBytes.subarray(0, -1)))
      .toThrow('Protected legacy migration checksum mismatch');
    expect(() => loadSingleMigration(filename, Buffer.alloc(0)))
      .toThrow('Protected legacy migration checksum mismatch');
  });

  test.each(['010_account_session_authority.sql', '011_oauth_authorization_states.sql'])(
    '%s has one canonical ledger checksum across LF and CRLF checkouts',
    filename => {
      const lfBytes = readGitBlob(`migrations/${filename}`);
      const expected = sha256(lfBytes);
      expect(loadSingleMigration(filename, lfBytes).digest).toBe(expected);
      expect(loadSingleMigration(filename, completeCrlfCheckout(lfBytes)).digest).toBe(expected);
    }
  );

  test('future migrations use the same canonical LF ledger checksum without Git at runtime', () => {
    const lfBytes = Buffer.from('-- future migration\nSELECT 1;\n');
    const expected = sha256(lfBytes);
    expect(loadSingleMigration('012_future_migration.sql', lfBytes).digest).toBe(expected);
    expect(loadSingleMigration('012_future_migration.sql', completeCrlfCheckout(lfBytes)).digest).toBe(expected);
  });
});
