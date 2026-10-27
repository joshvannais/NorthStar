'use strict';

const freeze = value => Object.freeze(value);

const LAYOUTS = freeze([
  freeze({name:'phone-narrow-dark',width:360,height:800,colorScheme:'dark'}),
  freeze({name:'phone-standard-light',width:390,height:844,colorScheme:'light'}),
  freeze({name:'tablet-portrait-dark',width:768,height:1024,colorScheme:'dark'}),
  freeze({name:'tablet-landscape-light',width:1024,height:768,colorScheme:'light'}),
  freeze({name:'desktop-dark',width:1440,height:900,colorScheme:'dark'}),
]);

const SURFACES = freeze([
  freeze({id:'billing-identity-paid',page:'/dashboard/settings',mode:'paid_tenant',
    renderedRoot:'#billing-identity-journey',evidence:'mounted'}),
  freeze({id:'billing-identity-demo',page:'/demo/settings',mode:'isolated_fictional_demo',
    renderedRoot:'#billing-identity-journey',evidence:'mounted'}),
  freeze({id:'financial-lifecycle-paid',page:'/dashboard',mode:'paid_tenant',
    renderedRoot:'#cdEstimateHub > .invoice-draft-preview',evidence:'mounted'}),
  freeze({id:'financial-lifecycle-demo',page:'/demo',mode:'isolated_fictional_demo',
    renderedRoot:'#cdEstimateHub > .invoice-draft-preview',evidence:'mounted'}),
]);

const REQUIRED_STATES = freeze([
  'empty','loading','error','recovery','current','stale_rejected','collapsed','reopened','reset',
]);

const REQUIRED_CONTROLS = freeze([
  'real_session','real_csrf','real_routes','real_database','zero_request_interception',
  'zero_response_interception','zero_provider_calls','zero_receiver_mutations','zero_money_effects',
  'keyboard_focus','forced_colors','reduced_motion','light_dark','responsive_no_overflow',
  'privacy_nonreflection','paid_demo_isolation','currentness','bounded_performance','observability',
]);

function exactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === expected.length &&
    expected.every(key => Object.prototype.hasOwnProperty.call(value,key));
}

function validateLedger(value) {
  if (!exactKeys(value,['contractVersion','engine','layouts','surfaces','states','controls','effects',
    'pageErrors','unexpectedConsoleErrors','unexpectedExternalRequests','founderVisualApproval',
    'physicalSafariEvidence','hostedLoadEvidence','liveMoneyEvidence'])) return false;
  if (value.contractVersion !== 'm27-part14e-rendered-acceptance-v1' ||
      !['chrome','webkit'].includes(value.engine) ||
      JSON.stringify(value.layouts) !== JSON.stringify(LAYOUTS.map(layout=>layout.name)) ||
      JSON.stringify(value.surfaces) !== JSON.stringify(SURFACES.map(surface=>surface.id)) ||
      JSON.stringify(value.states) !== JSON.stringify(REQUIRED_STATES) ||
      JSON.stringify(value.controls) !== JSON.stringify(REQUIRED_CONTROLS)) return false;
  return exactKeys(value.effects,['providerCalls','receiverMutations','moneyMovements']) &&
    value.effects.providerCalls === 0 && value.effects.receiverMutations === 0 &&
    value.effects.moneyMovements === 0 && value.pageErrors === 0 &&
    value.unexpectedConsoleErrors === 0 && value.unexpectedExternalRequests === 0 &&
    value.founderVisualApproval === false && value.physicalSafariEvidence === false &&
    value.hostedLoadEvidence === false &&
    value.liveMoneyEvidence === 'not-run-deferred-first-paying-customer';
}

module.exports = freeze({
  contractVersion:'m27-part14e-rendered-acceptance-v1',
  LAYOUTS,SURFACES,REQUIRED_STATES,REQUIRED_CONTROLS,validateLedger,
});
