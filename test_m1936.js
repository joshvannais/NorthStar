const demo = require('./src/routes/demo.js');

console.log('══════════ M19.3.6 ACCEPTANCE ══════════\n');

let passCount = 0;
let failCount = 0;

function check(label, condition) {
  if (condition) { console.log('  ✅ ' + label); passCount++; }
  else { console.log('  ❌ ' + label); failCount++; }
}

// TEST 1: Tree Service — canonical intelligence structure
console.log('TEST 1: Canonical Intelligence Record (Tree Service)');
const treeLines = [
  { speaker: 'customer', text: 'I need a three hundred foot oak removal. It is about 300 feet tall and near the house.' },
];
const intel = demo.buildPolarisIntelligence('TreeCo', 'Tree Service', treeLines, {customerName: 'John Doe'});
check('requestedService.primary = Tree Removal', intel.requestedService.primary === 'Tree Removal');
check('Tree Height display = 300 ft', intel.estimatingVariables.find(v => v.variable === 'Tree Height')?.display === '300 ft');
check('Tree Height status = collected', intel.estimatingVariables.find(v => v.variable === 'Tree Height')?.status === 'collected');
check('Location Difficulty status = collected', intel.estimatingVariables.find(v => v.variable === 'Location Difficulty')?.status === 'collected');
check('Stump Removal status = missing', intel.estimatingVariables.find(v => v.variable === 'Stump Removal')?.status === 'missing');
check('estimate factMultiplier > 1.0', intel.estimate.adjustments.factMultiplier > 1.0);
check('estimate revenueRange contains numbers', /\$[\d,]+\s*-\s*\$[\d,]+/.test(intel.estimate.revenueRange));
check('estimate confidence > 0', intel.estimate.confidence > 0);
check('executiveBriefing mentions removal', intel.executiveBriefing.toLowerCase().indexOf('removal') !== -1);
check('executiveBriefing mentions height', intel.executiveBriefing.toLowerCase().indexOf('300') !== -1);
check('customerFacts.name = John Doe', intel.customerFacts.name === 'John Doe');

// TEST 2: HVAC with urgency
console.log('\nTEST 2: HVAC structured variables');
const hvacLines = [
  { speaker: 'customer', text: 'My house is about 2,000 square feet. The AC is 10 years old and needs repair. This is urgent.' },
];
const intel2 = demo.buildPolarisIntelligence('HVACCo', 'HVAC', hvacLines);
check('Service = HVAC Repair', intel2.requestedService.primary === 'HVAC Repair');
check('Sq Ft = 2,000 sq ft', intel2.estimatingVariables.find(v => v.variable === 'Home Square Footage')?.display === '2,000 sq ft');
check('System Age = 10 years', intel2.estimatingVariables.find(v => v.variable === 'System Age')?.display === '10 years');
check('Urgency Level = High', intel2.reasoning.find(r => r.factor === 'Urgency Level')?.detail === 'High');
check('Briefing mentions urgent', intel2.executiveBriefing.toLowerCase().indexOf('urgent') !== -1);

// TEST 3: Painting
console.log('\nTEST 3: Painting variables');
const paintLines = [
  { speaker: 'customer', text: 'The house is around 2,000 square feet and has 12 rooms. I need interior painting.' },
];
const intel3 = demo.buildPolarisIntelligence('PaintPro', 'Painting', paintLines);
check('Service = Interior Painting', intel3.requestedService.primary === 'Interior Painting');
check('Sq Ft = 2,000 sq ft', intel3.estimatingVariables.find(v => v.variable === 'Square Footage')?.display === '2,000 sq ft');
check('Rooms = 12 rooms', intel3.estimatingVariables.find(v => v.variable === 'Room Count')?.display === '12 rooms');
check('Missing includes Prep Work', intel3.missingInformation.indexOf('Prep Work Required') !== -1);

// TEST 4: Trimming only
console.log('\nTEST 4: Tree trimming (no removal)');
const trimLines = [
  { speaker: 'customer', text: 'I need my oak trees trimmed back from the house.' },
];
const intel4 = demo.buildPolarisIntelligence('TreeCo', 'Tree Service', trimLines);
check('Service = Tree Trimming (not removal+trimming)', intel4.requestedService.primary === 'Tree Trimming');
check('No secondary services', intel4.requestedService.secondary.length === 0);

// TEST 5: polarisEstimate backward compatibility
console.log('\nTEST 5: polarisEstimate backward compat');
const est = demo.polarisEstimate('TreeCo', 'Tree Service', treeLines);
check('opportunityLabel present', !!est.opportunityLabel);
check('confidence present', est.confidence > 0);
check('revenueRange present', !!est.revenueRange);
check('detectedService = Tree Removal', est.detectedService === 'Tree Removal');
check('polarisIntelligence present', !!est.polarisIntelligence);
check('executiveBriefing present', !!est.executiveBriefing);
check('estimatingVariables is array', Array.isArray(est.estimatingVariables));
check('customerFacts present', !!est.customerFacts);

// TEST 6: Empty transcript
console.log('\nTEST 6: Empty transcript');
const intel5 = demo.buildPolarisIntelligence('TestCo', 'Tree Service', []);
check('Confidence has floor value', intel5.estimate.confidence > 0); // floor 10
check('No variables for empty transcript', intel5.estimatingVariables.length === 0);
check('No missing info for empty transcript', intel5.missingInformation.length === 0);
check('Briefing says in progress', intel5.executiveBriefing.indexOf('in progress') !== -1);

// TEST 7: Variable structure correctness
console.log('\nTEST 7: Variable structure');
const tv = intel.estimatingVariables[0];
check('has variable name', typeof tv.variable === 'string');
check('has value field', 'value' in tv);
check('has unit field', 'unit' in tv);
check('has sourceQuote field', 'sourceQuote' in tv);
check('has confidence field', typeof tv.confidence === 'number');
check('has status field', ['collected', 'missing'].indexOf(tv.status) !== -1);

// TEST 8: Estimate adjustments
console.log('\nTEST 8: Estimate adjustments');
check('reasoning includes Estimate Adjustments', intel.reasoning.some(r => r.factor === 'Estimate Adjustments'));
check('adjustments reasons is array', Array.isArray(intel.estimate.adjustments.reasons));
check('adjustments has baseValue', typeof intel.estimate.adjustments.baseValue === 'number');

console.log('\n══════════ SUMMARY ══════════');
console.log('  Passed: ' + passCount + ' / ' + (passCount + failCount));
if (failCount === 0) {
  process.exit(0);
} else {
  process.exit(1);
}