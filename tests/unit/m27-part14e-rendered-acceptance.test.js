'use strict';

const fs=require('node:fs');
const path=require('node:path');
const contract=require('../../src/customerFinancial/mission27Part14eRenderedAcceptance');

const read=value=>fs.readFileSync(path.resolve(__dirname,'../..',value),'utf8');

describe('Mission 27 Part 14E rendered acceptance',()=>{
  test('freezes the exact five-layout, mounted-surface, state and control matrix',()=>{
    expect(contract.contractVersion).toBe('m27-part14e-rendered-acceptance-v1');
    expect(contract.LAYOUTS.map(value=>value.name)).toEqual([
      'phone-narrow-dark','phone-standard-light','tablet-portrait-dark',
      'tablet-landscape-light','desktop-dark']);
    expect(contract.SURFACES.map(value=>[value.id,value.page,value.mode,value.evidence])).toEqual([
      ['billing-identity-paid','/dashboard/settings','paid_tenant','mounted'],
      ['billing-identity-demo','/demo/settings','isolated_fictional_demo','mounted'],
      ['financial-lifecycle-paid','/dashboard','paid_tenant','mounted'],
      ['financial-lifecycle-demo','/demo','isolated_fictional_demo','mounted'],
    ]);
    expect(contract.REQUIRED_STATES).toEqual([
      'empty','loading','error','recovery','current','stale_rejected','collapsed','reopened','reset']);
    expect(contract.REQUIRED_CONTROLS).toContain('zero_request_interception');
    expect(contract.REQUIRED_CONTROLS).toContain('forced_colors');
    expect(contract.REQUIRED_CONTROLS).toContain('bounded_performance');
    expect(Object.isFrozen(contract)).toBe(true);
    expect(contract.LAYOUTS.every(Object.isFrozen)).toBe(true);
    expect(contract.SURFACES.every(Object.isFrozen)).toBe(true);
  });

  test('accepts only the complete zero-effect evidence ledger',()=>{
    const canonical={contractVersion:contract.contractVersion,engine:'chrome',
      layouts:contract.LAYOUTS.map(value=>value.name),surfaces:contract.SURFACES.map(value=>value.id),
      states:[...contract.REQUIRED_STATES],controls:[...contract.REQUIRED_CONTROLS],
      effects:{providerCalls:0,receiverMutations:0,moneyMovements:0},pageErrors:0,
      unexpectedConsoleErrors:0,unexpectedExternalRequests:0,founderVisualApproval:false,
      physicalSafariEvidence:false,hostedLoadEvidence:false,
      liveMoneyEvidence:'not-run-deferred-first-paying-customer'};
    expect(contract.validateLedger(canonical)).toBe(true);
    const mutations=[
      value=>value.layouts.reverse(),value=>value.surfaces.pop(),value=>value.states.splice(1,1),
      value=>value.controls.push('mocked_response'),value=>value.effects.providerCalls=1,
      value=>value.pageErrors=1,value=>value.unexpectedConsoleErrors=1,
      value=>value.unexpectedExternalRequests=1,value=>value.founderVisualApproval=true,
      value=>value.physicalSafariEvidence=true,value=>value.hostedLoadEvidence=true,
      value=>value.liveMoneyEvidence='simulated',value=>value.extra='accepted',
    ];
    for(const mutate of mutations){const changed=structuredClone(canonical);mutate(changed);
      expect(contract.validateLedger(changed)).toBe(false);}
  });

  test('binds the browser campaigns to real mounted production paths and no shortcut',()=>{
    const mounted=read('tests/browser/m27-part12d-mounted-acceptance.js');
    const demo=read('tests/browser/m27-part14b-fictional-demo-journey.js');
    const billing=read('tests/browser/m27-part14e-mounted-billing-identity.js');
    for(const source of [mounted,demo,billing]){
      expect(source).toMatch(/requestInterceptions:\s*0/);
      expect(source).toMatch(/responseInterceptions:\s*0/);
    }
    expect(mounted).toContain("actualPage: '/dashboard'");
    expect(mounted).toContain("actualPage:'/demo'");
    expect(demo).toContain('paidRouteCalls:0');
    expect(billing).toContain("'/dashboard/settings'");
    expect(billing).toContain("'/demo/settings'");
    expect(billing).not.toContain('page.route(');
  });

  test('records exact limitations without converting automation into founder approval',()=>{
    const architecture=read('docs/architecture/MISSION_27_PART14E_RENDERED_ACCEPTANCE.md');
    expect(architecture).toContain('Playwright WebKit is not physical Safari');
    expect(architecture).toContain('Founder visual approval remains separate and ungranted');
    expect(architecture).toContain('first-paying-customer live-money validation remains deferred');
    expect(architecture).toContain('No request or response interception is allowed');
  });
});
