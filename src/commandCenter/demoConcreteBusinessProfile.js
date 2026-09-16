'use strict';

const {stableValue}=require('../services/businessProfileAdapter');

// This is a fictional company's dated cost book. Public prices establish the
// ready-mix benchmark; company-specific labor, support-material, equipment and
// mobilization rates remain clearly identified as simulated business records.
const PROFILE=Object.freeze({
  version:'simulated-concrete-business-profile-v1',
  industry:'Residential concrete installation',
  defaults:Object.freeze({slabThicknessInches:4,wastePercent:10}),
  workforce:Object.freeze({crewSize:4,averageLoadedHourlyCost:42}),
  materials:Object.freeze({readyMixInternalRatePerCubicYard:156,readyMixDeliveryFee:325,supportingMaterialInternalRatePerSquareFoot:1.55,customerMarkupPercent:20}),
  pricing:Object.freeze({laborCustomerRatePerSquareFoot:6.7,removalAndDisposalCharge:700}),
  equipment:Object.freeze({withRemovalInternalCost:1200,placementInternalCost:650,removalCustomerCharge:700,finishingCustomerCharge:500,transportCustomerCharge:450}),
  logistics:Object.freeze({crewMobilizationHours:1.5,customerLaborMultiplier:1.2}),
  vehicles:Object.freeze(['One-ton crew pickup','Dump trailer','Equipment trailer']),
  machinery:Object.freeze(['Skid steer with breaker attachment','Plate compactor','Concrete placement and finishing tool set']),
  sources:Object.freeze([
    Object.freeze({publisher:'Gehring Construction & Ready-Mix',url:'https://www.gehringconcrete.com/Products/Ready-Mix-Products-Pricing',effectiveOn:'2026-01-01',reviewedOn:'2026-09-15',use:'Published 4000 PSI ready-mix benchmark of USD 156 per cubic yard and fiber-mesh benchmark of USD 8 per cubic yard.'}),
    Object.freeze({publisher:'Lawson Concrete',url:'https://www.lawsoncon.com/pricing',effectiveOn:'2025',reviewedOn:'2026-09-15',use:'Published comparison of USD 185 per cubic yard for 4000 PSI concrete and a delivery fee starting at USD 325.'}),
  ]),
});

function create(){return stableValue(PROFILE);}

module.exports={PROFILE,create};
