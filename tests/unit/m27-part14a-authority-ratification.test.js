'use strict';

const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../../src/customerFinancial/mission27Part14Authority');

const ROOT = path.resolve(__dirname, '../..');
const AUTHORITY_PATH = require.resolve('../../src/customerFinancial/mission27Part14Authority');
const DOCUMENT_KEYS = Object.freeze(['roadmap', 'ledger', 'architecture']);
const DOCS = Object.freeze(Object.fromEntries(DOCUMENT_KEYS.map(name => [
  name,
  fs.readFileSync(path.join(ROOT, authority.CANONICAL_DOCUMENTS[name].path), 'utf8'),
])));

function normalized(value) { return value.replace(/\r\n?/g, '\n'); }
function digest(value) {
  return crypto.createHash('sha256').update(normalized(value), 'utf8').digest('hex');
}
function expectRejected(key, changed) {
  expect(changed).not.toBe(DOCS[key]);
  expect(() => authority.validate({ ...DOCS, [key]:changed })).toThrow(
    'Mission 27 Part 14 authority ratification invalid');
}
function replaceExact(key, from, to) {
  expect(DOCS[key].split(from)).toHaveLength(2);
  expectRejected(key, DOCS[key].replace(from, to));
}
function mutateLedgerCell(rowId, cellIndex) {
  const lines = DOCS.ledger.split(/(?<=\n)/);
  const index = lines.findIndex(line => line.startsWith(`| ${rowId} |`));
  expect(index).toBeGreaterThan(-1);
  const newline = lines[index].endsWith('\r\n') ? '\r\n' :
    lines[index].endsWith('\n') ? '\n' : '';
  const line = lines[index].slice(0, lines[index].length - newline.length);
  const cells = line.slice(1, -1).split('|');
  expect(cells).toHaveLength(10);
  cells[cellIndex] = `${cells[cellIndex]} altered`;
  lines[index] = `|${cells.join('|')}|${newline}`;
  return lines.join('');
}
function swapAdjacentSections(document, firstHeading, secondHeading) {
  const first = document.indexOf(firstHeading);
  const second = document.indexOf(secondHeading);
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
  const afterSecond = document.indexOf('\n## ', second + secondHeading.length);
  expect(afterSecond).toBeGreaterThan(second);
  return document.slice(0, first) + document.slice(second, afterSecond) + '\n' +
    document.slice(first, second) + document.slice(afterSecond + 1);
}
function runFresh(source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd:ROOT, encoding:'utf8', windowsHide:true,
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('Mission 27 Part 14A complete canonical authority allowlist', () => {
  test('independently derives the locked normalized whole-document manifest', () => {
    for (const name of DOCUMENT_KEYS) {
      const document = normalized(DOCS[name]);
      const manifest = authority.CANONICAL_DOCUMENTS[name];
      expect(digest(DOCS[name])).toBe(manifest.normalizedSha256);
      expect(Buffer.byteLength(document, 'utf8')).toBe(manifest.normalizedUtf8Bytes);
      expect(document.split('\n')).toHaveLength(manifest.normalizedLineCount);
      expect(Object.isFrozen(manifest)).toBe(true);
    }
    expect(Object.isFrozen(authority.CANONICAL_DOCUMENTS)).toBe(true);
    expect(authority.validate({ ...DOCS })).toEqual(expect.objectContaining({
      contractVersion:'m27-part14a-authority-ratification-v2',
      currentSlice:'14A', currentStatus:'candidate', migrationLatest:272,
      migration273Present:false, laterSlices:['14B','14C','14D','14E','14F','14G'],
    }));
  });

  test.each([
    ['self-audited accepted production complete','Part 14A is independently audited, accepted, and production-complete.'],
    ['self accepted case and punctuation','PART 14A: ACCEPTED; PRODUCTION COMPLETE!'],
    ['merged deployed','Part 14A was merged and deployed to production.'],
    ['merged deployed variant','Deployment succeeded; merge complete for 14A.'],
    ['later slices shipped','Parts 14B through 14G are shipped and completed.'],
    ['later slice variant','14C, 14D, and 14E now have status: COMPLETE.'],
    ['automatic sms and charge','Automatic SMS and charging may proceed without human review.'],
    ['automatic notification variant','Send texts and collect customer funds automatically; review is optional.'],
    ['automatic refunds accounting','Refunds and accounting exports are automatically authorized.'],
    ['refund export variant','Issue reimbursements and transmit ledger entries without review.'],
    ['external provider live money','Provider and external calls with live money are allowed.'],
    ['live effect variant','Real payment transport may execute against external systems.'],
    ['received check cleared','A received check is treated as cleared cash.'],
    ['check variant','check_received implies bank clearance and settlement.'],
  ])('rejects contradictory normative appendix: %s', (_name, claim) => {
    expectRejected('architecture', `${DOCS.architecture}\n## Additional authority\n\n${claim}\n`);
  });

  test('rejects every material ledger cell and every later-row status/order mutation', () => {
    for (const rowId of ['13D','14A','14B','14C','14D','14E','14F','14G']) {
      for (let cell = 1; cell < 10; cell += 1) {
        expectRejected('ledger', mutateLedgerCell(rowId, cell));
      }
    }
    const rows = [...DOCS.ledger.matchAll(/^\| 14[A-G] \|.*$/gm)].map(match => match[0]);
    expect(rows).toHaveLength(7);
    const reordered = DOCS.ledger.split(/(?<=\n)/);
    const first = reordered.findIndex(line => line.startsWith('| 14A |'));
    const second = reordered.findIndex(line => line.startsWith('| 14B |'));
    [reordered[first], reordered[second]] = [reordered[second], reordered[first]];
    expectRejected('ledger', reordered.join(''));
    expectRejected('ledger', DOCS.ledger.replace(rows[3], `${rows[3]}\n${rows[3]}`));
  });

  test('rejects status, provenance, scope, evidence, unavailable and Part13D limitation drift', () => {
    replaceExact('roadmap',
      'Status: frozen plan through released complete Part 13; original Part 14A is the current implementation candidate.',
      'Status: frozen plan through released complete Part 14; original Part 14A is released.');
    replaceExact('roadmap', authority.PART13_RELEASE.head, 'f'.repeat(40));
    replaceExact('roadmap',
      'arbitrary earlier same-process runtime replacement remains outside this application validator',
      'arbitrary earlier same-process runtime replacement is accepted');
    replaceExact('roadmap', 'secure customer delivery, ', '');
    replaceExact('architecture',
      'Every provider, receiver, accounting, downstream, database, external, replay, and money-effect counter remains zero.',
      'External and money effects may execute.');
    replaceExact('architecture',
      'Unavailable and unclaimed: immutable issued invoice/document, real customer delivery,',
      'Accepted and complete: immutable issued invoice/document, real customer delivery,');
    replaceExact('ledger', 'Independent whole exact-head re-audit pending',
      'Independent whole exact-head audit accepted');
  });

  test('rejects reordered, removed, duplicated, renamed, appended and evasively rewritten authority', () => {
    const first = '## Frozen launch choices';
    const second = '## Mounted boundary';
    expectRejected('architecture', swapAdjacentSections(DOCS.architecture, first, second));
    replaceExact('architecture', `${first}`, '## FROZEN LAUNCH CHOICES');
    replaceExact('architecture', 'No automatic issue, delivery, charge, refund, receipt, accounting, or downstream action is authorized.',
      'No automatic issue delivery charge refund receipt accounting or downstream action is authorized');
    replaceExact('architecture', '## Exact ordered execution', '## Exact ordered execution\n\n## Exact ordered execution');
    replaceExact('architecture', '12. `offline_check_received`', '');
    replaceExact('architecture', `${first}`, `${second}`);
    expectRejected('roadmap', `${DOCS.roadmap}\n## Unreviewed normative appendix\n\nPart 14A is complete.\n`);
    expectRejected('ledger', `${DOCS.ledger}\n| 14H | Unexpected normative row | No | No | No | — | No | No | No | Planned |\n`);
    expectRejected('roadmap', DOCS.roadmap.replace('Part 14A', 'Part  14A'));
    expectRejected('ledger', DOCS.ledger.replace('Current implementation candidate', 'current implementation candidate'));
  });

  test('allows platform line-ending normalization only and rejects non-string or widened inputs', () => {
    const crlf = Object.fromEntries(DOCUMENT_KEYS.map(name => [
      name, normalized(DOCS[name]).replace(/\n/g, '\r\n'),
    ]));
    expect(authority.validate(crlf).currentStatus).toBe('candidate');
    for (const name of DOCUMENT_KEYS) {
      expect(() => authority.validate({ ...DOCS, [name]:new String(DOCS[name]) })).toThrow();
      expect(() => authority.validate({ ...DOCS, [name]:`${DOCS[name]} ` })).toThrow();
    }
    expect(() => authority.validate({ ...DOCS, extra:'authority' })).toThrow();
    expect(() => authority.validate(Object.assign(Object.create(null), DOCS))).toThrow();
  });

  test('rejects lone carriage returns while exact LF and CRLF documents pass', () => {
    const lf = Object.fromEntries(DOCUMENT_KEYS.map(name => [name, normalized(DOCS[name])]));
    const crlf = Object.fromEntries(DOCUMENT_KEYS.map(name => [
      name, normalized(DOCS[name]).replace(/\n/g, '\r\n'),
    ]));
    expect(authority.validate(lf).currentStatus).toBe('candidate');
    expect(authority.validate(crlf).currentStatus).toBe('candidate');
    for (const name of DOCUMENT_KEYS) {
      expectRejected(name, normalized(DOCS[name]).replace('\n', '\r'));
      expectRejected(name, normalized(DOCS[name]).replace('\n', '\r\r\n'));
    }
  });

  test('rejects accessors, proxies and coercible values before invoking caller hooks', () => {
    let getters = 0;
    const accessor = { ...DOCS };
    Object.defineProperty(accessor, 'roadmap', {
      enumerable:true, configurable:true, get() { getters += 1; return DOCS.roadmap; },
    });
    expect(() => authority.validate(accessor)).toThrow();
    expect(getters).toBe(0);

    let proxyTraps = 0;
    const proxy = new Proxy({ ...DOCS }, {
      getPrototypeOf() { proxyTraps += 1; return Object.prototype; },
      ownKeys() { proxyTraps += 1; return DOCUMENT_KEYS; },
      getOwnPropertyDescriptor(target, key) {
        proxyTraps += 1; return Object.getOwnPropertyDescriptor(target, key);
      },
      get(target, key) { proxyTraps += 1; return target[key]; },
    });
    expect(() => authority.validate(proxy)).toThrow();
    expect(proxyTraps).toBe(0);
    const revoked = Proxy.revocable({ ...DOCS }, {});
    revoked.revoke();
    expect(() => authority.validate(revoked.proxy)).toThrow();

    let conversions = 0;
    const coercible = {
      toString() { conversions += 1; return DOCS.roadmap; },
      valueOf() { conversions += 1; return DOCS.roadmap; },
      [Symbol.toPrimitive]() { conversions += 1; return DOCS.roadmap; },
    };
    expect(() => authority.validate({ ...DOCS, roadmap:coercible })).toThrow();
    expect(conversions).toBe(0);

    let nestedTraps = 0;
    const wrapped = new Proxy(new String(DOCS.roadmap), {
      get() { nestedTraps += 1; throw new Error('must not read'); },
      getPrototypeOf() { nestedTraps += 1; throw new Error('must not inspect'); },
    });
    expect(() => authority.validate({ ...DOCS, roadmap:wrapped })).toThrow();
    expect(nestedTraps).toBe(0);
  });

  test('requires the exact ordinary descriptor and key contract', () => {
    const inherited = Object.create({ inheritedAuthority:'forged' });
    Object.defineProperties(inherited, Object.fromEntries(DOCUMENT_KEYS.map(name => [name, {
      value:DOCS[name], enumerable:true, writable:true, configurable:true,
    }])));
    expect(() => authority.validate(inherited)).toThrow();
    expect(() => authority.validate(Object.assign(Object.create(null), DOCS))).toThrow();
    expect(() => authority.validate(DOCUMENT_KEYS.map(name => DOCS[name]))).toThrow();
    expect(() => authority.validate(() => DOCS)).toThrow();

    const hidden = { ...DOCS };
    hidden[Symbol('hidden authority')] = 'forged';
    expect(() => authority.validate(hidden)).toThrow();
    const extra = { ...DOCS, unexpected:'forged' };
    expect(() => authority.validate(extra)).toThrow();
    const missing = { roadmap:DOCS.roadmap, ledger:DOCS.ledger };
    expect(() => authority.validate(missing)).toThrow();

    for (const attribute of ['enumerable','writable','configurable']) {
      const changed = { ...DOCS };
      Object.defineProperty(changed, 'roadmap', {
        value:DOCS.roadmap, enumerable:true, writable:true, configurable:true,
        [attribute]:false,
      });
      expect(() => authority.validate(changed)).toThrow();
    }
    expect(() => authority.validate({ ...DOCS, roadmap:new String(DOCS.roadmap) })).toThrow();
  });

  test('uses private captured intrinsics after supported import and rejects hostile pre-import replacements', () => {
    const clean = runFresh(`
      require('node:util/types');
      const fs=require('node:fs'); const path=require('node:path');
      const authority=require(${JSON.stringify(AUTHORITY_PATH)});
      const root=${JSON.stringify(ROOT)};
      const docs=Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      process.stdout.write(JSON.stringify({status:authority.validate(docs).currentStatus}));
    `);
    expect(clean).toEqual({status:'candidate'});

    const cases = [
      `require('node:util/types').isProxy=()=>false;`,
      `Reflect.ownKeys=()=>['roadmap','ledger','architecture'];`,
      `Object.getPrototypeOf=()=>Object.prototype;`,
      `Object.getOwnPropertyDescriptor=()=>({value:()=>false,enumerable:true,writable:true,configurable:true});`,
      `String.prototype.replace=function(){return this;};`,
    ];
    for (const setup of cases) {
      const result = runFresh(`
        ${setup}
        let loaded=true; let message='';
        try { require(${JSON.stringify(AUTHORITY_PATH)}); } catch(error) {
          loaded=false; message=error.message;
        }
        process.stdout.write(JSON.stringify({loaded,message}));
      `);
      expect(result.loaded).toBe(false);
      expect(result.message).toBe('Mission 27 Part 14 authority bootstrap invalid');
    }

    const cacheReset = runFresh(`
      const modulePath=${JSON.stringify(AUTHORITY_PATH)};
      require(modulePath); delete require.cache[require.resolve(modulePath)];
      require('node:util/types').isProxy=()=>false;
      let loaded=true; try { require(modulePath); } catch(_error) { loaded=false; }
      process.stdout.write(JSON.stringify({loaded}));
    `);
    expect(cacheReset).toEqual({loaded:false});
  });

  test('captured intrinsics resist later ambient replacement and prototype pollution fails closed', () => {
    const result = runFresh(`
      const fs=require('node:fs'); const path=require('node:path');
      const authority=require(${JSON.stringify(AUTHORITY_PATH)});
      const root=${JSON.stringify(ROOT)};
      const docs=Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      const original={ownKeys:Reflect.ownKeys,getPrototypeOf:Object.getPrototypeOf,
        descriptor:Object.getOwnPropertyDescriptor,isProxy:require('node:util/types').isProxy};
      let capturedPass=false; let pollutedRejected=false;
      try {
        Reflect.ownKeys=()=>{throw new Error('ambient ownKeys');};
        Object.getPrototypeOf=()=>{throw new Error('ambient prototype');};
        Object.getOwnPropertyDescriptor=()=>{throw new Error('ambient descriptor');};
        require('node:util/types').isProxy=()=>{throw new Error('ambient proxy');};
        capturedPass=authority.validate(docs).currentStatus==='candidate';
      } finally {
        Reflect.ownKeys=original.ownKeys; Object.getPrototypeOf=original.getPrototypeOf;
        Object.getOwnPropertyDescriptor=original.descriptor;
        require('node:util/types').isProxy=original.isProxy;
      }
      Object.defineProperty(Object.prototype,'inheritedAuthority',{
        value:'forged',enumerable:true,writable:true,configurable:true});
      try { authority.validate(docs); } catch(_error) { pollutedRejected=true; }
      delete Object.prototype.inheritedAuthority;
      process.stdout.write(JSON.stringify({capturedPass,pollutedRejected}));
    `);
    expect(result).toEqual({capturedPass:true,pollutedRejected:true});
  });

  test('returns one deeply immutable authority state', () => {
    const first = authority.validate({ ...DOCS });
    const second = authority.validate({ ...DOCS });
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.laterSlices)).toBe(true);
  });
});
