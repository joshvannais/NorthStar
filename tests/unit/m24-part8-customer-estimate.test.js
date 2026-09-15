'use strict';

const { createCustomerEstimatePreview } = require('../../src/estimating/customerEstimateProjection');
const documentRenderer = require('../../public/js/customer-estimate-preview');
const fs=require('node:fs'),path=require('node:path');

function input(overrides = {}) {
  const summary = {
    currency:'USD', scopeSummary:'Remove the declining maple, chip brush, and leave the site broom clean.',
    lines:[
      {lineId:'private-labor-id',label:'Tree removal and cleanup',kind:'charge',originalAmount:'1450.00',adjustedAmount:'1400.00'},
      {lineId:'private-permit-id',label:'Permit coordination',kind:'fee',originalAmount:'75.00',adjustedAmount:'75.00'},
    ],
    adjustments:[{adjustmentId:'private-discount-id',label:'Scheduling adjustment',reason:'Private reason',amount:'-50.00',allocations:[{lineId:'private-labor-id',amount:'-50.00'}]}],
    taxGroups:[{groupId:'private-tax-id',label:'Connecticut sales tax',treatment:'taxable',behavior:'exclusive',base:'1475.00',net:'1475.00',tax:'93.66',total:'1568.66',allocations:[]}],
    netBeforeTax:'1475.00',tax:'93.66',total:'1568.66',
    payments:[{stageId:'private-deposit-id',label:'Deposit',kind:'deposit',amount:'400.00'},{stageId:'private-balance-id',label:'Balance after completion',kind:'balance',amount:'1168.66'}],
    taxAuthority:'owner_recorded', termsPin:{id:'private-terms-id'}, decisionPin:{id:'private-decision-id'},
  };
  return {
    review:{simulated:false,currency:'USD',recordedAt:'2026-09-15T12:00:00.000Z',commercialTerms:{approvalState:'commercial_approved',customerSummary:summary,binding:{createdAt:'2026-09-15T12:30:00.000Z'},current:{current:true,createdAt:'2026-09-15T12:20:00.000Z'}}},
    item:{customer:{name:'Jordan Blake',address:'12 Maple Street, Windsor, CT 06095',email:'private@example.com',phone:'555-private'},opportunity:{serviceType:'Tree removal'},snapshot:{privateCosts:'never export'}},
    profile:{rawProfile:{company:{name:'Windsor Tree Co.',email:'office@example.com',phone:'(860) 555-0100',website:'https://example.com',taxId:'private-tax-id'},headquarters:{street:'100 Main Street',city:'Windsor',state:'CT',zip:'06095'}}},
    ...overrides,
  };
}

describe('Mission 24 Part 8 customer estimate preview', () => {
  test('loads the preview controller before every shared customer drawer', () => {
    const root=path.resolve(__dirname,'../..');
    for(const file of ['dashboard.html','demo-dashboard.html','dashboard/command-center.html','dashboard/communications.html','dashboard/leads.html','dashboard/polaris.html']){
      const html=fs.readFileSync(path.join(root,'public',file),'utf8');
      expect(html.split('/js/customer-estimate-preview.js')).toHaveLength(2);
      expect(html.indexOf('/js/customer-estimate-preview.js')).toBeLessThan(html.indexOf('/js/customer-detail.js'));
    }
    const paidRoute=fs.readFileSync(path.join(root,'src/routes/canonicalPolaris.js'),'utf8');
    expect(paidRoute).toContain("!['owner', 'admin'].includes(operator.actor && operator.actor.accessRole)");
  });

  test('creates a simple customer allowlist with dollar-ready totals and no private identifiers or analysis', () => {
    const result = createCustomerEstimatePreview(input());
    expect(result).toMatchObject({
      contract:'NorthStarCustomerEstimatePreview/v1',state:'preview',reference:expect.stringMatching(/^EST-[A-F0-9]{10}$/),
      issuer:{name:'Windsor Tree Co.',email:'office@example.com'},customer:{name:'Jordan Blake'},
      work:{title:'Tree removal'},currency:'USD',subtotal:'1475.00',tax:'93.66',total:'1568.66',
      capabilities:{downloadPdf:true,downloadImage:true,accept:false,askQuestion:false},
    });
    expect(result.charges).toEqual([{label:'Tree removal and cleanup',kind:'charge',amount:'1400.00'},{label:'Permit coordination',kind:'fee',amount:'75.00'}]);
    expect(result.adjustments).toEqual([{label:'Scheduling adjustment',amount:'-50.00'}]);
    expect(result.taxes).toEqual([{label:'Connecticut sales tax',treatment:'taxable',amount:'93.66'}]);
    const serialized=JSON.stringify(result);
    for(const value of ['private-labor-id','private-tax-id','private@example.com','Private reason','privateCosts','termsPin','decisionPin'])expect(serialized).not.toContain(value);
  });

  test('is content-stable and changes its public reference when customer-visible content changes', () => {
    const first=createCustomerEstimatePreview(input()),second=createCustomerEstimatePreview(input());
    expect(second).toEqual(first);
    const changed=input();changed.item.customer.name='Taylor Morgan';
    expect(createCustomerEstimatePreview(changed).reference).not.toBe(first.reference);
  });

  test('projects the isolated demo business profile without exposing demo configuration', () => {
    const demo=input({simulated:true,profile:{
      company:'Truefield Harbor Example Home Services',email:'office@example.com',phone:'(206) 555-0101',
      headquarters:{formatted:'100 Example Service Way, Example Harbor, WA 00000'},
      pricingModel:'private demo configuration',ownerName:'private owner fixture',
    }});
    demo.review.simulated=true;
    const result=createCustomerEstimatePreview(demo),serialized=JSON.stringify(result);
    expect(result.issuer).toMatchObject({name:'Truefield Harbor Example Home Services',email:'office@example.com',phone:'(206) 555-0101',address:'100 Example Service Way, Example Harbor, WA 00000'});
    expect(serialized).not.toContain('private demo configuration');
    expect(serialized).not.toContain('private owner fixture');
  });

  test('refuses absent approval, unknown tax, malformed money, and incomplete customer scope', () => {
    const absent=input();absent.review.commercialTerms.customerSummary=null;expect(()=>createCustomerEstimatePreview(absent)).toThrow(/Approve the current scope/);
    const tax=input();tax.review.commercialTerms.customerSummary.taxAuthority='unknown';expect(()=>createCustomerEstimatePreview(tax)).toThrow(/Resolve the customer tax/);
    const money=input();money.review.commercialTerms.customerSummary.total='1,568.66';expect(()=>createCustomerEstimatePreview(money)).toThrow(/estimate total/);
    const scope=input();scope.review.commercialTerms.customerSummary.scopeSummary=' ';expect(()=>createCustomerEstimatePreview(scope)).toThrow(/work scope/);
  });

  test('formats USD with a dollar sign and builds a selectable multipage-capable PDF payload', () => {
    const result=createCustomerEstimatePreview(input());
    expect(documentRenderer.money('1568.66','USD')).toBe('$1,568.66');
    expect(documentRenderer.presentationRows(result).at(-1)).toEqual({label:'Estimated total',amount:'$1,568.66',kind:'total'});
    const bytes=documentRenderer.pdfBytes(result),text=Buffer.from(bytes).toString('utf8');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(Windsor Tree Co.) Tj');
    expect(text).toContain('(Estimated total) Tj');
    expect(text).toContain('($1,568.66) Tj');
    expect(text).toContain('/Type /Pages');
    const long=input();long.review.commercialTerms.customerSummary.scopeSummary=('Remove and dispose of the recorded tree while protecting the property. ').repeat(140);
    const longPdf=Buffer.from(documentRenderer.pdfBytes(createCustomerEstimatePreview(long))).toString('utf8');
    expect(longPdf).toMatch(/\/Count [2-9]/);
  });
});
