'use strict';
const {createInitialDemoState}=require('../../src/commandCenter/workspace');
const basis=require('../../src/commandCenter/demoOperationsBasis');
const {sha256}=require('../../src/services/businessProfileAdapter');
describe('explicit new-session simulated scheduling basis',()=>{
 const make=()=>createInitialDemoState('76ab402a-2109-43a3-b4b1-fdf42fd673d3','2026-09-11T12:00:00Z');
 test('structured hours match the displayed profile and apply only to original jobs',()=>{
  const state=make(),value=basis.read(state);
  expect(value.displayedHours).toBe(state.workspace.businessProfile.hours);
  expect(value.hours.monday).toEqual({open:'08:00',close:'17:00',lunch:''});
  expect(value.hours.friday).toEqual(value.hours.monday);
  expect(value.hours.saturday).toEqual({open:'',close:'',lunch:''});
  expect(value.hours.sunday).toEqual(value.hours.saturday);
  expect(value.appointments.map(a=>a.appointmentId)).toEqual(state.graphs.map(g=>g.ids.appointment||g.ids.work));
  expect(value.simulated).toBe(true);expect(value.locationMeaning).toContain('not verified geographic coverage');
 });
 test('older sessions stay absent without changing their graphs or retrofitting evidence',()=>{
  const state=make();delete state.operationsSchedulingBasis;const before=JSON.stringify(state);
  expect(basis.read(state)).toBeNull();expect(JSON.stringify(state)).toBe(before);
 });
 test('unknown profile hours are not interpreted as verified structured availability',()=>{
  const state=make();state.workspace.businessProfile.hours='Hours by arrangement';
  expect(basis.create(state.workspace,state.graphs,state.createdAt)).toBeNull();
 });
 test('even a resealed changed timetable does not acquire supported basis authority',()=>{
  const state=make(),value=state.operationsSchedulingBasis;value.hours.monday.close='23:00';
  const unsigned={...value};delete unsigned.digest;value.digest=sha256(unsigned);
  expect(()=>basis.read(state)).toThrow('business hours');
 });
});
