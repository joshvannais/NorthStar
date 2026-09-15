'use strict';

const treeProfiles = require('../../src/commandCenter/demoTreeBusinessProfiles');
const workspace = require('../../src/commandCenter/workspace');
const equipmentCost = require('../../src/estimating/equipmentCostCalculation');
const estimateProposal = require('../../src/estimating/estimateProposal');
const proposalRecipe = require('../../src/estimating/proposalRecipe');

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-15T12:00:00Z');

test('seeded tree companies cover distinct crew and equipment operating models', () => {
  const profiles = Array.from({ length: 80 }, (_unused, index) => treeProfiles.create('profile-' + index));
  expect(new Set(profiles.map(profile => profile.key))).toEqual(new Set(treeProfiles.PROFILES.map(profile => profile.key)));
  expect(profiles.some(profile => profile.workforce.hasQualifiedClimber)).toBe(true);
  expect(profiles.some(profile => !profile.workforce.hasQualifiedClimber)).toBe(true);
  expect(profiles.some(profile => profile.equipment.some(asset => asset.key === 'avant_loader'))).toBe(true);
  expect(profiles.some(profile => !profile.equipment.some(asset => asset.key === 'avant_loader'))).toBe(true);
  for (const profile of profiles) {
    expect(profile.services.map(service => service.key).sort()).toEqual(Object.keys(treeProfiles.OPERATIONS).sort());
    expect(profile.financingPolicy.method).toBe('qualifying_job_share');
    expect(profile.equipment.some(asset => asset.role === 'material_handler')).toBe(true);
    expect(profile.equipment.some(asset => asset.role === 'stump_grinder')).toBe(true);
    expect(profile.equipment.some(asset => asset.role === 'canopy_access')).toBe(true);
  }
});

test('a refreshed demo keeps one internally consistent tree company profile across planning sources', () => {
  for (let index = 0; index < 40; index += 1) {
    const state = workspace.createInitialDemoState(TENANT, NOW, { seed: 'tree-workspace-' + index });
    const profile = state.workspace.businessProfile.industryProfiles.tree;
    expect(state.equipmentBasis.industryProfiles.tree).toEqual(profile);
    expect(state.workspace.businessProfile.workforce.jobControlPolicy).toBe('direct_assignee_or_crew_lead');
    const crewLead = state.workspace.team.members.find(member => member.operationalRole === 'Crew lead');
    expect(crewLead.skills).toEqual(profile.workforce.skills);
  }
});

test('financed tree machinery allocates only a qualifying-job share plus this job operating cost', () => {
  let state;
  for (let index = 0; index < 100; index += 1) {
    const candidate = workspace.createInitialDemoState(TENANT, NOW, { seed: 'tree-finance-' + index });
    if (candidate.equipmentBasis.industryProfiles.tree.equipment.some(asset => asset.financed)) {
      state = candidate;
      break;
    }
  }
  expect(state).toBeDefined();
  const recipe = state.equipmentBasis.knowledgeRows
    .map(row => JSON.parse(row.canonical_document).content.estimateProposalRecipe)
    .filter(Boolean)
    .find(value => value.serviceKey === 'tree');
  const line = recipe.equipmentCostLines[0];
  const result = equipmentCost.calculateLine(line, 0);
  const monthlyPayment = Number(line.allocation.pool.amount);
  const qualifyingJobs = Number(line.allocation.usableHours);
  const thisJobOperatingCost = Number(line.operating.allIn.rate.amount);
  expect(line.method).toBe('financing_cash');
  expect(qualifyingJobs).toBeGreaterThan(1);
  expect(Number(result.total)).toBeCloseTo(monthlyPayment / qualifyingJobs + thisJobOperatingCost, 2);
  expect(Number(result.total)).toBeLessThan(monthlyPayment + thisJobOperatingCost);
});

test('Avant appears only in the seeded profiles that own that optional configuration', () => {
  const withAvant = workspace.createInitialDemoState(TENANT, NOW, { seed: 'tree-seed-16' });
  expect(withAvant.workspace.businessProfile.industryProfiles.tree.key).toBe('avant_residential');
  expect(withAvant.equipmentBasis.assets.some(asset => asset.name === 'Avant articulated compact loader')).toBe(true);
  const withoutAvant = workspace.createInitialDemoState(TENANT, NOW, { seed: 'tree-seed-1' });
  expect(withoutAvant.workspace.businessProfile.industryProfiles.tree.key).not.toBe('avant_residential');
  expect(withoutAvant.equipmentBasis.assets.some(asset => asset.name === 'Avant articulated compact loader')).toBe(false);
});

test('each tree operation selects one matching company recipe with its own work and equipment plan', () => {
  const state = workspace.createInitialDemoState(TENANT, NOW, { seed: 'tree-operation-recipes' });
  const knowledge = state.equipmentBasis.knowledgeRows.map(row => {
    const document = JSON.parse(row.canonical_document);
    return { publicationId: row.publication_id, canonicalDigest: row.canonical_digest, label: document.label, content: document.content };
  }).filter(row => row.content.estimateProposalRecipe?.serviceKey === 'tree');
  expect(knowledge).toHaveLength(Object.keys(treeProfiles.OPERATIONS).length);
  for (const [operation, definition] of Object.entries(treeProfiles.OPERATIONS)) {
    const matches = estimateProposal.applicableRecipes({ knowledge, proposalScope: { jobType: operation } }, { snapshot: { service: { key: 'tree' } } });
    expect(matches).toHaveLength(1);
    expect(matches[0].recipe.id).toBe('simulated_tree_' + operation + '_v1');
    expect(proposalRecipe.normalize(matches[0].recipe).components.find(component => component.kind === 'labor').inputs.lines[0].task).toBe(definition.laborTask);
    expect(matches[0].recipe.components.find(component => component.kind === 'equipment').inputs.lines[0].task).toBe(definition.equipmentTask);
  }
});

test('every tree operation calculates a complete profile-backed draft without manual company inputs', () => {
  const estimateRepository = require('../../src/estimating/estimateProposalRepository');
  const state = workspace.createInitialDemoState(TENANT, NOW, { seed: 'tree-operation-calculations' });
  const body = { version: estimateProposal.VERSION, selectedRevision: null, expectedBasisDigest: null, overrides: [], candidateIds: [] };
  const review = {
    pins: { original: 'tree-operation-calculations' }, currency: 'USD', selectedRevision: null, isCurrent: true,
    pricingPlans: { sources: { serviceKey: 'tree', asOfDate: '2026-09-15', references: [], digest: 'tree-operation-calculations', basis: { directCosts: null, overheadIncluded: [] } } },
  };
  for (const operation of Object.keys(treeProfiles.OPERATIONS)) {
    const item = {
      organizationId: TENANT,
      ids: { estimate: '22222222-2222-4222-8222-222222222222' },
      snapshot: { organizationId: TENANT, service: { key: 'tree', scope: { jobType: operation } } },
    };
    const record = { state, expiresAt: '2026-09-16T12:00:00Z' };
    const output = estimateRepository.demo(record, review, item, body, NOW, state);
    expect(output.readiness).toBe('needs_review');
    expect(output.components.map(component => component.kind)).toEqual(['materials', 'labor', 'equipment', 'travel', 'pricing']);
    expect(output.components.every(component => component.state === 'calculated')).toBe(true);
    expect(Number(output.components.find(component => component.kind === 'equipment').costs[0].total)).toBeGreaterThanOrEqual(0);
    expect(Number(output.components.find(component => component.kind === 'pricing').result.result.proposedBeforeTax)).toBeGreaterThan(0);
    expect(output.questions.map(question => question.id)).toEqual(['resource_readiness', 'cost_coverage']);
  }
});
