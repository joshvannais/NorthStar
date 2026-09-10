'use strict';
const {createInitialDemoState,buildDemoWorkspace,demoCanonicalItems,demoCalendarTimeZoneAuthority}=require('../../src/commandCenter/workspace');
const {sha256}=require('../../src/services/businessProfileAdapter');
const {compatibilityProjection}=require('../../src/routes/canonicalPolaris');
const tenant='00000000-0000-4000-8000-000000000101';
function workspace(state,revision=1){return buildDemoWorkspace({tenantId:tenant,state,revision,sessionId:'00000000-0000-4000-8000-000000000102',expiresAt:'2026-09-12T00:00:00Z',persisted:true,simulationCount:0});}
test.each(['calendar-one','calendar-two','calendar-three'])('current synthetic Calendar profile is independent of historical estimate versions: %s',seed=>{
 const state=createInitialDemoState(tenant,new Date('2026-09-10T00:00:00Z'),{seed}),before=JSON.stringify(state),w=workspace(state),items=demoCanonicalItems(w),pins=items.map(i=>[i.businessProfileInputVersion,i.businessProfileInputHash,i.projectionDigest]);
 expect(Number.isNaN(Number(items[0].businessProfileInputVersion))).toBe(true);
 const a=demoCalendarTimeZoneAuthority(w);expect(a.profileVersion).toBe(1);expect(a.profileHash).toBe(sha256(w.configuration.businessProfile));expect(a.timeZone).toBe(w.configuration.businessProfile.timeZone);
 expect(compatibilityProjection('calendar',[],{organizationId:tenant},a).records).toEqual([]);
 const next=demoCalendarTimeZoneAuthority(workspace(state,2));expect(next.profileId).toBe(a.profileId);expect(next.profileVersion).toBe(2);expect(next.profileHash).toBe(a.profileHash);
 expect(demoCanonicalItems(w).map(i=>[i.businessProfileInputVersion,i.businessProfileInputHash,i.projectionDigest])).toEqual(pins);expect(JSON.stringify(state)).toBe(before);
});
test('legacy stored workspace remains readable without modifying saved graphs',()=>{const state=structuredClone(require('../fixtures/m24-demo-pre-slice4.json').state),before=JSON.stringify(state),w=workspace(state);expect(demoCalendarTimeZoneAuthority(w).timeZone).toBe(w.configuration.businessProfile.timeZone);expect(JSON.stringify(state)).toBe(before);});
test.each([0,null,1.5,'1'])('invalid workspace revision fails closed: %s',revision=>{const w=workspace(createInitialDemoState(tenant,new Date('2026-09-10T00:00:00Z'),{seed:'calendar-invalid'}));w.integrity.revision=revision;expect(()=>demoCalendarTimeZoneAuthority(w)).toThrow();});
