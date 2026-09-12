"use strict";
const {calculate}=require('../../src/estimating/equipmentCostCalculation'),{cases}=require('../helpers/m24-equipment-cost-overlap-cases'),{inputs}=require('../helpers/m24-equipment-cost-input');
const base=inputs({id:'11111111-1111-4111-8111-111111111111',revision:1,digest:'a'.repeat(64),sourcePins:{},inputs:{serviceKey:'fence',lines:[{lineId:'22222222-2222-4222-8222-222222222222',accessBasis:'owned'}]}});
test.each(cases(base))('$name',c=>{if(c.reject)expect(()=>calculate(c.inputs,'USD')).toThrow(/more than once/);else expect(calculate(c.inputs,'USD').total).toBe(c.total);});
