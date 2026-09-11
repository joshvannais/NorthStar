'use strict';
const {buildCapellaReview}=require('../../src/estimating/capellaReview');
const fixture=()=>{const pins={estimateId:'estimate',snapshotDigest:'snapshot',normalizedInputFingerprint:'input',businessProfileHash:'profile'};return {review:{pins,recordedAt:'2026-09-10T00:00:00Z',currency:'USD',simulated:false,decisions:{current:{id:'decision',revision:1,digest:'digest',action:'approve',sourcePins:{...pins},priceBeforeTax:'1400.00',currency:'USD'}}},snapshot:{knownDirectCosts:1000,grossProfit:999999,netProfit:888888,knownInternalLaborCost:7000}};};
function compare(price,cost){const f=fixture();f.review.decisions.current.priceBeforeTax=price;f.snapshot.knownDirectCosts=cost;return buildCapellaReview(f.review,f.snapshot);}
test.each([['1400.00',1000,'400.00','compared'],['900.00',1000,'-100.00','shortfall'],['0.00',0,'0.00','compared'],['0.00',0.01,'-0.01','shortfall'],['0.30',0.1,'0.20','compared'],['999999999999.99',0,'999999999999.99','compared'],['1.00',999999999999.99,'-999999999998.99','shortfall']])('exact cents %s / %s',(price,cost,amount,state)=>{expect(compare(price,cost)).toMatchObject({state,remainingAfterDirectCosts:amount,priceBeforeTax:price});});
test.each([null,undefined,NaN,Infinity,-1,0.001,1000000000000,'1000'])('unsupported cost %s is unavailable, never zero',cost=>{expect(compare('1400.00',cost)).toMatchObject({state:'costs_unavailable',remainingAfterDirectCosts:null});});
test.each(['1.234','1e2','-1.00','',null,'1000000000000.00'])('unsupported price %s is unavailable',price=>expect(compare(price,100)).toMatchObject({state:'price_unavailable',remainingAfterDirectCosts:null}));
test('aggregate, not component sum or machine profit; immutable input and pinned result',()=>{const f=fixture(),before=JSON.stringify(f);expect(buildCapellaReview(f.review,f.snapshot)).toMatchObject({remainingAfterDirectCosts:'400.00',recordedDirectCosts:'1000.00',sourcePins:f.review.pins,decision:{id:'decision',revision:1,digest:'digest'}});expect(JSON.stringify(f)).toBe(before);});
test('absent or withdrawn approval is review required, with no fallback to machine price',()=>{const f=fixture();f.snapshot.customerFacingPrice=5000;f.review.decisions.current=null;expect(buildCapellaReview(f.review,f.snapshot).state).toBe('review_required');f.review.decisions.current={action:'withdraw',id:'withdraw',revision:2,digest:'withdraw'};expect(buildCapellaReview(f.review,f.snapshot)).toMatchObject({state:'review_required',remainingAfterDirectCosts:null});});
test('source mismatch and currency mismatch require review; key order does not change identity',()=>{const f=fixture();f.review.decisions.current.sourcePins={...f.review.pins,snapshotDigest:'changed'};expect(buildCapellaReview(f.review,f.snapshot).state).toBe('review_changed');f.review.decisions.current.sourcePins=Object.fromEntries(Object.entries(f.review.pins).reverse());expect(buildCapellaReview(f.review,f.snapshot).state).toBe('compared');f.review.decisions.current.currency='EUR';expect(buildCapellaReview(f.review,f.snapshot).state).toBe('review_changed');});
test('same projector carries only explicit synthetic distinction; raw diagnostic reasons never copied',()=>{const f=fixture();f.snapshot.notCalculated=[{reason:'internal SQL private secret'}];const paid=buildCapellaReview(f.review,f.snapshot);f.review.simulated=true;expect(buildCapellaReview(f.review,f.snapshot)).toEqual({...paid,simulated:true});expect(JSON.stringify(paid)).not.toContain('private secret');});

function adopted(version, cost = '183.00', price = '700.00') {
  const f = fixture();
  f.snapshot.knownDirectCosts = 650;
  f.review.pins.revision = {id: 'child', number: 2, digest: 'child-digest', calculationVersion: version};
  f.review.decisions.current.sourcePins = JSON.parse(JSON.stringify(f.review.pins));
  f.review.decisions.current.priceBeforeTax = price;
  f.review.financialCosts = {knownDirectCosts: cost};
  return f;
}
test.each(require('../../src/estimating/materialAdoptionContract').VERSIONS)('renewed approval uses selected %s costs without original fallback', version => {
  const f = adopted(version), before = JSON.stringify(f);
  expect(buildCapellaReview(f.review, f.snapshot)).toMatchObject({state: 'compared', recordedDirectCosts: '183.00', remainingAfterDirectCosts: '517.00'});
  expect(JSON.stringify(f)).toBe(before);
});
test.each([['0.00','0.00','0.00','compared'],['183.00','100.00','-83.00','shortfall'],[null,'700.00',null,'costs_unavailable'],['183.001','700.00',null,'costs_unavailable']])('child exact cost %s and reviewed price %s', (cost, price, remaining, state) => {
  const f = adopted('estimate-material-adoption-v4', cost, price);
  expect(buildCapellaReview(f.review, f.snapshot)).toMatchObject({state, remainingAfterDirectCosts: remaining});
});
test.each(['estimate-material-adoption-v999', undefined])('unsupported child %s cannot reuse original costs', version => {
  const f = adopted(version);
  expect(buildCapellaReview(f.review, f.snapshot)).toMatchObject({state:'costs_unavailable', recordedDirectCosts:null});
});
