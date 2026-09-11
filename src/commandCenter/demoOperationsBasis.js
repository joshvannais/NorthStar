'use strict';
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const VERSION='demo-owner-scheduling-basis-v1';
function create(workspace,graphs,createdAt){
  // Explicit authored simulation, matching the existing displayed hours. Do not
  // parse arbitrary business prose or silently infer coverage from an address.
  if(workspace.businessProfile.hours!=='Monday-Friday, 8:00 AM-5:00 PM')return null;
  const value={version:VERSION,simulated:true,capturedAt:new Date(createdAt).toISOString(),displayedHours:workspace.businessProfile.hours,
    timeZone:workspace.businessProfile.timeZone,locationMeaning:'Simulated main-office responsibility; not verified geographic coverage.',
    appointments:graphs.map(g=>({appointmentId:g.ids.appointment||g.ids.work,locationId:'headquarters'})),
    hours:Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((day,i)=>[day,{open:i<5?'08:00':'',close:i<5?'17:00':'',lunch:''}]))};
  return stableValue({...value,digest:sha256(value)});
}
function read(state){
  const value=state.operationsSchedulingBasis;if(value===undefined||value===null)return null;
  const unsigned={...value};delete unsigned.digest;
  if(value.version!==VERSION||value.simulated!==true||value.displayedHours!=='Monday-Friday, 8:00 AM-5:00 PM'||sha256(unsigned)!==value.digest||!Array.isArray(value.appointments)||value.appointments.length!==3||value.appointments.some(a=>a.locationId!=='headquarters'||!state.graphs.some(g=>(g.ids.appointment||g.ids.work)===a.appointmentId)))throw new Error('Saved simulated scheduling basis could not be read.');
  const expected=Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((day,i)=>[day,{open:i<5?'08:00':'',close:i<5?'17:00':'',lunch:''}]));
  if(sha256(value.hours)!==sha256(expected))throw new Error('Saved simulated business hours could not be read.');
  return value;
}
module.exports={VERSION,create,read};
