'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const artifact = require('../../docs/architecture/MISSION_28_PART14G_FINAL_ACCEPTANCE_RELEASE.json');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const roadmap = read('docs/roadmap/MISSION_28_BUSINESS_AUTOMATION.md');
const ledger = read('docs/roadmap/MISSION_28_ACCEPTANCE_LEDGER.md');
const narrative = read('docs/architecture/MISSION_28_PART14G_FINAL_ACCEPTANCE_RELEASE.md');
const part14f = require('../../docs/architecture/MISSION_28_PART14F_BROWSER_ACCEPTANCE.json');

function sliceRows() {
  return ledger.split(/\r?\n/).filter(line => /^\| \d{2} \|/.test(line));
}

describe('Mission 28 Part 14G final acceptance and release candidate', () => {
  test('preserves the frozen authority, order and canonical body hash', () => {
    const normalized = roadmap.replace(/\r\n/g, '\n');
    const body = `${normalized.slice(normalized.indexOf('\n## Mission objective\n') + 1).trim()}\n`;
    expect(crypto.createHash('sha256').update(body).digest('hex').toUpperCase())
      .toBe('109589DA2242EE6AA7FDD4C2DED3E3440B909B26452DEFCD39BC2502C1ADAAF5');
    expect(artifact.authority).toEqual(expect.objectContaining({
      sourceSha256: 'DDBA5CA7523A1684330E136313F4416584D142A63167310EEABEC1EBFBB010B4',
      parts: 14, slices: 66,
      part14Order: ['14A', '14B', '14C', '14D', '14E', '14F', '14G'],
    }));
  });

  test('records exactly 65 released slices and only 14G as candidate', () => {
    const rows = sliceRows();
    expect(rows).toHaveLength(66);
    expect(rows.filter(line => line.includes('**Released**'))).toHaveLength(65);
    expect(rows.filter(line => line.includes('**Implementation candidate**'))).toHaveLength(1);
    expect(rows.filter(line => line.includes('Planned / unimplemented'))).toHaveLength(0);
    expect(rows[64]).toContain('| 65 | 14F |');
    expect(rows[64]).toContain('**Released**');
    expect(rows[65]).toContain('| 66 | 14G |');
    expect(rows[65]).toContain('**Implementation candidate**');
    expect(artifact.sliceInventory).toEqual(expect.objectContaining({
      releasedCount: 65, releasedThrough: '14F', implementationCandidateCount: 1,
      implementationCandidate: '14G', plannedUnimplementedCount: 0,
      all66Accepted: false, missionReleased: false,
    }));
  });

  test('binds the exact independently accepted and released Part 14F baseline', () => {
    expect(artifact.releasedBaseline).toMatchObject({
      acceptedSourceHead: 'eedce86851a017ac8ecc0c08b6f63788b4dae88e',
      acceptedTree: '20cb0a9b103fc927ed2e19eabd0b2410343fe09e',
      rootAuditReportSha256: '28E2BF55BD634D3521F9AAFA7C33D0A3C4197DCE6305D542BDD871C374998E9F',
      severityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 },
      pullRequest: 613, mergedMain: '6b29a739d6df1660847aa7d70559a98979dc8021',
      deploymentId: '8762dcc6-e838-419e-8c2d-70a5b8e5dcda', deploymentStatus: 'SUCCESS',
      imageSha256: 'sha256:9cfd5e82dd3853bb3515a6966944802e74dfcf46e6f8c38fa04955d27af92a63',
      productionMigrations: '285_of_285_through_289_no_290',
      backupId: '9819cdb8-09ae-4eb0-b286-2db427ab4892', retainedBackupCount: 1,
      restoreExercised: false,
    });
    expect(part14f.status).toBe('released_terminally_accepted');
    expect(part14f.independentAudit.severityCounts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
    expect(part14f.terminalRelease.mergedMain).toBe(artifact.releasedBaseline.mergedMain);
  });

  test('defines the exact independent correction and normal release procedure without claiming it ran', () => {
    expect(artifact.requiredProcedure).toEqual([
      'verify_exact_full_history_clean_frozen_identity_and_scope',
      'complete_fresh_isolated_exact_head_whole_scope_audit_with_p0_p3',
      'same_writer_correction_and_complete_reaudit_after_every_sha_change',
      'accept_one_exact_clean_zero_finding_source_identity',
      'normal_exact_head_review_with_truthful_ci_status',
      'confirm_fresh_named_backup_then_rotate_older_backups',
      'normal_expected_head_merge_and_exact_tree_match',
      'observe_exactly_one_automatic_deployment_and_bind_image_instance',
      'verify_startup_migrations_health_routes_assets_and_zero_effects_read_only',
      'remove_temporary_credentials_and_write_source_linked_final_ledger',
    ]);
    expect(artifact.pendingEvidence).toEqual({
      part14GIndependentAudit: 'pending', part14GAcceptedSourceHead: null,
      part14GPullRequest: null, part14GMergedMain: null, part14GDeployment: null,
      part14GProductionAcceptance: 'pending', part14GTerminallyAccepted: false,
    });
    expect(narrative).toContain('The procedure itself is not evidence that');
    expect(narrative).toContain('the procedure has run.');
    expect(narrative).toContain('Any correction creates a new');
    expect(narrative).toContain('SHA and requires another complete fresh isolated whole-scope audit');
    expect(narrative).toContain('tree exactly matches the independently accepted source tree. Observe exactly');
    expect(narrative).toContain('one automatic application deployment; do not trigger a manual redeploy.');
  });

  test('leaves runtime, schema, dependencies, migration and deployment configuration unchanged', () => {
    expect(artifact.candidateScope).toMatchObject({
      part: '14G', evidenceAndInventoryReconciliation: true, exactReleaseProcedure: true,
      runtimeChanges: false, schemaChanges: false, dependencyChanges: false,
      deploymentConfigurationChanges: false, migrationAdded: false,
      sourceMigrations: '285_through_289_no_290',
      migration289RawSha256: '47C7AA1BC02C4DBC0CE03F3C57A014B16080070792E503F5616DF97B1DD52B08',
    });
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    expect(migrations).toHaveLength(285);
    expect(migrations.at(-1)).toBe('289_automation_center_runtime_read_authority_v1.sql');
    expect(migrations.some(name => /^290_/.test(name))).toBe(false);
    expect(crypto.createHash('sha256').update(read('migrations/289_automation_center_runtime_read_authority_v1.sql'))
      .digest('hex').toUpperCase()).toBe('47C7AA1BC02C4DBC0CE03F3C57A014B16080070792E503F5616DF97B1DD52B08');
  });

  test('forbids live canaries and preserves every unavailable verdict', () => {
    expect(artifact.canaryBoundary.liveCanaryAuthorized).toBe(false);
    expect(artifact.canaryBoundary.separateAuthorizationRequiredFields).toEqual([
      'tenant', 'recipient', 'content', 'channel', 'provider', 'limit', 'stop',
      'rollback', 'observation', 'privacy', 'cleanup',
    ]);
    expect(artifact.unavailable).toEqual(expect.arrayContaining([
      'private_production_customer_data_real_recipients_messages_or_provider_mutation',
      'first_paying_customer_live_money_validation', 'exercised_disaster_restore',
      'physical_safari_devices', 'manual_assistive_technology_review',
      'founder_page_by_page_visual_approval',
    ]));
    expect(artifact.historicalLimitations).toMatchObject({
      legacyFullParityFailures: 6,
      legacyFullParityStatus: 'baseline_reproduced_not_claimed_green',
      mission31PublicGuidedSimulation: 'separate',
    });
  });
});
