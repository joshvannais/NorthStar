'use strict';

const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const authority = require('../../src/customerFinancial/mission27Part14Authority');

const ROOT = path.resolve(__dirname, '../..');
const AUTHORITY_PATH = require.resolve('../../src/customerFinancial/mission27Part14Authority');
const DOCUMENT_KEYS = Object.freeze(['roadmap', 'ledger', 'architecture14A', 'architecture14B']);
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

describe('Mission 27 Part 14B complete canonical authority allowlist', () => {
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
      contractVersion:'m27-part14b-authority-ratification-v1',
      currentSlice:'14B', currentStatus:'candidate', migrationLatest:272,
      migration273Present:false, laterSlices:['14C','14D','14E','14F','14G'],
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
    expectRejected('architecture14B', `${DOCS.architecture14B}\n## Additional authority\n\n${claim}\n`);
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
      'Status: frozen plan through released Part 14A; original Part 14B was accepted and merged, and its ninth bounded source-only OCI-helper correction is the current implementation candidate.',
      'Status: frozen plan through released complete Part 14; original Part 14B is released.');
    replaceExact('roadmap', authority.PART13_RELEASE.head, 'f'.repeat(40));
    replaceExact('roadmap', authority.PART14A_RELEASE.head, 'e'.repeat(40));
    replaceExact('roadmap',
      'arbitrary earlier same-process runtime replacement remains outside this application validator',
      'arbitrary earlier same-process runtime replacement is accepted');
    replaceExact('roadmap', 'secure customer delivery, ', '');
    replaceExact('architecture14A',
      'Every provider, receiver, accounting, downstream, database, external, replay, and money-effect counter remains zero.',
      'External and money effects may execute.');
    replaceExact('architecture14A',
      'Unavailable and unclaimed: immutable issued invoice/document, real customer delivery,',
      'Accepted and complete: immutable issued invoice/document, real customer delivery,');
    replaceExact('architecture14B',
      'Status: accepted at head `5dc2a257b42bd2c08e7bd9ab45a2f9ed8e0720f3`, tree `2c11c575f6d0a5171981be681fd5978d8f4bbd35`, and normally merged as PR #535 to exact main `667befdbf06a26cd3416bce5f6d25ab124287c9e`.',
      'Status: released, deployed, and production complete.');
    replaceExact('architecture14B',
      'Offline cash remains `offline_received`. A received check remains `check_clearance_unknown`; the disabled clearance transition remains `check_clearance_authority_unavailable`.',
      'Offline cash and checks are both cleared settlement.');
    replaceExact('architecture14B',
      'Part 14B performs zero provider calls or mutations, receiver mutations, outbound messages, accounting mutations, downstream mutations, paid-repository reads, production-database mutations, or live-money movements.',
      'Part 14B may call providers, receivers, accounting, paid repositories, and move money.');
    replaceExact('ledger', 'Accepted; no P0–P3 at head `5dc2a257b42bd2c08e7bd9ab45a2f9ed8e0720f3`',
      'Accepted, released, deployed, and production complete');
  });

  test('rejects reordered, removed, duplicated, renamed, appended and evasively rewritten authority', () => {
    const first = '## Frozen launch choices';
    const second = '## Mounted boundary';
    expectRejected('architecture14A', swapAdjacentSections(DOCS.architecture14A, first, second));
    replaceExact('architecture14A', `${first}`, '## FROZEN LAUNCH CHOICES');
    replaceExact('architecture14A', 'No automatic issue, delivery, charge, refund, receipt, accounting, or downstream action is authorized.',
      'No automatic issue delivery charge refund receipt accounting or downstream action is authorized');
    replaceExact('architecture14A', '## Exact ordered execution', '## Exact ordered execution\n\n## Exact ordered execution');
    replaceExact('architecture14A', '12. `offline_check_received`', '');
    replaceExact('architecture14A', `${first}`, `${second}`);
    expectRejected('architecture14B', swapAdjacentSections(DOCS.architecture14B,
      '## Authority', '## Isolation and reset contract'));
    replaceExact('architecture14B', '## HTTP and browser boundary', '## Browser boundary');
    replaceExact('architecture14B', 'The projection covers, in order,',
      'The projection may cover, in any order,');
    expectRejected('roadmap', `${DOCS.roadmap}\n## Unreviewed normative appendix\n\nPart 14A is complete.\n`);
    expectRejected('ledger', `${DOCS.ledger}\n| 14H | Unexpected normative row | No | No | No | — | No | No | No | Planned |\n`);
    expectRejected('roadmap', DOCS.roadmap.replace('Part 14A', 'Part  14A'));
    expectRejected('ledger', DOCS.ledger.replace('source-only release correction', 'source only release correction'));
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
      `Object.freeze=value=>value;`,
      `String.prototype.charCodeAt=function(){return 65;};`,
      `require('node:crypto').createHash=()=>{throw new Error('hostile createHash');};`,
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

  test('normalization and hashing never dispatch through post-import ambient hooks', () => {
    const result = runFresh(`
      'use strict';
      const fs=require('node:fs'); const path=require('node:path');
      const authority=require(${JSON.stringify(AUTHORITY_PATH)});
      const root=${JSON.stringify(ROOT)};
      const docs=Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      const altered={...docs,architecture14B:docs.architecture14B+'\\nforged authority\\n'};
      const crypto=require('node:crypto');
      const counts={crypto:0,buffer:0,bufferObject:0,regexp:0,replace:0,charCode:0,apply:0,
        getPrototypeOf:0,descriptor:0};
      crypto.createHash=()=>{counts.crypto+=1; throw new Error('ambient crypto');};
      Buffer.byteLength=()=>{counts.buffer+=1; throw new Error('ambient buffer');};
      global.Buffer=new Proxy(function(){},{get(){counts.bufferObject+=1;
        throw new Error('ambient Buffer object');}});
      RegExp.prototype[Symbol.replace]=()=>{counts.regexp+=1; throw new Error('ambient regexp');};
      String.prototype.replace=()=>{counts.replace+=1; throw new Error('ambient replace');};
      String.prototype.charCodeAt=()=>{counts.charCode+=1; throw new Error('ambient charCodeAt');};
      Reflect.apply=()=>{counts.apply+=1; throw new Error('ambient apply');};
      Object.getPrototypeOf=()=>{counts.getPrototypeOf+=1; throw new Error('ambient prototype');};
      Object.getOwnPropertyDescriptor=()=>{counts.descriptor+=1; throw new Error('ambient descriptor');};
      let canonical=false; let alteredRejected=false;
      try { canonical=authority.validate(docs).currentStatus==='candidate'; } catch(_error) {}
      try { authority.validate(altered); } catch(_error) { alteredRejected=true; }
      process.stdout.write(JSON.stringify({canonical,alteredRejected,counts}));
    `);
    expect(result).toEqual({canonical:true, alteredRejected:true, counts:{
      crypto:0, buffer:0, bufferObject:0, regexp:0, replace:0, charCode:0, apply:0,
      getPrototypeOf:0, descriptor:0,
    }});
  });

  test('authenticates update and digest before descriptor-identical hostile methods can run', () => {
    const cases = [
      `
        const originalUpdate=Object.getOwnPropertyDescriptor(prototype,'update');
        const originalDigest=Object.getOwnPropertyDescriptor(prototype,'digest');
        const answers=['ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
          'ed9bf3ef4865a09afd59e6eac7d2b3c1423593649a94e519fc60afc829cf8461',
          '1cd66efecf4bf918a62fcfe03a491c614ee5c6ebac9adf757964dad30379bfc6',
          '841189a5e1e03e9d6c54579a043847e87a3ae80e8c93a46dd9f975bb9843144c',
          '670e99cd9a72f0494041ed6077d4decb3994d8b29e00da3ba47d5dafc49eee6f'];
        function update(data,encoding){counts.update+=1; this.input=data; return this;}
        function digest(encoding){counts.digest+=1; return encoding==='hex'?answers.shift():'';}
        Object.defineProperty(prototype,'update',{...originalUpdate,value:update});
        Object.defineProperty(prototype,'digest',{...originalDigest,value:digest});
      `,
      `
        const originalUpdate=Object.getOwnPropertyDescriptor(prototype,'update');
        function update(data,encoding){counts.update+=1; return this;}
        Object.defineProperty(prototype,'update',{...originalUpdate,value:update});
      `,
      `
        const originalDigest=Object.getOwnPropertyDescriptor(prototype,'digest');
        function digest(encoding){counts.digest+=1; return 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';}
        Object.defineProperty(prototype,'digest',{...originalDigest,value:digest});
      `,
    ];
    for (const setup of cases) {
      const result = runFresh(`
        'use strict';
        const crypto=require('node:crypto');
        const prototype=Object.getPrototypeOf(crypto.createHash('sha256'));
        const counts={update:0,digest:0};
        ${setup}
        let loaded=true; let message='';
        try { require(${JSON.stringify(AUTHORITY_PATH)}); } catch(error) {
          loaded=false; message=error.message;
        }
        process.stdout.write(JSON.stringify({loaded,message,counts}));
      `);
      expect(result).toEqual({loaded:false,
        message:'Mission 27 Part 14 authority bootstrap invalid',
        counts:{update:0,digest:0}});
    }
  });

  test('rejects proxy, wrapper, accessor and altered-prototype hash methods without hooks', () => {
    const cases = [
      `
        const original=Object.getOwnPropertyDescriptor(prototype,'update');
        const proxy=new Proxy(original.value,{get(target,key,receiver){counts.get+=1;
          return Reflect.get(target,key,receiver);},apply(target,self,args){counts.update+=1;
          return Reflect.apply(target,self,args);}});
        Object.defineProperty(prototype,'update',{...original,value:proxy});
      `,
      `
        const original=Object.getOwnPropertyDescriptor(prototype,'digest');
        const wrapped=original.value.bind(null);
        Object.defineProperties(wrapped,{name:{value:'digest',configurable:true},
          length:{value:1,configurable:true}});
        Object.defineProperty(prototype,'digest',{...original,value:wrapped});
      `,
      `
        const original=Object.getOwnPropertyDescriptor(prototype,'update');
        function wrapped(data,encoding){counts.update+=1; return Reflect.apply(original.value,this,[data,encoding]);}
        Object.defineProperties(wrapped,{name:{value:'update',configurable:true},
          length:{value:2,configurable:true}});
        Object.defineProperty(prototype,'update',{...original,value:wrapped});
      `,
      `
        Object.defineProperty(prototype,'digest',{enumerable:true,configurable:true,
          get(){counts.get+=1; return function digest(){counts.digest+=1;};}});
      `,
      `
        Object.setPrototypeOf(prototype,new Proxy(Object.getPrototypeOf(prototype),{
          get(target,key,receiver){counts.get+=1; return Reflect.get(target,key,receiver);}}));
      `,
    ];
    for (const setup of cases) {
      const result = runFresh(`
        'use strict';
        const crypto=require('node:crypto');
        const prototype=Object.getPrototypeOf(crypto.createHash('sha256'));
        const counts={update:0,digest:0,get:0};
        ${setup}
        let loaded=true; let message='';
        try { require(${JSON.stringify(AUTHORITY_PATH)}); } catch(error) {
          loaded=false; message=error.message;
        }
        process.stdout.write(JSON.stringify({loaded,message,counts}));
      `);
      expect(result).toEqual({loaded:false,
        message:'Mission 27 Part 14 authority bootstrap invalid',
        counts:{update:0,digest:0,get:0}});
    }
  });

  test('fails closed without dispatch through post-import Function toString and rejects a pre-import spoof', () => {
    const afterImport = runFresh(`
      'use strict';
      const fs=require('node:fs'); const path=require('node:path');
      const authority=require(${JSON.stringify(AUTHORITY_PATH)});
      const root=${JSON.stringify(ROOT)};
      const docs=Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      let calls=0;
      Function.prototype.toString=function toString(){calls+=1; return 'forged';};
      let canonical=false; try { canonical=authority.validate(docs).currentStatus==='candidate'; }
      catch(_error) {}
      process.stdout.write(JSON.stringify({canonical,calls}));
    `);
    expect(afterImport).toEqual({canonical:false,calls:0});

    const beforeImport = runFresh(`
      'use strict';
      let calls=0;
      Function.prototype.toString=function toString(){calls+=1; return 'forged';};
      let loaded=true; let message='';
      try { require(${JSON.stringify(AUTHORITY_PATH)}); } catch(error) {
        loaded=false; message=error.message;
      }
      process.stdout.write(JSON.stringify({loaded,message,calls}));
    `);
    expect(beforeImport.loaded).toBe(false);
    expect(beforeImport.message).toBe('Mission 27 Part 14 authority bootstrap invalid');
    expect(beforeImport.calls).toBeGreaterThan(0);
  });

  test('hash prototype replacement fails closed without invoking hostile methods', () => {
    const result = runFresh(`
      'use strict';
      const fs=require('node:fs'); const path=require('node:path');
      const crypto=require('node:crypto');
      const authority=require(${JSON.stringify(AUTHORITY_PATH)});
      const root=${JSON.stringify(ROOT)};
      const docs=Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      const altered={...docs,ledger:docs.ledger+'\\nforged authority\\n'};
      const prototype=Object.getPrototypeOf(crypto.createHash('sha256'));
      const counts={update:0,digest:0};
      Object.defineProperty(prototype,'update',{enumerable:true,writable:true,configurable:true,
        value(){counts.update+=1; throw new Error('hostile update');}});
      Object.defineProperty(prototype,'digest',{enumerable:true,writable:true,configurable:true,
        value(){counts.digest+=1; throw new Error('hostile digest');}});
      let rejected=false;
      try { authority.validate(altered); } catch(_error) { rejected=true; }
      process.stdout.write(JSON.stringify({rejected,counts}));
    `);
    expect(result).toEqual({rejected:true, counts:{update:0,digest:0}});

    const prototypeResult = runFresh(`
      'use strict';
      const fs=require('node:fs'); const path=require('node:path');
      const crypto=require('node:crypto');
      const authority=require(${JSON.stringify(AUTHORITY_PATH)});
      const root=${JSON.stringify(ROOT)};
      const docs=Object.fromEntries(Object.entries(authority.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      const altered={...docs,ledger:docs.ledger+'\\nforged authority\\n'};
      const prototype=Object.getPrototypeOf(crypto.createHash('sha256'));
      let inheritedHooks=0;
      Object.setPrototypeOf(prototype,new Proxy(Object.create(null),{
        get(){inheritedHooks+=1; throw new Error('hostile hash prototype');}}));
      let rejected=false;
      try { authority.validate(altered); } catch(_error) { rejected=true; }
      process.stdout.write(JSON.stringify({rejected,inheritedHooks}));
    `);
    expect(prototypeResult).toEqual({rejected:true,inheritedHooks:0});
  });

  test('seals the original API and keeps initialized consumers bound across cache replacement', () => {
    const productionFiles = [];
    const visit = directory => {
      for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile() && /\\.js$/.test(entry.name) && file !== AUTHORITY_PATH &&
            fs.readFileSync(file, 'utf8').includes('mission27Part14Authority')) {
          productionFiles.push(path.relative(ROOT, file));
        }
      }
    };
    visit(path.join(ROOT, 'src'));
    expect(productionFiles).toEqual([]);

    const result = runFresh(`
      'use strict';
      const fs=require('node:fs'); const path=require('node:path');
      const Module=require('node:module');
      const modulePath=${JSON.stringify(AUTHORITY_PATH)}; const root=${JSON.stringify(ROOT)};
      const original=require(modulePath); const capturedValidate=original.validate;
      const originalRecord=require.cache[modulePath];
      const docs=Object.fromEntries(Object.entries(original.CANONICAL_DOCUMENTS)
        .map(([name,entry])=>[name,fs.readFileSync(path.join(root,entry.path),'utf8')]));
      const altered={...docs,roadmap:docs.roadmap+'\\nforged authority\\n'};
      const descriptor=Object.getOwnPropertyDescriptor(originalRecord,'exports');
      const attempts={assign:false,delete:false,define:false,apiAssign:false};
      try { originalRecord.exports={validate:()=>({currentStatus:'forged'})}; }
      catch(_error) { attempts.assign=true; }
      try { delete originalRecord.exports; } catch(_error) { attempts.delete=true; }
      try { Object.defineProperty(originalRecord,'exports',{value:{}}); }
      catch(_error) { attempts.define=true; }
      try { original.validate=()=>({currentStatus:'forged'}); }
      catch(_error) { attempts.apiAssign=true; }
      delete require.cache[modulePath];
      const reloaded=require(modulePath);
      const reloadCanonical=reloaded.validate(docs).currentStatus==='candidate';
      delete require.cache[modulePath];
      let forgedCalls=0; const forged=new Module(modulePath);
      forged.filename=modulePath; forged.loaded=true;
      forged.exports={validate(){forgedCalls+=1; return {currentStatus:'forged'};}};
      require.cache[modulePath]=forged;
      const directHostile=require(modulePath).validate(altered).currentStatus;
      let capturedRejected=false;
      try { capturedValidate(altered); } catch(_error) { capturedRejected=true; }
      const capturedCanonical=capturedValidate(docs).currentStatus==='candidate';
      process.stdout.write(JSON.stringify({
        nullPrototype:Object.getPrototypeOf(original)===null,
        frozen:Object.isFrozen(original), extensible:Object.isExtensible(original),
        descriptor:{writable:descriptor.writable,configurable:descriptor.configurable},
        attempts,reloadCanonical,directHostile,forgedCalls,capturedRejected,capturedCanonical,
      }));
    `);
    expect(result).toEqual({
      nullPrototype:true, frozen:true, extensible:false,
      descriptor:{writable:false,configurable:false},
      attempts:{assign:true,delete:true,define:true,apiAssign:true},
      reloadCanonical:true, directHostile:'forged', forgedCalls:1,
      capturedRejected:true, capturedCanonical:true,
    });
  });

  test('returns one deeply immutable authority state', () => {
    const first = authority.validate({ ...DOCS });
    const second = authority.validate({ ...DOCS });
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.laterSlices)).toBe(true);
    expect(authority.PART14_SCOPES.every(Object.isFrozen)).toBe(true);
    expect(authority.LATER_LEDGER_ROWS.every(Object.isFrozen)).toBe(true);
    expect(Object.getPrototypeOf(authority)).toBeNull();
  });
});
