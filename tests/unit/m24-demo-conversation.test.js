'use strict';
const {createInitialDemoState,demoCanonicalItems}=require('../../src/commandCenter/workspace');
const {sha256}=require('../../src/services/businessProfileAdapter');
const make=seed=>createInitialDemoState('11111111-1111-4111-8111-111111111111','2026-09-10T00:00:00Z',{seed});
test.each(['conversation-review','another-local-example','third-local-example'])('seeded conversations follow saved jobs and distinguish authored simulation: %s',seed=>{
 const state=make(seed);expect(make(seed)).toEqual(state);
 for(const graph of state.graphs){const turns=graph.communication.transcript,text=turns.map(t=>t.text).join('\n'),scope=graph.polaris.snapshot.service.scope;
 expect(text).toContain('Simulated conversation based on this saved example');expect(text).toContain('No live call or knowledge search occurred');expect(text).toContain(graph.lead.serviceLabel.toLowerCase());expect(text).toContain(graph.customer.address);expect(text).toContain('does not approve a price or book the work');
 for(const key of ['material','linearFeet','squares','stories','pitch','systemType','tonnage','sqft','fixture','leakSeverity'])if(scope[key]!=null)expect(text).toContain(String(scope[key]));
 expect(text).not.toMatch(/\$|guaranteed|verified supplier|Retell has/);
 if(graph.polaris.syntheticCalculation){const input=graph.polaris.syntheticCalculation.input;expect(text).toContain(input.businessProfile.crew.defaultCrewSize+'-person crew');expect(text).toContain(scope.laborHours+' hours');expect(text).toContain('actual suitability and availability still need review');expect(graph.polaris.snapshotDigest).toBe(sha256(graph.polaris.snapshot));}
 else expect(text).toContain('internal costs are incomplete');
 expect(text).toContain('follow up with me to confirm the timing and access');
 }
});
test('reading a saved older demo never inserts a conversation or changes its pinned graph',()=>{
 const state=make('older-demo');state.graphs.forEach(g=>g.communication.transcript=[]);const workspace={tenant:state.workspace.tenant,graphs:state.graphs};const before=JSON.stringify(workspace);const items=demoCanonicalItems(workspace);expect(JSON.stringify(workspace)).toBe(before);expect(items.every(i=>!i.transcript.text)).toBe(true);
});
